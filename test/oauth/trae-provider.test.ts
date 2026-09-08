// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authorizeTrae, createTraeDevice, refreshTrae, TraeProviderError, type TraeCredential } from "../../oauth/packages/providers/src/trae.js";

const credential = (): TraeCredential => ({ access: "access", refresh: "refresh", expires: Date.now() + 60_000, refreshExpires: Date.now() + 60_000, host: "https://api.example.test", device: createTraeDevice({ deviceId: "device", machineId: "machine" }) });

describe("Trae browser provider", () => {
  it("opens the verified handoff URL and accepts only its loopback credential", async () => {
    let opened = "";
    const result = await authorizeTrae({ authFrom: "host-issued", ssoHost: "https://sso.example.test", openExternal: async (url) => {
      opened = url;
      const callback = new URL(url).searchParams.get("auth_callback_url")!;
      const value = encodeURIComponent(JSON.stringify({ userJwt: { Token: "access", TokenExpireAt: Date.now() + 60_000 }, refreshToken: "refresh", refreshExpireAt: Date.now() + 120_000, host: "https://api.example.test" }));
      await fetch(`${callback}?credential=${value}`);
    } });
    expect(opened).toMatch(/^https:\/\/sso\.example\.test\/authorization\?/);
    const query = new URL(opened).searchParams;
    expect([query.get("auth_from"), query.get("login_channel"), query.get("auth_type"), query.get("redirect")]).toEqual(["host-issued", "native_ide", "local", "0"]);
    expect(result).toMatchObject({ access: "access", refresh: "refresh", host: "https://api.example.test" });
    expect(result.device.privateKeyPem).toContain("PRIVATE KEY");
  });

  it("supports cancellation and timeout without invoking an installed CLI", async () => {
    const controller = new AbortController();
    const pending = authorizeTrae({ authFrom: "host-issued", openExternal: async () => { controller.abort(); }, signal: controller.signal });
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    await expect(authorizeTrae({ authFrom: "host-issued", timeoutMs: 1, openExternal: async () => undefined })).rejects.toMatchObject({ code: "timeout" });
  });

  it("signs the verified refresh envelope and preserves the device binding", async () => {
    const initial = credential(); let body: Record<string, unknown> | undefined;
    const refreshed = await refreshTrae(initial, { fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ Result: { Token: "new-access", RefreshToken: "new-refresh", TokenExpireAt: Date.now() + 60_000, RefreshExpireAt: Date.now() + 120_000 } }), { status: 200 });
    } });
    expect(body).toMatchObject({ ClientID: expect.any(String), RefreshToken: "refresh", DeviceProof: { Signature: expect.any(String), Timestamp: expect.any(Number), Nonce: expect.any(String) } });
    expect(refreshed).toMatchObject({ access: "new-access", refresh: "new-refresh", device: initial.device });
  });

  it("does not treat rejected or incomplete refresh payloads as successful", async () => {
    await expect(refreshTrae(credential(), { fetchImpl: async () => new Response("", { status: 401 }) })).rejects.toBeInstanceOf(TraeProviderError);
    await expect(refreshTrae(credential(), { fetchImpl: async () => new Response(JSON.stringify({ Result: {} }), { status: 200 }) })).rejects.toMatchObject({ code: "response" });
  });
});
