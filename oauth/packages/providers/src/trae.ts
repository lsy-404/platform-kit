import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const TRAE_PROVIDER_ID = "traecode";
const STATUS_TIMEOUT_MS = 5_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export type TraeErrorCode = "aborted" | "authentication" | "not-found" | "output-overflow" | "timeout" | "transport";

export class TraeProviderError extends Error {
  public constructor(public readonly code: TraeErrorCode, message: string) {
    super(message);
    this.name = "TraeProviderError";
  }
}

export interface TraeCliProcessOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface TraeCliProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface TraeCliProcess {
  run(command: string, args: readonly string[], options: TraeCliProcessOptions): Promise<TraeCliProcessResult>;
}

export interface TraeSession {
  /** An absolute, application-owned directory used as TRAE_HOME. */
  readonly homeDir: string;
  readonly label?: string;
  /** Optional HTTPS enterprise API origin supplied to the official CLI. */
  readonly host?: string;
}

export interface TraeProviderOptions {
  readonly session: TraeSession;
  readonly executable?: string;
  readonly process?: TraeCliProcess;
  readonly timeoutMs?: number;
}

export interface TraeLoginStatus {
  readonly available: boolean;
  readonly authenticated: boolean;
  readonly sessionLabel: string;
  readonly capability: "enterprise-cli-only";
  readonly accountProfilesSupported: false;
  readonly detail: "authenticated" | "cli-not-found" | "logged-out";
}

export interface TraeExecutionRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly tools?: readonly TraeToolDefinition[];
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export interface TraeExecutionResult {
  readonly assistantText: string | null;
  readonly toolCalls: readonly TraeToolCall[];
}

export interface TraeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface TraeToolCall {
  readonly id: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}

/** Adapts the documented enterprise TraeCode CLI without reading or persisting credentials. */
export class TraeProvider {
  private readonly executable: string;
  private readonly session: TraeSession;
  private readonly process: TraeCliProcess;
  private readonly timeoutMs: number;

