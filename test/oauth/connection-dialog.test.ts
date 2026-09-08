import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ModelAuthDialog from "../../oauth/packages/vue/src/ModelAuthDialog.vue";
import type { ModelAuthProvider } from "../../oauth/packages/vue/src/types";

const providers = (): ModelAuthProvider[] => [
  { id: "oauth", name: "OAuth provider", description: "OAuth", authMethods: ["oauth"], available: true, models: ["o-model"], loadStrategy: "weighted-round-robin", oauthCredentials: [{ id: "account", label: "Primary", account: "user@example.test", enabled: true, healthy: true, weight: 2, models: ["o-model"] }] },
  { id: "key", name: "Key provider", description: "API key", authMethods: ["api-key"], available: true, models: ["k-model"], apiKeyCredentials: [{ id: "key-1", label: "Service key", enabled: false, healthy: false, weight: 1, models: ["k-model"] }] },
  { id: "offline", name: "Offline", description: "Unavailable", authMethods: ["oauth"], available: false, unavailableReason: "Host unavailable", models: [], oauthCredentials: [{ id: "offline-1", label: "Offline account", enabled: true, healthy: false, weight: 1 }] },
];

let apps: App[] = [];
afterEach(() => { apps.forEach(app => app.unmount()); apps = []; document.body.replaceChildren(); });

async function mount(initialConnection: { providerId: string; method: "oauth" | "api-key" } | null, extra: Record<string, unknown> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const state = reactive({ open: true, providers: providers(), initialConnection, model: { providerId: "oauth", model: "o-model" }, busy: false, ...extra });
  const events: { name: string; payload: unknown }[] = [];
  const on = (name: string) => (...payload: unknown[]) => events.push({ name, payload: payload.length === 1 ? payload[0] : payload });
  const app = createApp(() => h(ModelAuthDialog, { ...state, onClose: on("close"), onSelectModel: on("model"), onReconnectOauth: on("reconnect"), onUpdateCredential: on("credential"), onRemoveOauth: on("remove-oauth"), onRemoveApiKey: on("remove-key"), onUpdateProviderStrategy: on("strategy"), onRefreshCatalog: on("refresh") }));
  apps.push(app); app.mount(host); await nextTick(); await nextTick();
  return { state, events };
}
const get = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
async function click(selector: string) { get(selector).click(); await nextTick(); await nextTick(); }

