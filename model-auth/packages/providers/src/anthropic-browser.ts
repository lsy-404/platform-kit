import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, type Process } from "@puppeteer/browsers";
import { WebSocket, type RawData } from "ws";
import { authorizeAnthropic, type AnthropicOAuthCredential } from "./anthropic.js";
import { BrowserOAuthError } from "./browser-oauth.js";

export interface AnthropicSessionCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly hostOnly: boolean;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly session: boolean;
  readonly expirationDate?: number;
  readonly sameSite: "strict" | "lax" | "no_restriction" | "unspecified";
}

export interface AuthorizeAnthropicInBrowserOptions {
  readonly executablePath: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly browserArgs?: readonly string[];
}

export interface AnthropicBrowserAuthorization {
  readonly credential: AnthropicOAuthCredential;
  readonly cookies: AnthropicSessionCookie[];
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None" | "Unspecified";
}

interface CdpTargetInfo { targetId: string; type: string; url: string }
interface CdpResponse { id?: number; method?: string; params?: { targetId?: string }; result?: unknown; error?: { message?: string } }

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new BrowserOAuthError("aborted", "Browser authorization was cancelled.");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    if (signal.aborted) onAbort();
  });
}

function anthropicCookies(cookies: CdpCookie[]): AnthropicSessionCookie[] {
  return cookies
    .filter((cookie) => cookie.domain.replace(/^\./, "") === "claude.ai"
      || cookie.domain.replace(/^\./, "").endsWith(".claude.ai"))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      hostOnly: !cookie.domain.startsWith("."),
      ...(cookie.expires !== undefined && cookie.expires >= 0 ? { expirationDate: cookie.expires } : {}),
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      session: cookie.expires === undefined || cookie.expires < 0,
      sameSite: cookie.sameSite === "Strict" ? "strict"
        : cookie.sameSite === "Lax" ? "lax"
          : cookie.sameSite === "None" ? "no_restriction" : "unspecified",
    }));
}

