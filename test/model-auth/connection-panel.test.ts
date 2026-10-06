import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ModelConnectionPanel from "../../model-auth/packages/vue/src/ModelConnectionPanel.vue";
import type { CredentialUsage, CredentialUsageWindow, ModelAuthProvider } from "../../model-auth/packages/vue/src/types";

const usage = (credentialId: string, windows: CredentialUsageWindow[]): CredentialUsage => ({ providerId: "oauth", credentialId, status: "ok", plan: "Pro", windows, balance: null, fetchedAtUtc: "2000-01-01T00:00:00.000Z", error: null });
const fixture = (): ModelAuthProvider[] => [
  { id: "oauth", name: "OAuth service", description: "OAuth", iconUrl: "https://assets.example.test/oauth.svg", authMethods: ["oauth"], available: true, models: ["o-model"], loadStrategy: "round-robin", oauthCredentials: [
    { id: "oauth-healthy", label: "Primary", account: "person@example.test", enabled: true, healthy: true, models: ["o-model"], usage: usage("oauth-healthy", [{ id: "w", label: "Weekly", usedPercent: 60, resetAt: null }, { id: "h", label: "Hourly", usedPercent: 10, resetAt: null }]) },
    { id: "oauth-second", label: "Second", enabled: true, healthy: true, models: ["o-model"] },
    { id: "oauth-disabled", label: "Paused", enabled: false, healthy: false, models: ["o-model"], usage: usage("oauth-disabled", [{ id: "w", label: "Weekly", usedPercent: 99, resetAt: null }]) },
  ] },
  { id: "key", name: "Key service", description: "API Key", authMethods: ["api-key"], available: true, models: ["k-model"], loadStrategy: "failover", apiKeyCredentials: [
    { id: "key-unhealthy", label: "Workspace", enabled: true, healthy: false, models: ["k-model"] },
  ] },
  { id: "offline", name: "Offline service", description: "Not installed", authMethods: ["oauth"], available: false, unavailableReason: "Host integration unavailable", models: [], oauthCredentials: [
    { id: "offline-account", label: "Unavailable account", enabled: true, healthy: false, models: [] },
  ] },
];

let apps: App[] = [];
afterEach(() => { apps.forEach(app => app.unmount()); apps = []; document.body.replaceChildren(); });

async function mount() {
  const state = reactive({ providers: fixture(), busy: false, error: null as string | null });
  const events: { name: string; payload?: unknown }[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const app = createApp(() => h(ModelConnectionPanel, {
    ...state, percentagePrecision: 0,
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
  it("collapses each card to a summary with counts, plan and lowest remaining", async () => {
    await mount();
    expect(document.querySelectorAll('[data-part="connection-card"]')).toHaveLength(3);
    expect(get<HTMLImageElement>('[data-provider-id="oauth"] img').src).toBe("https://assets.example.test/oauth.svg");
    expect(get('[data-provider-id="oauth"] [data-part="connection-summary"]').textContent).toBe("3 个账号 · 2 个可用 · Pro · 最低剩余 40%");
    expect(document.querySelector('[data-part="connection-account"]')).toBeNull();
    expect(document.querySelector('[data-part="connection-details"]')).toBeNull();
    expect(get('[data-provider-id="oauth"] [data-part="toggle-connection"]').getAttribute("aria-expanded")).toBe("false");
    expect(get('[data-provider-id="offline"]').textContent).toContain("Host integration unavailable");
    expect(document.querySelector('[data-part="connection-current-model"]')).toBeNull();
  });

  it("expands to every account with its own remaining value and without listing models", async () => {
    await mount();
    await click('[data-provider-id="oauth"] [data-part="toggle-connection"]');
    const toggle = get('[data-provider-id="oauth"] [data-part="toggle-connection"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(get('[data-part="connection-details"]'));
    const rows = [...document.querySelectorAll('[data-provider-id="oauth"] [data-part="connection-account"]')].map(row => row.textContent!);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Primary");
    expect(rows[0]).toContain("最低剩余 40%");
    expect(rows[1]).not.toContain("最低剩余");
    expect(rows[2]).toContain("已停用");
    expect(rows[2]).toContain("最低剩余 1%");
    expect(document.querySelector('[data-part="connection-models"], [data-part="models"]')).toBeNull();
    await click('[data-provider-id="oauth"] [data-part="toggle-connection"]');
    expect(document.querySelector('[data-part="connection-account"]')).toBeNull();
  });

  it("keeps the expanded state across provider refreshes", async () => {
    const { state } = await mount();
    await click('[data-provider-id="key"] [data-part="toggle-connection"]');
    state.providers = fixture();
    await nextTick();
    expect(get('[data-provider-id="key"] [data-part="toggle-connection"]').getAttribute("aria-expanded")).toBe("true");
    expect(get('[data-provider-id="key"] [data-part="connection-details"]').textContent).toContain("Workspace");
  });

  it("flags enabled accounts that need reconnecting", async () => {
    await mount();
    expect(get('[data-provider-id="key"] [data-part="connection-attention"]').textContent).toBe("需要重新连接");
    expect(document.querySelector('[data-provider-id="oauth"] [data-part="connection-attention"]')).toBeNull();
  });

  it("renders only credential metadata and never adds a secret input or fixture secret", async () => {
    const { state } = await mount();
    Object.assign(state.providers[1]!.apiKeyCredentials![0] as object, { apiKey: "fixture-secret-must-not-render" });
    await nextTick();
    expect(document.body.textContent).not.toContain("fixture-secret-must-not-render");
    Object.assign(state.providers[1]!.apiKeyCredentials![0] as object, { secret: "fixture-secret-must-not-render" });
    await nextTick();
    expect(document.body.textContent).not.toContain("fixture-secret-must-not-render");
    expect(document.querySelector('[data-part="connections-panel"] input')).toBeNull();
  });

  it("never renders model lists or the load strategy", async () => {
    await mount();
    for (const id of ["oauth", "key", "offline"]) await click(`[data-provider-id="${id}"] [data-part="toggle-connection"]`);
    expect(document.querySelector('[data-part="connection-models"], [data-part="models"], [data-part="model-search"]')).toBeNull();
    expect(document.body.textContent).not.toContain("负载策略");
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
    await click('[data-provider-id="oauth"] [data-part="toggle-connection"]');
    state.providers[0]!.oauthCredentials![0]!.enabled = false;
    state.providers[0]!.oauthCredentials!.push({ id: "new-account", label: "Second account", enabled: true, healthy: true, models: ["o-model"] });
    state.error = "Refresh failed";
    await nextTick();
    expect(get('[data-provider-id="oauth"]').textContent).toContain("Second account");
    expect(get('[data-provider-id="oauth"]').textContent).toContain("已停用");
    expect(get('[role="alert"]').textContent).toContain("Refresh failed");
    expect(document.querySelectorAll('[data-part="connection-card"]')).toHaveLength(3);
  });
});
