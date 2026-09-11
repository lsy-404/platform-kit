import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ModelAuthDialog from "../../model-auth/packages/vue/src/ModelAuthDialog.vue";
import { registerModelAuthElement } from "../../model-auth/packages/vue/src/custom-element";
import type { ModelAuthProvider } from "../../model-auth/packages/vue/src/types";

const fixtures = (): ModelAuthProvider[] => [
  { id: "provider-a", name: "Provider A", description: "Both methods", authMethods: ["oauth", "api-key"], available: true,
    models: ["shared", "disabled-only"], oauthModels: ["shared", "disabled-only"], apiKeyModels: ["shared"],
    oauthCredentials: [
      { id: "oauth-1", label: "Primary", enabled: true, healthy: true, weight: 1, models: ["shared"] },
      { id: "oauth-2", label: "Paused", enabled: false, healthy: true, weight: 2, models: ["disabled-only"] },
    ], apiKeyCredentials: [{ id: "key-1", label: "API", enabled: true, healthy: true, weight: 2, models: ["shared"] }] },
  { id: "unavailable", name: "Unavailable", description: "Missing runtime", authMethods: ["oauth", "api-key"], available: false, models: [] },
  { id: "workbuddy", name: "WorkBuddy", description: "Host OAuth", authMethods: ["oauth"], available: true, models: [], oauthCredentials: [] },
];
let mounted: App[] = [];
afterEach(() => { for (const app of mounted) app.unmount(); mounted = []; document.body.replaceChildren(); });

async function mount(extra: Record<string, unknown> = {}, slots?: Record<string, (...args: any[]) => any>) {
  const host = document.createElement("div"); document.body.append(host);
  const state = reactive({ open: true, providers: fixtures(), busy: false, error: null as string | null, ...extra });
  const events: { name: string; payload: unknown }[] = [];
  const on = (name: string) => (...payload: unknown[]) => events.push({ name, payload: payload.length === 1 ? payload[0] : payload });
  const app = createApp(() => h(ModelAuthDialog, {
    ...state, onClose: () => { events.push({ name: "close", payload: null }); state.open = false; },
    onAddApiKey: on("key"), onUpdateCredential: on("credential"), onUpdateProvider: on("provider"),
    onUpdateProviderStrategy: on("strategy"), onRefreshCatalog: on("refresh"),
    onRemoveApiKey: on("remove"), onSelectModel: on("model"),
    onQueryUsage: on("usage"), onRespondAuth: on("respond-auth"), onCancelAuth: on("cancel-auth"), onOpenAuthUrl: on("open-auth-url"),
    onReconnectOauth: (...payload: unknown[]) => { state.busy = true; on("reconnect-oauth")(...payload); },
    catalogStatus: { state: "ready", source: "models.dev", checkedAt: "2000-01-01T00:00:00.000Z" },
  }, slots));
  mounted.push(app); app.mount(host); await nextTick(); await nextTick();
  return { state, events, host };
}
const get = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
async function click(selector: string) { get(selector).click(); await nextTick(); await nextTick(); }
async function details(method = "oauth", provider = "provider-a") {
  await click('[data-part="method-' + method + '"]');
  await click('[data-provider-id="' + provider + '"]');
}
async function fill(selector: string, value: string) {
  const input = get<HTMLInputElement>(selector); input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true })); await nextTick();
}

function progress() {
  return [...document.querySelectorAll<HTMLElement>(".model-auth-progress-fill")].map(node => node.style.width);
}

function expectStage(title: string, caption: string, widths: string[]) {
  expect(get("h2").textContent).toBe(title);
  expect(get(".model-auth-step-caption").textContent).toBe(caption);
  expect(progress()).toEqual(widths);
}

