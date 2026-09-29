import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ModelAuthDialog from "../../model-auth/packages/vue/src/ModelAuthDialog.vue";
import type { ModelAuthProvider } from "../../model-auth/packages/vue/src/types";

const providers = (): ModelAuthProvider[] => [
  { id: "oauth", name: "OAuth provider", description: "OAuth", authMethods: ["oauth"], available: true, models: ["o-model"], loadStrategy: "round-robin", oauthCredentials: [{ id: "account", label: "Primary", account: "user@example.test", enabled: true, healthy: true, models: ["o-model"] }] },
  { id: "key", name: "Key provider", description: "API key", authMethods: ["api-key"], available: true, models: ["k-model"], apiKeyCredentials: [{ id: "key-1", label: "Service key", enabled: false, healthy: false, models: ["k-model"] }] },
  { id: "offline", name: "Offline", description: "Unavailable", authMethods: ["oauth"], available: false, unavailableReason: "Host unavailable", models: [], oauthCredentials: [{ id: "offline-1", label: "Offline account", enabled: true, healthy: false }] },
];

let apps: App[] = [];
afterEach(() => { apps.forEach(app => app.unmount()); apps = []; document.body.replaceChildren(); });

async function mount(initialConnection: { providerId: string; method: "oauth" | "api-key" } | null, extra: Record<string, unknown> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const state = reactive({ open: true, providers: providers(), initialConnection, busy: false, ...extra });
  const events: { name: string; payload: unknown }[] = [];
  const on = (name: string) => (...payload: unknown[]) => events.push({ name, payload: payload.length === 1 ? payload[0] : payload });
  const app = createApp(() => h(ModelAuthDialog, { ...state, onClose: on("close"), onReconnectOauth: on("reconnect"), onUpdateCredential: on("credential"), onRemoveOauth: on("remove-oauth"), onRemoveApiKey: on("remove-key"), onUpdateProviderStrategy: on("strategy"), onRefreshCatalog: on("refresh") }));
  apps.push(app); app.mount(host); await nextTick(); await nextTick();
  return { state, events };
}
const get = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
async function click(selector: string) { get(selector).click(); await nextTick(); await nextTick(); }

describe("connection detail dialog", () => {
  it("lists saved models as a read-only list without any current-model marker", async () => {
    const { state, events } = await mount({ providerId: "oauth", method: "oauth" });
    state.providers[0]!.oauthCredentials![0]!.models = ["o-model", "second-model"];
    await nextTick();
    const row = get('[data-model-id="second-model"]');
    expect(row.tagName).toBe("LI");
    expect(row.getAttribute("aria-pressed")).toBeNull();
    row.click(); await nextTick();
    expect(document.querySelector('[data-part="connection-policy"] button[data-model-id]')).toBeNull();
    expect(events.some(event => event.name !== "close" && event.name !== "refresh")).toBe(false);
    expect(get<HTMLDialogElement>('[data-part="dialog"]').open).toBe(true);
  });

  it("falls back to provider models without eligible credentials and unions credential models", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    const provider = state.providers[0]!;
    provider.models = ["catalog-only"];
    provider.oauthCredentials = [
      { id: "ok", label: "Ready", enabled: true, healthy: true, models: ["ready-model"] },
      { id: "disabled", label: "Disabled", enabled: false, healthy: true, models: ["disabled-model", "ready-model"] },
      { id: "bad", label: "Unhealthy", enabled: true, healthy: false },
    ];
    await nextTick();
    const ids = [...document.querySelectorAll('[data-part="model-row"]')].map(row => row.getAttribute("data-model-id"));
    expect(ids).toEqual(["catalog-only", "ready-model", "disabled-model"]);
    provider.oauthCredentials = [{ id: "disabled", label: "Disabled", enabled: false, healthy: true }];
    provider.available = false; await nextTick();
    expect(get('[data-part="connection-policy"]').textContent).toContain("catalog-only");
  });

  it("uses method models over the catalog and shows an empty state", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    const provider = state.providers[0]!;
    provider.oauthModels = ["method-model"];
    await nextTick();
    expect([...document.querySelectorAll('[data-part="model-row"]')].map(row => row.textContent)).toEqual(["method-model", "o-model"]);
    provider.oauthModels = []; provider.models = []; provider.oauthCredentials![0]!.models = [];
    await nextTick();
    expect(document.querySelector('[data-part="model-row"]')).toBeNull();
    expect(get('[data-part="models"]').textContent).toContain("没有可用模型");
  });

  it("searches long model lists only when there are more than eight models", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    expect(document.querySelector('[data-part="model-search"]')).toBeNull();
    state.providers[0]!.models = Array.from({ length: 12 }, (_, index) => "model-" + index);
    await nextTick();
    const input = get<HTMLInputElement>('[data-part="model-search"]');
    input.value = "model-1"; input.dispatchEvent(new Event("input", { bubbles: true })); await nextTick();
    expect(document.querySelectorAll('[data-part="model-row"]')).toHaveLength(3);
  });

  it("closes the strategy overlay from its trigger and keeps it out of layout flow", async () => {
    await mount({ providerId: "oauth", method: "oauth" });
    const trigger = get<HTMLButtonElement>('[part="strategy"] > button');
    await click('[part="strategy"] > button');
    const menu = get<HTMLElement>('[part="strategy-menu"]');
    expect(menu.style.top).toBeTruthy();
    expect(menu.style.left).toBeTruthy();
    await click('[part="strategy"] > button');
    expect(document.querySelector('[part="strategy-menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses only the current authentication method and preserves explicit four-stage confirmation", async () => {
    const { state, events } = await mount(null);
    const provider = state.providers[0]!;
    provider.authMethods = ["oauth", "api-key"];
    provider.apiKeyCredentials = [{ id: "api", label: "Key", enabled: true, healthy: true, models: ["key-only"] }];
    await click('[data-part="method-oauth"]');
    await click('[data-provider-id="oauth"]');
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    await click('[data-part="continue-confirmation"]');
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeTruthy();
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    expect(events.some(event => event.name === "close")).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
  });

  it("opens OAuth metadata and policy directly, without wizard progress or a current model", async () => {
    await mount({ providerId: "oauth", method: "oauth" });
    expect(get("h2").textContent).toBe("接入信息");
    expect(document.querySelector('[part="progress"]')).toBeNull();
    expect(document.querySelector('[data-part="back"]')).toBeNull();
    expect(get('[data-part="connection-info"]').classList).toContain("model-auth-connection-detail");
    expect(get('[data-part="oauth-credential"]').textContent).toContain("user@example.test");
    expect(get('[data-part="connection-policy"]').textContent).toContain("o-model");
    expect(get('[data-part="connection-policy"]').textContent).not.toContain("当前使用");
    expect(document.querySelector('[data-part="continue-confirmation"]')).toBeNull();
  });

  it("keeps reconnect in detail after a successful host refresh", async () => {
    const { state, events } = await mount({ providerId: "oauth", method: "oauth" });
    await click('[data-part="oauth-credential"] [data-part="reconnect"]');
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
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "key", credentialId: "key-1", enabled: true } });
    await click('[data-part="api-key-credential"] .model-auth-danger');
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.at(-1)).toEqual({ name: "remove-key", payload: ["key", "key-1"] });
    await click('[part="strategy"] button');
    await click('[part="strategy-menu"] button:nth-child(2)');
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
