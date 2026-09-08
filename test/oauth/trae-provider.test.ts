// @vitest-environment node
import { createHash, verify } from "node:crypto";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { authorizeTrae, createTraeDevice, DEFAULT_TRAE_CLIENT_ID, refreshTrae, traeStatus, type TraeCredential } from "../../oauth/packages/providers/src/trae.js";

const host = "https://growsg-normal.trae.ai";
const tokens = () => ({ Token: "access", RefreshToken: "refresh", TokenExpireAt: Date.now() + 60_000, RefreshExpireAt: Date.now() + 120_000 });
const credential = (): TraeCredential => ({ access: "access", refresh: "refresh", expires: Date.now() + 60_000, refreshExpires: Date.now() + 120_000, host, clientId: DEFAULT_TRAE_CLIENT_ID, device: createTraeDevice() });
const response = (Result: unknown) => new Response(JSON.stringify({ Result }));
const fetchImpl: typeof fetch = async url => response(String(url).endsWith("GetUserInfo") ? { UserID: "account", ScreenName: "name", AIRegion: "singapore-central", StoreCountry: "CA" } : tokens());
function callback(opened: string): URL {
  const auth = new URL(opened), result = new URL(auth.searchParams.get("auth_callback_url")!);
  result.searchParams.set("loginTraceID", auth.searchParams.get("login_trace_id")!);
  result.searchParams.set("scope", "trae"); result.searchParams.set("userTag", "row");
  result.searchParams.set("authCodeInfo", JSON.stringify({ AuthCode: "code" }));
  return result;
}
const send = (url: URL, headers: Record<string, string> = {}): Promise<number> => new Promise((resolve, reject) => {
  const req = request(url, { headers }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
  req.on("error", reject); req.end();
});

describe("Trae browser provider", () => {
  it("exchanges a correlated authorization code with its PKCE verifier and registers the persisted device key", async () => {
    let opened = ""; const requests: { url: string; body: Record<string, any>; init?: RequestInit }[] = [];
    const result = await authorizeTrae({ fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), init }); return fetchImpl(url, init);
    }, openExternal: async url => { opened = url; expect(await send(callback(url))).toBe(200); } });
    const url = new URL(opened), query = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://www.trae.ai/authorization");
    expect(query.get("auth_from")).toBe("trae"); expect(query.get("plugin_version")).toBe("2.3.61406");
    expect(query.get("code_challenge_method")).toBe("S256");
    const exchange = requests[0]!;
    expect(exchange.url).toBe(`${host}/trae/api/v3/oauth/ExchangeToken`);
    expect(exchange.init?.redirect).toBe("error");
    expect(createHash("sha256").update(exchange.body.CodeVerifier).digest("base64url")).toBe(query.get("code_challenge"));
    expect(exchange.body).toMatchObject({ ClientID: DEFAULT_TRAE_CLIENT_ID, AuthCode: "code", IDEVersion: "3.5.81", DeviceInfo: { DeviceID: query.get("device_id"), MachineID: query.get("machine_id"), DevicePublicKey: result.device.publicKeyPem } });
    expect(exchange.body).not.toHaveProperty("RefreshToken");
    expect(result).toMatchObject({ access: "access", refresh: "refresh", host, accountId: "account", label: "name", region: "singapore-central", storeCountry: "CA", userTag: "row", clientId: DEFAULT_TRAE_CLIENT_ID });
    expect(requests[1]?.url).toBe(`${host}/cloudide/api/v3/trae/GetUserInfo`);
  });

  it("rejects absent, wrong, duplicate correlation and wrong Host without consuming the session", async () => {
    const result = await authorizeTrae({ fetchImpl, openExternal: async url => {
      const valid = callback(url);
      const missing = new URL(valid); missing.searchParams.delete("loginTraceID"); expect(await send(missing)).toBe(400);
      const wrong = new URL(valid); wrong.searchParams.set("loginTraceID", "wrong"); expect(await send(wrong)).toBe(400);
      const duplicate = new URL(valid); duplicate.searchParams.append("loginTraceID", valid.searchParams.get("loginTraceID")!); expect(await send(duplicate)).toBe(400);
      expect(await send(valid, { host: "attacker.test" })).toBe(404);
      expect(await send(valid)).toBe(200);
    } });
    expect(result.accountId).toBe("account");
  });

  it("does not accept legacy direct tokens, duplicate codes or enterprise scope as personal authorization", async () => {
    const result = await authorizeTrae({ fetchImpl, openExternal: async url => {
      const direct = callback(url); direct.searchParams.delete("authCodeInfo");
      direct.searchParams.set("userJwt", JSON.stringify(tokens())); direct.searchParams.set("refreshToken", "injected");
      expect(await send(direct)).toBe(400);
      const enterprise = callback(url); enterprise.searchParams.set("scope", "saas"); expect(await send(enterprise)).toBe(400);
      const duplicate = callback(url); duplicate.searchParams.append("authCodeInfo", "{}"); expect(await send(duplicate)).toBe(400);
      expect(await send(callback(url))).toBe(200);
    } });
    expect(result.refresh).toBe("refresh");
  });

  it("ignores callback host and account metadata and uses only fixed official service hosts", async () => {
    const urls: string[] = [];
    const result = await authorizeTrae({ fetchImpl: async (url, init) => { urls.push(String(url)); return fetchImpl(url, init); }, openExternal: async url => {
      const value = callback(url); value.searchParams.set("host", "https://attacker.test");
      value.searchParams.set("userInfo", JSON.stringify({ UserID: "attacker", Name: "attacker" })); await send(value);
    } });
    expect(result).toMatchObject({ host, accountId: "account" });
    expect(urls.every(url => url.startsWith(host + "/"))).toBe(true);
  });

  it("routes US-tagged callbacks to their official account endpoint", async () => {
    const result = await authorizeTrae({ fetchImpl, openExternal: async url => { const value = callback(url); value.searchParams.set("userTag", "usttp"); await send(value); } });
    expect(result.host).toBe("https://grow-normal.traeapi.us");
  });

  it("does not retain a listener after a synchronous browser failure", async () => {
    let url: URL | undefined;
    await expect(authorizeTrae({ openExternal: opened => { url = callback(opened); throw new Error("private failure details"); } })).rejects.toMatchObject({ code: "transport", message: "Trae authorization browser could not be opened." });
    await expect(send(url!)).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("times out even when the browser-opening promise never settles", async () => {
    await expect(authorizeTrae({ timeoutMs: 10, openExternal: () => new Promise(() => {}) })).rejects.toMatchObject({ code: "timeout" });
  });

  it("supports cancellation before, during and after callback delivery", async () => {
    const before = new AbortController(); before.abort(); let opened = false;
    await expect(authorizeTrae({ signal: before.signal, openExternal: () => { opened = true; } })).rejects.toMatchObject({ code: "aborted" }); expect(opened).toBe(false);
    const during = new AbortController();
    await expect(authorizeTrae({ signal: during.signal, openExternal: () => { during.abort(); } })).rejects.toMatchObject({ code: "aborted" });
    const after = new AbortController();
    await expect(authorizeTrae({ signal: after.signal, fetchImpl: async () => { after.abort(); throw new Error(); }, openExternal: async url => { await send(callback(url)); } })).rejects.toMatchObject({ code: "aborted" });
  });

  it("reports service rejection without exposing remote error bodies", async () => {
    await expect(authorizeTrae({ fetchImpl: async () => new Response(JSON.stringify({ ResponseMetadata: { Error: { Code: "20401", Message: "secret detail" } } })), openExternal: async url => { await send(callback(url)); } })).rejects.toMatchObject({ code: "authentication", message: "Trae service rejected the authorization." });
  });

  it("signs refresh requests with the same registered key and exact protocol fields", async () => {
    const initial = credential(); let body: Record<string, any> = {};
    const refreshed = await refreshTrae(initial, { fetchImpl: async (_url, init) => {
      expect(init?.redirect).toBe("error"); body = JSON.parse(String(init?.body));
      return response({ ...tokens(), Token: "new-access", RefreshToken: "new-refresh" });
    } });
    const proof = body.DeviceProof;
    const signed = ["POST", "/trae/api/v3/oauth/ExchangeToken", DEFAULT_TRAE_CLIENT_ID, "refresh", String(proof.Timestamp), proof.Nonce].join("\n");
    expect(verify("sha256", Buffer.from(signed), initial.device.publicKeyPem, Buffer.from(proof.Signature, "base64"))).toBe(true);
    expect(refreshed).toMatchObject({ access: "new-access", refresh: "new-refresh", device: initial.device });
  });

  it("rejects untrusted credential hosts, changed client IDs and mismatched device keys before sending tokens", async () => {
    let called = false; const remote: typeof fetch = async () => { called = true; return response(tokens()); };
    const initial = credential();
    for (const invalidHost of ["https://attacker.test", "https://growsg-normal.trae.ai.attacker.test", "http://127.0.0.1", "https://growsg-normal.trae.ai:444", "https://user@growsg-normal.trae.ai"]) {
      await expect(refreshTrae({ ...initial, host: invalidHost }, { fetchImpl: remote })).rejects.toBeDefined();
    }
    await expect(refreshTrae(initial, { fetchImpl: remote, clientId: "different" })).rejects.toMatchObject({ code: "authentication" });
    await expect(refreshTrae({ ...initial, device: { ...initial.device, publicKeyPem: createTraeDevice().publicKeyPem } }, { fetchImpl: remote })).rejects.toMatchObject({ code: "response" });
    expect(called).toBe(false);
  });

  it("rejects missing and expired token metadata and handles duration in milliseconds", async () => {
    const initial = credential();
    for (const invalid of [{}, { ...tokens(), TokenExpireAt: undefined }, { ...tokens(), RefreshExpireAt: undefined }, { ...tokens(), RefreshToken: "" }, { ...tokens(), TokenExpireAt: Date.now() - 1000 }]) {
      await expect(refreshTrae(initial, { fetchImpl: async () => response(invalid) })).rejects.toMatchObject({ code: "response" });
    }
    const start = Date.now();
    const value = await refreshTrae(initial, { fetchImpl: async () => response({ ...tokens(), TokenExpireAt: start - 1, TokenExpireDuration: 60_000 }) });
    expect(value.expires - start).toBeGreaterThanOrEqual(60_000); expect(value.expires - start).toBeLessThan(61_000);
  });

  it("requires explicit successful login status and propagates transport errors", async () => {
    for (const result of [{}, { IsLogin: false }, { IsLogin: "true" }]) expect(await traeStatus(credential(), { fetchImpl: async () => response(result) })).toEqual({ authenticated: false, detail: "unauthenticated" });
    expect(await traeStatus(credential(), { fetchImpl: async () => response({ IsLogin: true }) })).toEqual({ authenticated: true, detail: "authenticated" });
    expect(await traeStatus(credential(), { fetchImpl: async () => new Response("", { status: 401 }) })).toEqual({ authenticated: false, detail: "unauthenticated" });
    await expect(traeStatus(credential(), { fetchImpl: async () => { throw new Error("credential must not leak"); } })).rejects.toMatchObject({ code: "transport", message: "Trae service request could not be completed." });
  });
});