describe("connection detail dialog", () => {
  it("selects a saved verified model and reflects only host-confirmed active selection without closing", async () => {
    const { state, events } = await mount({ providerId: "oauth", method: "oauth" });
    state.providers[0]!.oauthCredentials![0]!.models = ["o-model", "second-model"];
    await nextTick();
    expect(get('[data-model-id="o-model"]').getAttribute("aria-pressed")).toBe("true");
    await click('[data-model-id="second-model"]');
    expect(events.at(-1)).toEqual({ name: "model", payload: { providerId: "oauth", model: "second-model" } });
    expect(get('[data-model-id="second-model"]').getAttribute("aria-pressed")).toBe("false");
    state.model = { providerId: "oauth", model: "second-model" };
    await nextTick();
    expect(get('[data-model-id="second-model"]').getAttribute("aria-pressed")).toBe("true");
    expect(get('[data-model-id="o-model"]').getAttribute("aria-pressed")).toBe("false");
    expect(get<HTMLDialogElement>('[data-part="dialog"]').open).toBe(true);
    expect(events.some(event => event.name === "close")).toBe(false);
  });

  it("keeps unavailable saved model metadata visible but excludes catalog-only and ineligible selection", async () => {
    const { state, events } = await mount({ providerId: "oauth", method: "oauth" });
    const provider = state.providers[0]!;
    provider.models = ["catalog-only"];
    provider.oauthCredentials = [
      { id: "ok", label: "Ready", enabled: true, healthy: true, weight: 1, models: ["ready-model"] },
      { id: "disabled", label: "Disabled", enabled: false, healthy: true, weight: 1, models: ["disabled-model"] },
      { id: "bad", label: "Unhealthy", enabled: true, healthy: false, weight: 1, models: ["bad-model"] },
      { id: "cooling", label: "Cooling", enabled: true, healthy: true, weight: 1, models: ["cooling-model"], cooldownUntilUtc: "2999-01-01T00:00:00Z" },
      { id: "invalid", label: "Invalid cooldown", enabled: true, healthy: true, weight: 1, models: ["invalid-model"], cooldownUntilUtc: "invalid" },
      { id: "weight", label: "Invalid weight", enabled: true, healthy: true, weight: 0, models: ["weight-model"] },
    ];
    await nextTick();
    expect(document.querySelector('[data-model-id="catalog-only"]')).toBeNull();
    for (const name of ["disabled", "bad", "cooling", "invalid", "weight"]) {
      const button = get<HTMLButtonElement>('[data-model-id="' + name + '-model"]');
      expect(button.disabled).toBe(true); button.click();
    }
    expect(events.some(event => event.name === "model")).toBe(false);
    expect(get<HTMLButtonElement>('[data-model-id="ready-model"]').disabled).toBe(false);
    provider.oauthEnabled = false; await nextTick();
    expect(get<HTMLButtonElement>('[data-model-id="ready-model"]').disabled).toBe(true);
    provider.oauthEnabled = true; provider.available = false; await nextTick();
    expect(get<HTMLButtonElement>('[data-model-id="ready-model"]').disabled).toBe(true);
    expect(get('[data-part="connection-info"]').textContent).toContain("ready-model");
    provider.available = true; state.busy = true; await nextTick();
    expect(get<HTMLButtonElement>('[data-model-id="ready-model"]').disabled).toBe(true);
  });

  it("selects only the current authentication method and preserves explicit four-stage confirmation", async () => {
    const { state, events } = await mount(null);
    const provider = state.providers[0]!;
    provider.authMethods = ["oauth", "api-key"];
    provider.apiKeyCredentials = [{ id: "api", label: "Key", enabled: true, healthy: true, weight: 1, models: ["key-only"] }];
    await click('[data-part="method-oauth"]');
    await click('[data-provider-id="oauth"]');
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    await click('[data-part="continue-confirmation"]');
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeTruthy();
    expect(document.querySelector('[data-model-id="key-only"]')).toBeNull();
    await click('[data-model-id="o-model"]');
    expect(events.at(-1)).toEqual({ name: "model", payload: { providerId: "oauth", model: "o-model" } });
    expect(events.some(event => event.name === "close")).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
  });

  it("opens OAuth metadata and policy directly, without wizard progress and without automatically selecting a model", async () => {
    const { events } = await mount({ providerId: "oauth", method: "oauth" });
    expect(get("h2").textContent).toBe("接入信息");
    expect(document.querySelector('[part="progress"]')).toBeNull();
    expect(document.querySelector('[data-part="back"]')).toBeNull();
    expect(get('[data-part="connection-info"]').classList).toContain("model-auth-connection-detail");
    expect(get('[data-part="oauth-credential"]').textContent).toContain("user@example.test");
    expect(get('[data-part="connection-policy"]').textContent).toContain("o-model");
    expect(get('[data-part="connection-policy"]').textContent).toContain("当前使用");
    expect(document.querySelector('[data-part="continue-confirmation"]')).toBeNull();
    expect(events.some(event => event.name === "model")).toBe(false);
  });

  it("keeps reconnect in detail after a successful host refresh", async () => {
    const { state, events } = await mount({ providerId: "oauth", method: "oauth" });
    await click('[data-part="oauth-credential"] .model-auth-secondary');
    expect(events.at(-1)).toEqual({ name: "reconnect", payload: ["oauth", "account"] });
    state.providers[0]!.oauthCredentials![0]!.healthy = true;
    await nextTick();
    expect(document.querySelector('[data-part="connection-info"]')).toBeTruthy();
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeNull();
  });

  it("supports disabled API credentials, confirmation deletion, and strategy changes", async () => {
    const { events } = await mount({ providerId: "key", method: "api-key" });
    const toggle = get<HTMLInputElement>('[data-part="api-key-credential"] input[role="switch"]');
    toggle.checked = true; toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "key", credentialId: "key-1", enabled: true, weight: 1 } });
    await click('[data-part="api-key-credential"] .model-auth-danger');
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.at(-1)).toEqual({ name: "remove-key", payload: ["key", "key-1"] });
    await click('[part="strategy"] button');
    await click('[part="strategy-menu"] button:nth-child(3)');
    expect(events.at(-1)).toEqual({ name: "strategy", payload: { providerId: "key", strategy: "failover" } });
  });

  it("shows unavailable providers without falling into the new-connection wizard", async () => {
    await mount({ providerId: "offline", method: "oauth" });
    expect(get('[data-part="connection-info"]').textContent).toContain("Host unavailable");
    expect(document.querySelector('[data-part="method-list"]')).toBeNull();
  });

  it("holds an empty target after its final account or provider disappears, then enters the wizard explicitly", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    state.providers.splice(0, 1); await nextTick();
    expect(get('[data-part="connection-empty"]').textContent).toContain("尚未接入账号");
    expect(document.querySelector('[data-part="method-list"]')).toBeNull();
    await click('[data-part="new-connection"]');
    expect(document.querySelector('[data-part="method-list"]')).toBeTruthy();
  });

  it("restores its target on close and reopen, while a dialog without a target keeps the four-stage flow", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    state.open = false; await nextTick();
    get<HTMLDialogElement>('[data-part="dialog"]').dispatchEvent(new AnimationEvent("animationend", { animationName: "model-auth-modal-exit" })); await nextTick();
    state.open = true; await nextTick(); await nextTick();
    expect(get("h2").textContent).toBe("接入信息");
    expect(document.querySelector('[part="progress"]')).toBeNull();
    const standard = await mount(null);
    expect([...document.querySelectorAll("h2")].at(-1)?.textContent).toBe("选择方式");
    expect(document.querySelector('[part="progress"]')).toBeTruthy();
    void standard;
  });
});