  public constructor(options: TraeProviderOptions) {
    this.session = validateSession(options.session);
    this.executable = options.executable?.trim() || "traecli";
    this.process = options.process ?? new NodeTraeCliProcess();
    this.timeoutMs = boundedTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  public async status(signal?: AbortSignal): Promise<TraeLoginStatus> {
    throwIfAborted(signal);
    try {
      await prepareSessionHome(this.session, signal);
      const result = await this.run(["login", "status"], STATUS_TIMEOUT_MS, undefined, signal);
      return loginStatus(result.exitCode === 0 && parseAuthenticated(`${result.stdout}\n${result.stderr}`), this.session);
    } catch (error) {
      if (isTraeError(error, "not-found")) return unavailableStatus(this.session);
      throw error;
    }
  }

  /** Starts the official CLI browser login flow and requires a verified session afterwards. */
  public async login(signal?: AbortSignal): Promise<TraeLoginStatus> {
    throwIfAborted(signal);
    await prepareSessionHome(this.session, signal);
    const result = await this.run(["login"], LOGIN_TIMEOUT_MS, undefined, signal);
    if (result.exitCode !== 0) throw new TraeProviderError("authentication", "TraeCode CLI login failed.");
    const status = await this.status(signal);
    if (!status.authenticated) throw new TraeProviderError("authentication", "TraeCode CLI did not authenticate the session.");
    return status;
  }

  public async logout(signal?: AbortSignal): Promise<TraeLoginStatus> {
    throwIfAborted(signal);
    await prepareSessionHome(this.session, signal);
    const result = await this.run(["logout"], STATUS_TIMEOUT_MS, undefined, signal);
    if (result.exitCode !== 0) throw new TraeProviderError("authentication", "TraeCode CLI logout failed.");
    const status = await this.status(signal);
    if (status.authenticated) throw new TraeProviderError("authentication", "TraeCode CLI session remains authenticated.");
    return status;
  }

  public async execute(request: TraeExecutionRequest): Promise<TraeExecutionResult> {
    throwIfAborted(request.signal);
    if (!request.prompt.trim()) throw new TraeProviderError("transport", "TRAE execution prompt is required.");
    await prepareSessionHome(this.session, request.signal);
    const directory = await mkdtemp(join(this.session.homeDir, "exec-"));
    const schemaPath = join(directory, "output-schema.json");
    const outputPath = join(directory, "last-message.json");
    try {
      throwIfAborted(request.signal);
      await writeFile(schemaPath, JSON.stringify(outputSchema()), { mode: 0o600 });
      const args = ["exec", "--json", "--output-schema", schemaPath, "--output-last-message", outputPath, "--ephemeral", "--sandbox", "read-only", "--permission-mode", "plan", "--skip-git-repo-check"];
      if (request.model?.trim()) args.push("--model", request.model.trim());
      args.push("--", executionPrompt(request));
      const result = await this.run(args, this.timeoutMs, request.cwd, request.signal);
      if (result.exitCode !== 0) throw new TraeProviderError("transport", "TraeCode CLI execution failed.");
      throwIfAborted(request.signal);
      return parseExecution(await readBounded(outputPath), request.tools ?? []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private run(args: readonly string[], timeoutMs: number, cwd?: string, signal?: AbortSignal): Promise<TraeCliProcessResult> {
    throwIfAborted(signal);
    const options: TraeCliProcessOptions = { env: sessionEnvironment(this.session), timeoutMs: boundedTimeout(timeoutMs) };
    if (cwd !== undefined) (options as { cwd?: string }).cwd = cwd;
    if (signal !== undefined) (options as { signal?: AbortSignal }).signal = signal;
    return this.process.run(this.executable, args, options);
  }
}

export class NodeTraeCliProcess implements TraeCliProcess {
  public run(command: string, args: readonly string[], options: TraeCliProcessOptions): Promise<TraeCliProcessResult> {
    throwIfAborted(options.signal);
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let closed = false;
      let outputBytes = 0;
      let escalationTimer: NodeJS.Timeout | undefined;
      const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
      const rejectOnce = (error: TraeProviderError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const terminate = () => {
        child.kill();
        escalationTimer = setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 250);
        escalationTimer.unref();
      };
      const abort = () => { terminate(); rejectOnce(new TraeProviderError("aborted", "TraeCode CLI operation was cancelled.")); };
      const timer = setTimeout(() => { terminate(); rejectOnce(new TraeProviderError("timeout", "TraeCode CLI operation timed out.")); }, options.timeoutMs);
      options.signal?.addEventListener("abort", abort, { once: true });
      const append = (target: "stdout" | "stderr", chunk: Buffer | string) => {
        if (settled) return;
        const value = String(chunk);
        outputBytes += Buffer.byteLength(value);
        if (outputBytes > MAX_OUTPUT_BYTES) {
          terminate();
          rejectOnce(new TraeProviderError("output-overflow", "TraeCode CLI output exceeded the safety limit."));
          return;
        }
        if (target === "stdout") stdout += value; else stderr += value;
      };
      child.stdout.on("data", (chunk: Buffer | string) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer | string) => append("stderr", chunk));
      child.once("error", (error: NodeJS.ErrnoException) => {
        rejectOnce(new TraeProviderError(error.code === "ENOENT" ? "not-found" : "transport", error.code === "ENOENT" ? "TraeCode CLI executable was not found." : "Unable to start TraeCode CLI."));
      });
      child.once("close", (exitCode: number | null) => {
        closed = true;
        if (escalationTimer) clearTimeout(escalationTimer);
        if (settled) return;
        settled = true;
        cleanup();
        if (exitCode === null) return reject(new TraeProviderError("transport", "TraeCode CLI stopped unexpectedly."));
        resolve({ exitCode, stdout, stderr });
      });
    });
  }
}

function validateSession(session: TraeSession): TraeSession {
  const homeDir = resolve(session.homeDir);
  if (!isAbsolute(session.homeDir) || homeDir !== session.homeDir || homeDir === "/" || homeDir === homedir()) throw new TraeProviderError("transport", "TRAE session homeDir must be a specific absolute application directory.");
  try {
    const state = lstatSync(homeDir);
    if (state.isSymbolicLink() || !state.isDirectory()) throw new TraeProviderError("transport", "TRAE session homeDir must be a non-symlink directory.");
  } catch (error) {
    if (error instanceof TraeProviderError) throw error;
  }
  return { ...session, homeDir };
}

async function prepareSessionHome(session: TraeSession, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await mkdir(session.homeDir, { recursive: true, mode: 0o700 });
  throwIfAborted(signal);
  const state = lstatSync(session.homeDir);
  if (state.isSymbolicLink() || !state.isDirectory()) throw new TraeProviderError("transport", "TRAE session homeDir must be a non-symlink directory.");
}

function sessionEnvironment(session: TraeSession): Record<string, string | undefined> {
  const host = session.host?.trim();
  if (host) validateHost(host);
  return { TRAE_HOME: session.homeDir, TRAECLI_PERSONAL_ACCESS_TOKEN: undefined, TRAECLI_HOST: host };
}

function validateHost(host: string): void {
  const parsed = new URL(host);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new TraeProviderError("transport", "TRAE enterprise host must be an HTTPS origin.");
}

function loginStatus(authenticated: boolean, session: TraeSession): TraeLoginStatus {
  return { available: true, authenticated, sessionLabel: session.label?.trim() || "TraeCode CLI session", capability: "enterprise-cli-only", accountProfilesSupported: false, detail: authenticated ? "authenticated" : "logged-out" };
}

function unavailableStatus(session: TraeSession): TraeLoginStatus {
  return { available: false, authenticated: false, sessionLabel: session.label?.trim() || "TraeCode CLI session", capability: "enterprise-cli-only", accountProfilesSupported: false, detail: "cli-not-found" };
}

function parseAuthenticated(output: string): boolean {
  for (const line of output.trim().split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value && typeof value === "object" && ["loggedIn", "logged_in", "authenticated"].some(key => typeof value[key] === "boolean")) {
        return value.loggedIn === true || value.logged_in === true || value.authenticated === true;
      }
    } catch { /* Status also has a human-readable form. */ }
  }
  if (/not logged in|logged out|unauthenticated|not authenticated|未登录/i.test(output)) return false;
  return /^(?:logged in(?:\s+(?:using|as)\b|\s*$)|已登录)/im.test(output.trim());
}

function outputSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["assistantText", "toolCalls"],
    additionalProperties: false,
    properties: {
      assistantText: { type: ["string", "null"] },
      toolCalls: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "toolName", "argumentsJson"],
          additionalProperties: false,
          properties: { id: { type: "string" }, toolName: { type: "string" }, argumentsJson: { type: "string" } },
        },
      },
    },
  };
}

function executionPrompt(request: TraeExecutionRequest): string {
  if (!request.tools?.length) return request.prompt;
  const tools = request.tools.map((tool) => {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(tool.name) || !tool.description.trim()) {
      throw new TraeProviderError("transport", "TRAE tool definitions are invalid.");
    }
    return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
  });
  try {
    return `${request.prompt}\n\nHost tools available for structured toolCalls:\n${JSON.stringify(tools)}`;
  } catch { throw new TraeProviderError("transport", "TRAE tool definitions are not serializable."); }
}

async function readBounded(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_OUTPUT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OUTPUT_BYTES) throw new TraeProviderError("output-overflow", "TraeCode CLI response exceeded the safety limit.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}

function parseExecution(output: string, tools: readonly TraeToolDefinition[]): TraeExecutionResult {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    if ((typeof value.assistantText !== "string" && value.assistantText !== null) || !Array.isArray(value.toolCalls)) throw new Error();
    const ids = new Set<string>();
    const toolCalls = value.toolCalls.map((call) => {
      if (!call || typeof call !== "object") throw new Error();
      const item = call as Record<string, unknown>;
      if (typeof item.id !== "string" || typeof item.toolName !== "string" || typeof item.argumentsJson !== "string") throw new Error();
      if (!item.id || ids.has(item.id) || !tools.some(tool => tool.name === item.toolName)) throw new Error();
      ids.add(item.id);
      const args: unknown = JSON.parse(item.argumentsJson);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
      return { id: item.id, toolName: item.toolName, argumentsJson: item.argumentsJson };
    });
    return { assistantText: value.assistantText, toolCalls };
  } catch { throw new TraeProviderError("transport", "TraeCode CLI returned an invalid structured response."); }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TraeProviderError("aborted", "TraeCode CLI operation was cancelled.");
}

function boundedTimeout(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(value, LOGIN_TIMEOUT_MS)) : DEFAULT_TIMEOUT_MS;
}

function isTraeError(error: unknown, code: TraeErrorCode): error is TraeProviderError {
  return error instanceof TraeProviderError && error.code === code;
}