describe("authentication dialog", () => {
  it("confirms verified authorization without any discovered models", async () => {
    const { state, events } = await mount();
    await details("oauth", "workbuddy");
    await click('[data-part="oauth-config"] button');
    state.providers[2]!.oauthCredentials = [{ id: "verified", label: "Verified", healthy: true, enabled: true, weight: 1 }];
    await nextTick();
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
    expect(document.querySelector('[part="models"]')).toBeNull();
    expect(get<HTMLButtonElement>('[data-part="confirm"]').disabled).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
    expect(events.some(event => event.name === "model")).toBe(false);
  });
  it("exposes four states and only confirms from the final state", async () => {
    const { state, events } = await mount();
    expectStage("选择方式", "0/3", ["0%", "0%", "0%"]);
    await click('[data-part="method-oauth"]');
    expectStage("选择提供商", "1/3", ["100%", "0%", "0%"]);
    await click('[data-provider-id="workbuddy"]');
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    expect(document.querySelector('[data-part="confirm"]')).toBeNull();
    await click('[data-part="oauth-config"] button');
    state.providers[2]!.models = ["test-model"];
    state.providers[2]!.oauthCredentials = [{ id: "verified", label: "Verified", healthy: true, enabled: true, weight: 1 }];
    await nextTick();
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
    expect(get('[data-part="confirmation-step"]')).toBeTruthy();
    expect(get('[data-part="authorization-result"]').textContent).toContain("凭据已验证并保存");
    expect(document.querySelector('[part="model-search"]')).toBeNull();
    expect(document.querySelector('[part="model-row"]')).toBeNull();
    expect(events.some(event => event.name === "model")).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)).toEqual({ name: "close", payload: null });
    expect(events.some(event => event.name === "model")).toBe(false);
  });

  it("keeps failed authorization at detail until authReady, idle, and error-free", async () => {
    const { state, events } = await mount();
    state.providers[0]!.apiKeyCredentials = [];
    await details("api-key");
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    await fill('input[type="password"]', "test-only-value");
    get("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextTick();
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    expect(document.querySelector('[data-part="confirm"]')).toBeNull();
    state.error = "验证失败";
    await nextTick();
    expect(document.querySelector('[data-part="confirm"]')).toBeNull();
    state.error = null;
    await fill('input[type="password"]', "retry-test-value");
    get("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    state.busy = true;
    state.providers[0]!.apiKeyCredentials = [{ id: "verified-key", label: "Verified", healthy: true, enabled: true, weight: 1, models: ["shared"] }];
    await nextTick();
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeNull();
    state.busy = false;
    state.error = null;
    await nextTick();
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
    expect(events.some(event => event.name === "model")).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
  });

  it("keeps a healthy account at detail until an authorization action is armed", async () => {
    const { state } = await mount();
    await details("oauth", "provider-a");
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    state.providers[0]!.models = ["shared"];
    await nextTick();
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    expect(document.querySelector('[data-part="continue-confirmation"]')).toBeTruthy();
  });

  it("advances after reconnect only when the host reports verified metadata", async () => {
    const { state, events } = await mount();
    await details("oauth", "provider-a");
    await click('[data-part="oauth-credential"] .model-auth-secondary');
    expect(events.at(-1)).toEqual({ name: "reconnect-oauth", payload: ["provider-a", "oauth-1"] });
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    state.providers[0]!.models = ["reconnected"];
    state.busy = false;
    await nextTick();
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
  });

  it("returns from confirmation to detail and continues only on explicit request", async () => {
    const { state } = await mount();
    await details("oauth", "workbuddy");
    await click('[data-part="oauth-config"] button');
    state.providers[2]!.models = ["test-model"];
    state.providers[2]!.oauthCredentials = [{ id: "verified", label: "Verified", healthy: true, enabled: true, weight: 1 }];
    await nextTick();
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
    await click('[data-part="back"]');
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    state.providers[2]!.models = ["changed-without-action"];
    await nextTick();
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    await click('[data-part="continue-confirmation"]');
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
  });

  it("moves back to detail when an authorized account is revoked", async () => {
    const { state } = await mount();
    await details("oauth", "provider-a");
    await click('[data-part="oauth-config"] button');
    state.providers[0]!.models = ["shared"];
    await nextTick();
    expectStage("确认", "3/3", ["100%", "100%", "100%"]);
    state.providers[0]!.oauthCredentials = [];
    await nextTick();
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    await click('[data-part="back"]');
    expectStage("选择提供商", "1/3", ["100%", "0%", "0%"]);
  });

  it("replaces auth choices with searchable grouped providers and follows visible keyboard order", async () => {
    const { events } = await mount();
    expect(document.querySelectorAll('[data-part="method-list"] button')).toHaveLength(2);
    await click('[data-part="method-oauth"]');
    expect(document.querySelector('[data-part="method-list"]')).toBeNull();
    expect(document.activeElement).toBe(get('[data-part="search"]'));
    await click('[data-part="refresh-catalog"]');
    expect(events.at(-1)?.name).toBe("refresh");
    const search = get('[data-part="search"]');
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    expect(get("h2").textContent).toBe("完成授权");
    expect(get('[data-part="detail"] strong').textContent).toBe("WorkBuddy");
    await click('[data-part="back"]');
    await fill('[data-part="search"]', "Unavailable");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    expect(get<HTMLButtonElement>('[data-part="oauth-config"] button').disabled).toBe(true);
  });

  it("keeps the provider search focus ring inside the fixed header while only the list scrolls", async () => {
    await mount();
    await click('[data-part="method-oauth"]');
    const step = get<HTMLElement>('[data-part="provider-step"]');
    const search = get<HTMLInputElement>('[data-part="search"]');
    const list = get<HTMLElement>('[part="provider-list"]');
  const stylesheet = readFileSync(resolve(import.meta.dirname, "../../model-auth/packages/vue/src/style.css"), "utf8");
    expect(stylesheet).toContain(".model-auth-provider-step { grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden; padding-top: 4px; }");
    expect(stylesheet).toContain(".model-auth-provider-list { min-height: 0; overflow: auto; padding: 2px; margin: -2px; }");
    expect(step.contains(search)).toBe(true);
    expect(list).toBeTruthy();
    search.focus();
    expect(document.activeElement).toBe(search);
  });

  it("clears secrets on submission and navigation, blocks unavailable/busy submission, and confirms removal", async () => {
    const { events, state } = await mount();
    state.providers[0]!.apiKeyCredentials![0]!.healthy = false;
    await details("api-key");
    await fill('[data-part="api-key-form"] input[type="text"]', "Work");
    await fill('input[type="password"]', "test-only-value");
    get("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await nextTick();
    expect(events.at(-1)).toEqual({ name: "key", payload: { providerId: "provider-a", label: "Work", apiKey: "test-only-value" } });
    expect(get<HTMLInputElement>('input[type="password"]').value).toBe("");
    await fill('input[type="password"]', "discard-on-back");
    await click('[data-part="back"]'); await click('[data-provider-id="provider-a"]');
    expect(get<HTMLInputElement>('input[type="password"]').value).toBe("");
    state.busy = true; await nextTick(); expect(get<HTMLButtonElement>('form button[type="submit"]').disabled).toBe(true);
    state.busy = false; await nextTick();
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.filter(event => event.name === "remove")).toHaveLength(0);
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.at(-1)).toEqual({ name: "remove", payload: ["provider-a", "key-1"] });
    await click('[data-part="back"]'); await click('[data-provider-id="unavailable"]');
    expect(get<HTMLInputElement>('input[type="password"]').disabled).toBe(true);
  });

  it("keeps credential toggles and weights without strategy UI", async () => {
    const { events, state } = await mount();
    state.providers[0]!.oauthCredentials![0]!.healthy = false;
    await details();
    expectStage("完成授权", "2/3", ["100%", "100%", "0%"]);
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    expect(document.querySelector('[aria-haspopup="listbox"]')).toBeNull();
    const toggle = get<HTMLInputElement>('[data-part="oauth-credential"] input[role="switch"]');
    toggle.checked = false; toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "provider-a", credentialId: "oauth-1", enabled: false, weight: 1 } });
    const weight = get<HTMLInputElement>('input[type="number"]');
    weight.value = "0"; weight.dispatchEvent(new Event("change", { bubbles: true })); await nextTick();
    expect(get('[role="alert"]').textContent).toContain("1–100");
    state.providers[0]!.oauthEnabled = false; await nextTick();
    expect(get<HTMLButtonElement>('[data-part="oauth-config"] button').disabled).toBe(true);
  });

  it("edits per-key extend metadata and exposes a usage query action", async () => {
    const { events, state } = await mount();
    state.providers[0]!.usageEnabled = true;
    await details("api-key");
    await click('[data-part="credential-extend"] summary');
    const textarea = get<HTMLTextAreaElement>('[data-part="credential-extend"] textarea');
    textarea.value = '{"region":"us","priority":2}';
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "provider-a", credentialId: "key-1", enabled: true, weight: 2, extend: { region: "us", priority: 2 } } });
    await click('[data-part="query-usage"]');
    expect(events.at(-1)).toEqual({ name: "usage", payload: ["provider-a", "key-1"] });
  });

  it("renders a dynamic authentication prompt and returns the host response", async () => {
    const { events } = await mount({ auth: { status: "running", loginId: "login-1", notices: [{ type: "auth_url", url: "https://auth.example.test/login", instructions: "在浏览器中继续" }], prompt: { promptId: "prompt-1", prompt: { type: "manual_code", message: "输入验证码" } }, error: null } });
    expect(get('[data-part="auth-interaction"]').textContent).toContain("在浏览器中继续");
    await click('[data-part="auth-interaction"] button');
    expect(events.at(-1)).toEqual({ name: "open-auth-url", payload: "https://auth.example.test/login" });
    await fill('[data-part="auth-interaction"] input', "code");
    await click('[data-part="auth-interaction"] button.model-auth-primary');
    expect(events.at(-1)).toEqual({ name: "respond-auth", payload: { loginId: "login-1", promptId: "prompt-1", value: "code" } });
  });

  it("traps focus, closes once on Escape and restores the trigger", async () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const { events } = await mount();
    const first = get('[data-part="close"]'), last = get('[data-part="method-api-key"]');
    last.focus(); last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    await click('[data-part="method-api-key"]');
    get('[data-part="search"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await nextTick(); await nextTick();
    expect(events.filter(event => event.name === "close")).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the native top-layer modal lifecycle through transformed hosts and restores focus after exit", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const { state, host } = await mount({ open: false });
    host.style.cssText = "transform: translateZ(0); overflow: hidden; filter: blur(0);";
    state.open = true; await nextTick(); await nextTick();
    const nativeDialog = get<HTMLDialogElement>('[data-part="dialog"]');
    expect(showModal).toHaveBeenCalledOnce();
    expect(nativeDialog.open).toBe(true);
    nativeDialog.dispatchEvent(new AnimationEvent("animationend", { animationName: "model-auth-modal-enter" })); await nextTick();
    expect(document.activeElement).toBe(get("h2"));
    state.open = false; await nextTick();
    expect(nativeDialog.dataset.state).toBe("closing");
    nativeDialog.dispatchEvent(new AnimationEvent("animationend", { animationName: "model-auth-modal-exit" })); await nextTick();
    expect(document.querySelector('[data-part="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    showModal.mockRestore();
  });

  it("keeps back and close in a separate top bar without visible segment names", async () => {
    await mount();
    await details();
    const navigation = get('[data-part="navigation"]');
    expect(get('[data-part="back"]').parentElement).toBe(navigation);
    expect(get('[data-part="close"]').parentElement).toBe(navigation);
    expect(document.querySelector(".model-auth-progress-labels")).toBeNull();
    expect(get(".model-auth-step-caption").textContent).toBe("2/3");
    expect(document.querySelectorAll(".model-auth-progress-segment")).toHaveLength(3);
    expect(get("h2").parentElement).toBe(navigation);
    expect(document.querySelector(".model-auth-eyebrow")).toBeNull();
    expect(navigation.querySelector("p")).toBeNull();
    await click('[data-part="back"]');
    expect(document.querySelector('[data-part="catalog-status"]')).toBeNull();
    expect(get('[data-part="provider-step"]').textContent).not.toContain("models.dev");
    expect(get('[data-part="provider-step"]').textContent).not.toContain("2000-01-01");
  });

  it("keeps the active step during exit and preserves the original trigger across a quick reopen", async () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const { state } = await mount();
    await details();
    state.open = false; await nextTick();
    const nativeDialog = get<HTMLDialogElement>('[data-part="dialog"]');
    expect(nativeDialog.dataset.state).toBe("closing");
    expect(document.querySelector('[data-part="detail"]')).toBeTruthy();
    state.open = true; await nextTick();
    state.open = false; await nextTick();
    nativeDialog.dispatchEvent(new AnimationEvent("animationend", { animationName: "model-auth-modal-exit" })); await nextTick();
    expect(document.activeElement).toBe(trigger);
  });

  it("reopens at the method state after a completed close", async () => {
    const { state } = await mount();
    await details("oauth", "provider-a");
    state.open = false; await nextTick();
    const nativeDialog = get<HTMLDialogElement>('[data-part="dialog"]');
    nativeDialog.dispatchEvent(new AnimationEvent("animationend", { animationName: "model-auth-modal-exit" })); await nextTick();
    state.open = true; await nextTick(); await nextTick();
    expectStage("选择方式", "0/3", ["0%", "0%", "0%"]);
  });

  it("supports unstyled appearance, message overrides and slots without losing navigation", async () => {
    await mount({ styled: false, messages: { addConnection: "Connect a model" } }, { "method-card": ({ method }) => h("span", "Custom " + method) });
    expect(get("h2").textContent).toBe("Connect a model");
    expect(document.querySelector(".model-auth-styled")).toBeNull();
    await click('[data-part="method-oauth"]');
    expect(document.querySelector('[data-part="provider-step"]')).toBeTruthy();
  });

  it("registers a standalone element with shadow styles and working dialog focus", async () => {
    registerModelAuthElement("test-model-auth");
    registerModelAuthElement("test-model-auth");
    const element = document.createElement("test-model-auth") as HTMLElement & { open: boolean; providers: ModelAuthProvider[] };
    element.providers = fixtures(); element.open = true; document.body.append(element);
    await nextTick(); await nextTick();
    const shadow = element.shadowRoot!;
    expect(shadow.querySelector("style")?.textContent).toContain(".model-auth-styled");
    expect(shadow.querySelector('[part="dialog"]')).toBeTruthy();
    expect(shadow.querySelector<HTMLDialogElement>('[part="dialog"]')?.open).toBe(true);
    const last = shadow.querySelector<HTMLElement>('[data-part="method-api-key"]')!;
    last.focus(); last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(shadow.activeElement).toBe(shadow.querySelector('[data-part="close"]'));
    let selected = "";
    element.addEventListener("authorize-oauth", (event) => { selected = (event as CustomEvent).detail[0]; });
    shadow.querySelector<HTMLElement>('[data-part="method-oauth"]')!.click(); await nextTick();
    shadow.querySelector<HTMLElement>('[data-provider-id="provider-a"]')!.click(); await nextTick();
    shadow.querySelector<HTMLElement>('[data-part="oauth-config"] button')!.click();
    expect(selected).toBe("provider-a");
    element.remove(); await nextTick();
  });
});
