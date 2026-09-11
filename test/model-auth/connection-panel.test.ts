import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ModelConnectionPanel from "../../model-auth/packages/vue/src/ModelConnectionPanel.vue";
import type { ModelAuthProvider } from "../../model-auth/packages/vue/src/types";

const fixture = (): ModelAuthProvider[] => [
  { id: "oauth", name: "OAuth service", description: "OAuth", authMethods: ["oauth"], available: true, models: ["o-model"], loadStrategy: "weighted-round-robin", oauthCredentials: [
    { id: "oauth-healthy", label: "Primary", account: "person@example.test", enabled: true, healthy: true, weight: 2, models: ["o-model"] },
    { id: "oauth-disabled", label: "Paused", enabled: false, healthy: false, weight: 3, models: ["o-model"] },
  ] },
  { id: "key", name: "Key service", description: "API Key", authMethods: ["api-key"], available: true, models: ["k-model"], loadStrategy: "failover", apiKeyCredentials: [
    { id: "key-unhealthy", label: "Workspace", enabled: true, healthy: false, weight: 1, models: ["k-model"] },
  ] },
  { id: "offline", name: "Offline service", description: "Not installed", authMethods: ["oauth"], available: false, unavailableReason: "Host integration unavailable", models: [], oauthCredentials: [
    { id: "offline-account", label: "Unavailable account", enabled: true, healthy: false, weight: 1, models: [] },
  ] },
];

let apps: App[] = [];
afterEach(() => { apps.forEach(app => app.unmount()); apps = []; document.body.replaceChildren(); });

async function mount() {
  const state = reactive({ providers: fixture(), model: { providerId: "oauth", model: "o-model" }, busy: false, error: null as string | null });
  const events: { name: string; payload?: unknown }[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const app = createApp(() => h(ModelConnectionPanel, {
    ...state,
    onManage: (payload: unknown) => events.push({ name: "manage", payload }),
    onAdd: () => events.push({ name: "add" }),
    onRefresh: () => events.push({ name: "refresh" }),
  }));
  apps.push(app); app.mount(host); await nextTick();
  return { state, events };
}
const get = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
async function click(selector: string) { get(selector).click(); await nextTick(); }

describe("model connection panel", () => {
  it("lists saved OAuth and API-key accounts, including disabled, unhealthy and unavailable entries", async () => {
    await mount();
    expect(document.querySelectorAll('[data-part="connection-card"]')).toHaveLength(3);
    expect(get('[data-provider-id="oauth"]').textContent).toContain("Primary");
    expect(get('[data-provider-id="oauth"]').textContent).toContain("已停用");
    expect(get('[data-provider-id="key"]').textContent).toContain("需要重新连接");
    expect(get('[data-provider-id="offline"]').textContent).toContain("Host integration unavailable");
    expect(get('[data-part="connection-current-model"]').textContent).toContain("o-model");
  });

  it("renders only credential metadata and never adds a secret input or fixture secret", async () => {
    const { state } = await mount();
    Object.assign(state.providers[1]!.apiKeyCredentials![0] as object, { apiKey: "fixture-secret-must-not-render" });
    await nextTick();
    expect(document.body.textContent).not.toContain("fixture-secret-must-not-render");
    expect(document.querySelector('[data-part="connections-panel"] input')).toBeNull();
  });

  it("emits an exact management target plus add and refresh commands", async () => {
    const { events } = await mount();
    await click('[data-provider-id="key"] [data-part="view-connection"]');
    expect(events.at(-1)).toEqual({ name: "manage", payload: { providerId: "key", method: "api-key" } });
    await click('[data-part="add-connection"]');
    expect(events.at(-1)).toEqual({ name: "add" });
    await click('[data-part="refresh-connections"]');
    expect(events.at(-1)).toEqual({ name: "refresh" });
  });

  it("reacts to host state updates without dropping existing connection cards", async () => {
    const { state } = await mount();
    state.providers[0]!.oauthCredentials![0]!.enabled = false;
    state.providers[0]!.oauthCredentials!.push({ id: "new-account", label: "Second account", enabled: true, healthy: true, weight: 1, models: ["o-model"] });
    state.error = "Refresh failed";
    await nextTick();
    expect(get('[data-provider-id="oauth"]').textContent).toContain("Second account");
    expect(get('[data-provider-id="oauth"]').textContent).toContain("已停用");
    expect(get('[role="alert"]').textContent).toContain("Refresh failed");
    expect(document.querySelectorAll('[data-part="connection-card"]')).toHaveLength(3);
  });
});