class LoginBrowserSession {
  private nextId = 0;
  private loginTargetId: string | undefined;
  private disposed = false;
  private readonly pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private readonly onAbort = () => this.close();
  private readonly onError = (error: Error) => { if (!this.disposed) this.onClosed(error); };
  private readonly onSocketClose = () => { if (!this.disposed) this.onClosed(new Error("The Anthropic login browser session disconnected")); };
  private readonly onMessage = (data: RawData) => {
    let message: CdpResponse;
    try { message = JSON.parse(data.toString()) as CdpResponse; } catch { return; }
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "Browser session request failed"));
      else request.resolve(message.result);
      return;
    }
    if (message.method === "Target.targetDestroyed" && message.params?.targetId === this.loginTargetId) {
      this.onClosed(new BrowserOAuthError("aborted", "The Anthropic login window was closed."));
    }
  };

  private constructor(
    private readonly socket: WebSocket,
    private readonly signal: AbortSignal,
    private readonly onClosed: (error: Error) => void,
  ) {
    socket.on("message", this.onMessage);
    socket.on("error", this.onError);
    socket.on("close", this.onSocketClose);
    signal.addEventListener("abort", this.onAbort, { once: true });
  }

  static async connect(endpoint: string, oauthUrl: string, signal: AbortSignal, onClosed: (error: Error) => void): Promise<LoginBrowserSession> {
    const session = new LoginBrowserSession(new WebSocket(endpoint, { handshakeTimeout: 10_000 }), signal, onClosed);
    try {
      await session.waitUntilOpen();
      await session.request("Target.setDiscoverTargets", { discover: true });
      const oauthOrigin = new URL(oauthUrl).origin;
      const deadline = Date.now() + 10_000;
      while (!session.loginTargetId && Date.now() < deadline) {
        const result = await session.request("Target.getTargets") as { targetInfos?: CdpTargetInfo[] };
        const pages = (result.targetInfos ?? []).filter((target) => target.type === "page");
        session.loginTargetId = pages.find((target) => {
          try { return new URL(target.url).origin === oauthOrigin; } catch { return false; }
        })?.targetId ?? (pages.length === 1 ? pages[0]?.targetId : undefined);
        if (!session.loginTargetId) await raceWithSignal(new Promise((resolve) => setTimeout(resolve, 250)), signal);
      }
      if (!session.loginTargetId) throw new Error("The Anthropic login browser page could not be identified");
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  async getAnthropicCookies(): Promise<AnthropicSessionCookie[]> {
    const result = await this.request("Storage.getCookies") as { cookies?: CdpCookie[] };
    return anthropicCookies(result.cookies ?? []);
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signal.removeEventListener("abort", this.onAbort);
    this.socket.off("message", this.onMessage);
    this.pending.forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error("Anthropic login browser session closed"));
    });
    this.pending.clear();
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
    if (this.socket.readyState === WebSocket.CLOSED) this.socket.off("error", this.onError);
    else {
      const forceClose = setTimeout(() => this.socket.terminate(), 1_000);
      this.socket.once("close", () => { clearTimeout(forceClose); this.socket.off("error", this.onError); });
    }
  }

  private waitUntilOpen(): Promise<void> {
    throwIfAborted(this.signal);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("Timed out connecting to the Anthropic login browser")), 10_000);
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("open", onOpen);
        this.socket.off("error", onError);
        this.signal.removeEventListener("abort", onAbort);
      };
      const finish = (error?: Error) => { cleanup(); error ? reject(error) : resolve(); };
      const onOpen = () => finish();
      const onError = (error: Error) => finish(error);
      const onAbort = () => finish(abortError(this.signal));
      this.socket.once("open", onOpen);
      this.socket.once("error", onError);
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private request(method: string, params: object = {}): Promise<unknown> {
    throwIfAborted(this.signal);
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("The Anthropic login browser session is unavailable");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out requesting browser session data (${method})`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        reject(error);
      });
    });
  }
}

export async function authorizeAnthropicInBrowser(options: AuthorizeAnthropicInBrowserOptions): Promise<AnthropicBrowserAuthorization> {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new BrowserOAuthError("response", "OAuth authorization timeout is invalid.");
  }
  const controller = new AbortController();
  const { signal } = controller;
  const abortFromCaller = () => controller.abort(new BrowserOAuthError("aborted", "Browser authorization was cancelled."));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  throwIfAborted(signal);
  const timeoutMs = options.timeoutMs ?? 600_000;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(new BrowserOAuthError("timeout", "OAuth authorization timed out.")), Math.min(timeoutMs, 600_000))
    : undefined;

  let browser: Process | undefined;
  let profileDir: string | undefined;
  let session: LoginBrowserSession | undefined;
  let opening: Promise<void> | undefined;
  let browserClosing = false;
  const abortOnBrowserExit = () => {
    if (!browserClosing && !signal.aborted) controller.abort(new BrowserOAuthError("aborted", "The Anthropic login browser was closed."));
  };

  const openBrowser = async (url: string) => {
    throwIfAborted(signal);
    profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "model-auth-anthropic-login-"));
    throwIfAborted(signal);
    const browserArgs = options.browserArgs ?? [];
    if (browserArgs.some((arg) => arg !== "--no-proxy-server" && !/^--proxy-(?:server|bypass-list)=\S+$/.test(arg))) {
      throw new Error("Only proxy server, bypass, and no-proxy arguments are supported for Anthropic login.");
    }
    browser = launch({
      executablePath: options.executablePath,
      pipe: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      signal,
      args: [
        ...browserArgs,
        `--user-data-dir=${profileDir}`,
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        `--app=${url}`,
      ],
    });
    browser.nodeProcess.once("exit", abortOnBrowserExit);
    const endpoint = await raceWithSignal(Promise.race([
      browser.waitForLineOutput(/DevTools listening on (ws:\/\/[^\s]+)/, 120_000),
      browser.hasClosed().then(() => { throw new Error("The Anthropic login browser closed before starting its session"); }),
    ]), signal);
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(endpointUrl.hostname)) {
      throw new Error("The Anthropic login browser did not expose a private loopback session endpoint");
    }
    session = await LoginBrowserSession.connect(endpoint, url, signal, (error) => controller.abort(error));
  };

  try {
    let requestedOpen = false;
    const credential = await authorizeAnthropic({
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      signal,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      openExternal: (url) => {
        if (requestedOpen) throw new Error("The Anthropic login browser has already been opened");
        requestedOpen = true;
        opening = openBrowser(url);
        return opening;
      },
    });
    await opening;
    throwIfAborted(signal);
    if (!session || !browser) throw new Error("The Anthropic login browser session is unavailable");
    const cookies = await session.getAnthropicCookies();
    throwIfAborted(signal);
    if (!cookies.some((cookie) => cookie.name === "sessionKey")) throw new Error("Anthropic login completed without a claude.ai session cookie.");
    return { credential, cookies };
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
    browserClosing = true;
    controller.abort(new Error("Anthropic login finished"));
    session?.close();
    if (opening) await opening.catch(() => undefined);
    if (browser) {
      try { await browser.close(); } catch { browser.kill(); }
      await browser.hasClosed().catch(() => undefined);
    }
    if (profileDir && path.isAbsolute(profileDir)
      && path.dirname(profileDir) === os.tmpdir()
      && path.basename(profileDir).startsWith("model-auth-anthropic-login-")) {
      await fs.promises.rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
        .catch(() => console.warn("Could not remove temporary Anthropic login profile"));
    }
  }
}
