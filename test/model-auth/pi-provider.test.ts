import { describe, expect, it } from "vitest";
import { createPiOAuthAdapter, discoverPiOAuthProvider, listPiOAuthProviders, type PiOAuthProvider } from "../../model-auth/packages/providers/src/pi.js";
import type { ProviderAuthInteraction } from "../../model-auth/packages/core/src/index.js";

const provider = (id = "github-copilot"): PiOAuthProvider => ({
  id,
  auth: { oauth: {
    name: "GitHub Copilot", loginLabel: "GitHub", isSubscription: true,
    async login(interaction) {
      interaction.notify({ type: "device_code", userCode: "CODE", verificationUri: "https://github.com/login", intervalSeconds: 5 });
      await interaction.prompt({ type: "manual_code", message: "Paste code" });
      return { type: "oauth", access: "access", refresh: "refresh", expires: 1000, enterpriseDomain: "github.example" };
    },
    async refresh(credential) { return { ...credential, access: "renewed" }; },
    async toAuth() { return { apiKey: "access", headers: { authorization: "Bearer access", "x-github": null }, baseUrl: "https://api.githubcopilot.com" }; },
  } },
});

const interaction = (overrides: Partial<ProviderAuthInteraction> = {}): ProviderAuthInteraction => ({
  providerId: "github-copilot", authType: "oauth", loginId: "account", notify() {}, prompt: async () => "code", ...overrides,
});

describe("Pi OAuth provider bridge", () => {
  it("lists supported providers, forwards device codes, and preserves provider credential fields", async () => {
    const providers = [provider(), provider("kimi-coding"), provider("other")];
    expect(listPiOAuthProviders(providers).map(item => item.providerId)).toEqual(["github-copilot", "kimi-coding"]);
    expect(discoverPiOAuthProvider(providers, "openrouter")).toBeNull();
    const notices: unknown[] = [];
    const adapter = createPiOAuthAdapter(provider());
    const credential = await adapter.authorize(interaction({ notify: notice => notices.push(notice) }));
    expect(notices).toEqual([{ type: "device_code", userCode: "CODE", verificationUri: "https://github.com/login", intervalSeconds: 5 }]);
    expect(credential).toMatchObject({ providerId: "github-copilot", credential: { enterpriseDomain: "github.example", access: "access" } });
    await expect(adapter.refresh({ ...credential, providerId: "openrouter" } as never)).rejects.toThrow(/another provider/);
    await expect(adapter.refresh(credential)).resolves.toMatchObject({ credential: { access: "renewed", enterpriseDomain: "github.example" } });
    await expect(adapter.toAuth(credential)).resolves.toEqual({ apiKey: "access", headers: { authorization: "Bearer access", "x-github": null }, baseUrl: "https://api.githubcopilot.com" });
  });

  it("rejects a cancelled prompt and cleans its abort listener after a callback failure", async () => {
    const controller = new AbortController();
    const adapter = createPiOAuthAdapter({ ...provider(), auth: { oauth: { ...provider().auth!.oauth!, async login(io) { controller.abort(); return io.prompt({ type: "text", message: "Code", signal: controller.signal }).then(() => ({ type: "oauth", access: "", refresh: "", expires: 0 })); } } } });
    await expect(adapter.authorize(interaction())).rejects.toThrow(/cancelled/);
    const failing = createPiOAuthAdapter({ ...provider(), auth: { oauth: { ...provider().auth!.oauth!, async login() { throw new Error("callback failed"); } } } });
    await expect(failing.authorize(interaction())).rejects.toThrow("callback failed");
  });
});
