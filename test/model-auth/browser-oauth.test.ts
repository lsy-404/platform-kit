// @vitest-environment node
import { createServer } from "node:http";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { authorizeAnthropic, refreshAnthropic } from "../../model-auth/packages/providers/src/anthropic.js";
import { authorizeOpenAI, refreshOpenAI } from "../../model-auth/packages/providers/src/openai.js";

const token = (access = "access", refresh = "refresh") => new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: 3600 }));
const requestCallbackResponse = (url: URL): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const call = request({ hostname: "127.0.0.1", port: Number(url.port), path: `${url.pathname}${url.search}`, headers: { host: url.host } }, response => {
    let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
  });
  call.on("error", reject); call.end();
});
const requestCallback = async (url: URL): Promise<number> => (await requestCallbackResponse(url)).status;
const callback = (opened: string, code = "authorization-code"): URL => {
  const authorize = new URL(opened), redirect = new URL(authorize.searchParams.get("redirect_uri")!);
  redirect.searchParams.set("code", code); redirect.searchParams.set("state", authorize.searchParams.get("state")!);
  return redirect;
};
const jwt = (accountId: string) => `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.signature`;

describe("official browser OAuth providers", () => {
  it("uses the established OpenAI PKCE parameters, fixed callback and form token exchange", async () => {
    let opened = ""; let init: RequestInit | undefined;
    const credential = await authorizeOpenAI({
      fetchImpl: async (_url, request) => { init = request; return token(jwt("account")); },
      openExternal: async url => { opened = url; const response = await requestCallbackResponse(callback(url)); expect(response).toMatchObject({ status: 200, body: "Authorization complete. You can close this window." }); },
    });
    const url = new URL(opened), form = new URLSearchParams(String(init?.body));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", redirect_uri: "http://localhost:1455/auth/callback", code_challenge_method: "S256", id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "pi" });
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(init?.headers).toMatchObject({ "content-type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: "authorization_code", code: "authorization-code", redirect_uri: "http://localhost:1455/auth/callback" });
    expect(credential).toMatchObject({ type: "oauth", access: jwt("account"), refresh: "refresh", accountId: "account" });
    expect(credential.expires).toBeGreaterThan(Date.now() + 3_200_000);
    const reusable = createServer();
    await new Promise<void>((resolve, reject) => { reusable.once("error", reject); reusable.listen(1455, "127.0.0.1", resolve); });
    await new Promise<void>(resolve => reusable.close(() => resolve()));
  });

  it("uses Anthropic's callback, provider flag, JSON exchange and state form field", async () => {
    let opened = ""; let init: RequestInit | undefined;
    const credential = await authorizeAnthropic({
      fetchImpl: async (_url, request) => { init = request; return token(); },
      openExternal: async url => { opened = url; expect(await requestCallback(callback(url))).toBe(200); },
    });
    const url = new URL(opened), body = JSON.parse(String(init?.body));
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ redirect_uri: "http://localhost:53692/callback", code: "true", code_challenge_method: "S256" });
    expect(init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(body).toMatchObject({ grant_type: "authorization_code", code: "authorization-code", state: url.searchParams.get("state") });
    expect(credential.accountId).toBeUndefined();
  });

  it("rejects wrong state and provider errors, then closes the callback listener", async () => {
    let rejected: URL | undefined;
    await expect(authorizeAnthropic({ openExternal: async url => {
      rejected = callback(url); rejected.searchParams.set("state", "wrong");
      expect(await requestCallback(rejected)).toBe(400);
    } })).rejects.toMatchObject({ code: "callback", message: "Browser authorization callback was rejected." });
    await expect(requestCallback(rejected!)).rejects.toMatchObject({ code: expect.stringMatching(/^ECONN(?:REFUSED|RESET)$/) });
    await expect(authorizeOpenAI({ openExternal: async url => {
      const rejected = callback(url); rejected.searchParams.delete("code"); rejected.searchParams.set("error", "access_denied");
      expect(await requestCallback(rejected)).toBe(400);
    } })).rejects.toMatchObject({ code: "callback" });
  });

  it("rejects incomplete tokens and sanitized remote failures", async () => {
    await expect(authorizeOpenAI({ fetchImpl: async () => new Response(JSON.stringify({ access_token: "private-access", refresh_token: "private-refresh" })), openExternal: async url => { await requestCallback(callback(url)); } })).rejects.toMatchObject({ code: "response", message: "OAuth token response is incomplete." });
    await expect(authorizeAnthropic({ fetchImpl: async () => new Response("private remote failure", { status: 401 }), openExternal: async url => { await requestCallback(callback(url)); } })).rejects.toMatchObject({ code: "transport", message: "OAuth token request was rejected." });
  });

  it("refreshes using each wire encoding and preserves omitted renewable/account fields", async () => {
    let openaiInit: RequestInit | undefined, anthropicInit: RequestInit | undefined;
    const initial = { type: "oauth" as const, access: "not-a-jwt", refresh: "old-refresh", expires: Date.now() + 10_000, accountId: "old-account" };
    const openai = await refreshOpenAI(initial, { fetchImpl: async (_url, init) => { openaiInit = init; return new Response(JSON.stringify({ access_token: "new-access", expires_in: 120 })); } });
    const anthropic = await refreshAnthropic(initial, { fetchImpl: async (_url, init) => { anthropicInit = init; return token("new-anthropic", "new-refresh"); } });
    expect(Object.fromEntries(new URLSearchParams(String(openaiInit?.body)))).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-refresh" });
    expect(JSON.parse(String(anthropicInit?.body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-refresh" });
    expect(openai).toMatchObject({ refresh: "old-refresh", accountId: "old-account" });
    expect(anthropic).toMatchObject({ refresh: "new-refresh" });
    await expect(refreshOpenAI(initial, { fetchImpl: async () => new Response(JSON.stringify({ access_token: "new-access", refresh_token: "", expires_in: 120 })) })).rejects.toMatchObject({ code: "response" });
  });

  it("cancels a pending browser opener, rejects a browser failure, and respects total timeout", async () => {
    const pending = new AbortController();
    const result = authorizeOpenAI({ signal: pending.signal, openExternal: () => new Promise(() => {}) });
    pending.abort();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
    await expect(authorizeAnthropic({ openExternal: () => { throw new Error("private"); } })).rejects.toMatchObject({ code: "browser", message: "Browser authorization could not be opened." });
    await expect(authorizeOpenAI({ timeoutMs: 10, openExternal: () => new Promise(() => {}) })).rejects.toMatchObject({ code: "timeout" });
  });

  it("uses callback completion over a pending browser opener", async () => {
    const success = await authorizeOpenAI({
      fetchImpl: async () => token(jwt("account")),
      openExternal: url => { void requestCallback(callback(url)); return new Promise(() => {}); },
    });
    expect(success.accountId).toBe("account");
    const denied = authorizeAnthropic({ openExternal: url => {
      const rejected = callback(url); rejected.searchParams.set("state", "wrong");
      void requestCallback(rejected).catch(() => {}); return new Promise(() => {});
    } });
    await expect(denied).rejects.toMatchObject({ code: "callback" });
  });

  it("reports a callback port collision and releases an aborted listener", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.listen(1455, "127.0.0.1", resolve); });
    try {
      await expect(authorizeOpenAI({ openExternal: () => undefined })).rejects.toMatchObject({ code: "transport", message: "OAuth callback listener could not bind." });
    } finally { await new Promise<void>(resolve => blocker.close(() => resolve())); }
    let opened: URL | undefined; const abort = new AbortController();
    const authorization = authorizeOpenAI({ signal: abort.signal, openExternal: url => { opened = callback(url); } });
    while (!opened) await new Promise(resolve => setTimeout(resolve, 1));
    abort.abort();
    await expect(authorization).rejects.toMatchObject({ code: "aborted" });
    await expect(requestCallback(opened!)).rejects.toMatchObject({ code: expect.stringMatching(/^ECONN(?:REFUSED|RESET)$/) });
  });
});
