// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NodeTraeCliProcess, TraeProvider, TraeProviderError, type TraeCliProcess, type TraeCliProcessOptions, type TraeCliProcessResult } from "../../oauth/packages/providers/src/trae.js";

class MockProcess implements TraeCliProcess {
  public readonly calls: Array<{ command: string; args: readonly string[]; options: TraeCliProcessOptions }> = [];
  public constructor(private readonly respond: (args: readonly string[]) => TraeCliProcessResult, private readonly output = '{"assistantText":"done","toolCalls":[]}') {}
  public async run(command: string, args: readonly string[], options: TraeCliProcessOptions): Promise<TraeCliProcessResult> {
    this.calls.push({ command, args, options });
    const outputIndex = args.indexOf("--output-last-message");
    if (outputIndex >= 0) writeFileSync(args[outputIndex + 1]!, this.output);
    return this.respond(args);
  }
}

async function withSession(run: (session: { homeDir: string; label: string }) => Promise<void> | void): Promise<void> {
  const homeDir = mkdtempSync(join(tmpdir(), "model-auth-trae-"));
  try { await run({ homeDir, label: "Enterprise CLI" }); } finally { rmSync(homeDir, { recursive: true, force: true }); }
}

describe("TraeProvider", () => {
  it("uses TRAE_HOME only and reads an authenticated status emitted to stderr", () => withSession(async (session) => {
    const process = new MockProcess(() => ({ exitCode: 0, stdout: "", stderr: '{"loggedIn":true}' }));
    const provider = new TraeProvider({ session, process });
    await expect(provider.status()).resolves.toMatchObject({ available: true, authenticated: true, detail: "authenticated" });
    expect(process.calls[0]?.options.env).toEqual({ TRAE_HOME: session.homeDir, TRAECLI_PERSONAL_ACCESS_TOKEN: undefined });
  }));

  it("distinguishes a logged-out CLI from a missing executable", () => withSession(async (session) => {
    const loggedOut = new TraeProvider({ session, process: new MockProcess(() => ({ exitCode: 1, stdout: "", stderr: "logged out" })) });
    await expect(loggedOut.status()).resolves.toMatchObject({ available: true, authenticated: false, detail: "logged-out" });
    const missing: TraeCliProcess = { run: async () => { throw new TraeProviderError("not-found", "ignored"); } };
    await expect(new TraeProvider({ session, process: missing }).status()).resolves.toMatchObject({ available: false, detail: "cli-not-found" });
  }));

  it.each(["unauthenticated", 'Warning\n{"authenticated":false}', "authentication status unavailable"])("does not infer a successful login from ambiguous output", (stdout) => withSession(async session => {
    const process = new MockProcess(() => ({ exitCode: 0, stdout, stderr: "" }));
    await expect(new TraeProvider({ session, process }).status()).resolves.toMatchObject({ authenticated: false });
  }));

  it("requires successful post-login authentication and supports logout", () => withSession(async (session) => {
    const unauthenticated = new TraeProvider({ session, process: new MockProcess(() => ({ exitCode: 0, stdout: "logged out", stderr: "" })) });
    await expect(unauthenticated.login()).rejects.toMatchObject({ code: "authentication" });
    let loggedIn = true;
    const process = new MockProcess((args) => {
      if (args[0] === "logout") loggedIn = false;
      return { exitCode: 0, stdout: loggedIn ? "logged in" : "logged out", stderr: "" };
    });
    const provider = new TraeProvider({ session, process });
    await expect(provider.logout()).resolves.toMatchObject({ available: true, authenticated: false, detail: "logged-out" });
    expect(process.calls.map(({ args }) => args)).toEqual([["logout"], ["login", "status"]]);
  }));

  it("uses the documented structured exec protocol and returns no raw stderr", () => withSession(async (session) => {
    const process = new MockProcess(() => ({ exitCode: 0, stdout: "event stream", stderr: "sensitive diagnostic" }));
    const provider = new TraeProvider({ session, process, timeoutMs: 50 });
    await expect(provider.execute({ prompt: "--hostile", model: "trae-model", cwd: session.homeDir })).resolves.toEqual({ assistantText: "done", toolCalls: [] });
    expect(process.calls[0]?.args.slice(0, 14)).toEqual(["exec", "--json", "--output-schema", expect.any(String), "--output-last-message", expect.any(String), "--ephemeral", "--sandbox", "read-only", "--permission-mode", "plan", "--skip-git-repo-check", "--model", "trae-model"]);
    expect(process.calls[0]?.args.slice(-2)).toEqual(["--", "--hostile"]);
  }));

  it("does not write or spawn for an already aborted request", () => withSession(async (session) => {
    const process = new MockProcess(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    const controller = new AbortController();
    controller.abort();
    await expect(new TraeProvider({ session, process }).execute({ prompt: "never", signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(process.calls).toHaveLength(0);
  }));

  it("returns structured host tool calls with validated JSON arguments", () => withSession(async (session) => {
    const output = '{"assistantText":null,"toolCalls":[{"id":"call-1","toolName":"read_file","argumentsJson":"{\\"path\\":\\"README.md\\"}"}]}';
    const provider = new TraeProvider({ session, process: new MockProcess(() => ({ exitCode: 0, stdout: "", stderr: "" }), output) });
    await expect(provider.execute({ prompt: "Inspect", tools: [{ name: "read_file", description: "Read a repository file", inputSchema: { type: "object" } }] }))
      .resolves.toEqual({ assistantText: null, toolCalls: [{ id: "call-1", toolName: "read_file", argumentsJson: '{"path":"README.md"}' }] });
  }));

  it("rejects unlisted tools and non-object arguments", () => withSession(async session => {
    for (const call of [
      { id: "one", toolName: "not_allowed", argumentsJson: "{}" },
      { id: "one", toolName: "read_file", argumentsJson: "[]" },
    ]) {
      const process = new MockProcess(() => ({ exitCode: 0, stdout: "", stderr: "" }), JSON.stringify({ assistantText: null, toolCalls: [call] }));
      await expect(new TraeProvider({ session, process }).execute({ prompt: "Inspect", tools: [{ name: "read_file", description: "Read file", inputSchema: { type: "object" } }] })).rejects.toMatchObject({ code: "transport" });
    }
  }));

  it("rejects a timed out or overflowing child instead of returning a successful result", async () => {
    const runner = new NodeTraeCliProcess();
    await expect(runner.run(globalThis.process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 25 })).rejects.toMatchObject({ code: "timeout" });
    await expect(runner.run(globalThis.process.execPath, ["-e", "process.stdout.write('x'.repeat(70000))"], { timeoutMs: 2_000 })).rejects.toMatchObject({ code: "output-overflow" });
  }, 4_000);

  it("escalates to SIGKILL after a child ignores SIGTERM", async () => {
    const pidDirectory = mkdtempSync(join(tmpdir(), "model-auth-trae-pid-"));
    const pidPath = join(pidDirectory, "pid");
    const controller = new AbortController();
    const runner = new NodeTraeCliProcess();
    const result = runner.run(globalThis.process.execPath, ["-e", "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", pidPath], { timeoutMs: 5_000, signal: controller.signal }).catch(error => error);
    try {
      await expect.poll(() => existsSync(pidPath), { timeout: 3_000 }).toBe(true);
      const pid = Number(readFileSync(pidPath, "utf8"));
      controller.abort();
      await expect(result).resolves.toMatchObject({ code: "aborted" });
      await expect.poll(() => {
        try { globalThis.process.kill(pid, 0); return false; } catch { return true; }
      }, { timeout: 1_500 }).toBe(true);
    } finally {
      controller.abort();
      await result;
      rmSync(pidDirectory, { recursive: true, force: true });
    }
  }, 8_000);

});
