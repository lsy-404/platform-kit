// @vitest-environment node
import { anthropicClientHeaders, refreshAnthropic } from "../../model-auth/packages/providers/src/anthropic.js";
import { queryAnthropicUsage } from "../../model-auth/packages/providers/src/usage.js";
import { request } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { queryGrokUsage, type GrokOAuthCredential } from "../../model-auth/packages/providers/src/grok.js";
import { authorizeTrae, refreshTrae, traeStatus, createTraeDevice, DEFAULT_TRAE_CLIENT_ID, type TraeCredential } from "../../model-auth/packages/providers/src/trae.js";
import { listOpenAICodexModels } from "../../model-auth/packages/providers/src/openai.js";

const traeResult = (Result: unknown) => new Response(JSON.stringify({ Result }));
const trae = (): TraeCredential => ({ access: "access", refresh: "refresh", expires: Date.now() + 60_000, refreshExpires: Date.now() + 120_000, host: "https://growsg-normal.trae.ai", clientId: DEFAULT_TRAE_CLIENT_ID, device: createTraeDevice() });
const manifest = () => new Response(JSON.stringify({ data: { manifest: { darwin: { versions: [{ region: "sg", arch: "apple", version: "3.9.1", url: "https://cdn.example/stable/2.9.12345/darwin/Trae.dmg" }] } } } }));

// Each test file gets a fresh module graph, so the in-process cache starts empty and the first lookups below hit the injected fetch.
describe("default client versions", () => {
  it("keeps version discovery bounded separately from the browser authorization budget", async () => {
    vi.resetModules();
    const { authorizeAnthropic } = await import("../../model-auth/packages/providers/src/anthropic.js");
    const timeout = vi.spyOn(AbortSignal, "timeout"), controller = new AbortController();
    try {
      await expect(authorizeAnthropic({
        timeoutMs: 600_000, signal: controller.signal,
        fetchImpl: async () => { controller.abort(); return new Response(JSON.stringify({ version: "2.1.293" })); },
        openExternal: () => { throw new Error("unexpected browser"); },
      })).rejects.toMatchObject({ code: "aborted" });
      expect(timeout).toHaveBeenCalledWith(5_000);
      expect(timeout).not.toHaveBeenCalledWith(600_000);
    } finally { timeout.mockRestore(); }
  });

  it("keeps Claude token, usage, profile and inference headers on the same latest release", async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).startsWith("https://registry.npmjs.org/")) return new Response(JSON.stringify({ version: "2.1.293" }));
      seen.push({ url: String(url), headers: new Headers(init?.headers) });
      if (String(url).endsWith("/token")) return new Response(JSON.stringify({ access_token: "renewed", refresh_token: "renewed-refresh", expires_in: 3600 }));
      if (String(url).endsWith("/profile")) return new Response(JSON.stringify({ organization_id: "org", organization_type: "anthropic_max" }));
      return new Response(JSON.stringify({ five_hour: { utilization: 10 }, billing_interval: "month" }));
    };
    const credential = await refreshAnthropic({ type: "oauth", access: "old", refresh: "refresh", expires: 0 }, { fetchImpl });
    await queryAnthropicUsage(credential, { fetchImpl });
    const headers = await anthropicClientHeaders({ fetchImpl });
    expect(headers).toEqual({ "user-agent": "claude-cli/2.1.293", "x-app": "cli" });
    expect(seen.map(item => item.url)).toEqual([
      "https://platform.claude.com/v1/oauth/token", "https://api.anthropic.com/api/oauth/usage",
      "https://api.anthropic.com/api/oauth/profile", "https://api.anthropic.com/api/organizations/org/subscription_details",
    ]);
    expect(seen.every(item => item.headers.get("user-agent") === headers["user-agent"] && item.headers.get("x-app") === "cli")).toBe(true);
    expect(seen[0]!.headers.get("content-type")).toBe("application/json");
    expect(seen[1]!.headers.get("authorization")).toBe("Bearer renewed");
  });

  it("does not begin Claude token requests after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    await expect(refreshAnthropic({ type: "oauth", access: "old", refresh: "refresh", expires: 0 }, {
      signal: controller.signal, fetchImpl: async () => { requests++; return new Response(); },
    })).rejects.toMatchObject({ code: "aborted" });
    expect(requests).toBe(0);
  });

  it("sends the latest Codex version to the account catalog", async () => {
    const requests: string[] = [];
    await listOpenAICodexModels({ access: "token" }, { fetchImpl: async url => {
      requests.push(String(url));
      return String(url).startsWith("https://registry.npmjs.org/") ? new Response(JSON.stringify({ version: "0.161.2" })) : new Response(JSON.stringify({ models: [] }));
    } });
    expect(requests).toEqual(["https://registry.npmjs.org/@openai/codex/latest", "https://chatgpt.com/backend-api/codex/models?client_version=0.161.2"]);
  });

  it("sends the latest Grok version on usage requests and honors an explicit override", async () => {
    const credential: GrokOAuthCredential = { type: "oauth", access: "grok-access", refresh: "r", expires: Date.now() + 60_000 };
    const seen: Array<string | null> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url) === "https://x.ai/cli/stable") return new Response("1.0.46\n");
      seen.push(new Headers(init?.headers).get("x-grok-client-version"));
      return new Response(JSON.stringify({ config: { creditUsagePercent: 10 } }));
    };
    await queryGrokUsage(credential, { fetchImpl });
    await queryGrokUsage(credential, { fetchImpl, clientVersion: "9.0.0" });
    expect(seen).toEqual(["1.0.46", "9.0.0"]);
  });

  it("uses the latest Trae app version for refresh and login status unless overridden", async () => {
    const bodies: Array<Record<string, any>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).startsWith("https://api.trae.ai/")) return manifest();
      bodies.push(JSON.parse(String(init?.body)));
      return String(url).endsWith("CheckLogin") ? traeResult({ IsLogin: true }) : traeResult({ Token: "a", RefreshToken: "b", TokenExpireAt: Date.now() + 60_000, RefreshExpireAt: Date.now() + 120_000 });
    };
    await refreshTrae(trae(), { fetchImpl });
    await traeStatus(trae(), { fetchImpl });
    await refreshTrae(trae(), { fetchImpl, appVersion: "4.0.0" });
    expect(bodies.map(body => body.IDEVersion)).toEqual(["3.9.1", "3.9.1", "4.0.0"]);
    expect(bodies[0]!.DeviceInfo.ClientVersion).toBe("3.9.1");
  });

  it("puts the latest Trae app and build versions into browser authorization", async () => {
    let authorizeUrl = "";
    const bodies: Array<Record<string, any>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).startsWith("https://api.trae.ai/")) return manifest();
      bodies.push(JSON.parse(String(init?.body)));
      return String(url).endsWith("GetUserInfo") ? traeResult({ UserID: "account" }) : traeResult({ Token: "a", RefreshToken: "b", TokenExpireAt: Date.now() + 60_000, RefreshExpireAt: Date.now() + 120_000 });
    };
    await authorizeTrae({ fetchImpl, openExternal: async opened => {
      authorizeUrl = opened;
      const auth = new URL(opened), result = new URL(auth.searchParams.get("auth_callback_url")!);
      result.searchParams.set("loginTraceID", auth.searchParams.get("login_trace_id")!);
      result.searchParams.set("scope", "trae"); result.searchParams.set("userTag", "row");
      result.searchParams.set("authCodeInfo", JSON.stringify({ AuthCode: "code" }));
      await new Promise<void>((resolve, reject) => { const req = request(result, res => { res.resume(); res.on("end", () => resolve()); }); req.on("error", reject); req.end(); });
    } });
    const query = new URL(authorizeUrl).searchParams;
    expect(query.get("x_app_version")).toBe("3.9.1");
    expect(query.get("plugin_version")).toBe("2.9.12345");
    expect(bodies[0]!.IDEVersion).toBe("3.9.1");
  });
});
