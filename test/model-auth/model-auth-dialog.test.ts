import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ModelAuthDialog from "../../model-auth/packages/vue/src/ModelAuthDialog.vue";
import { providerIconUrl } from "../../model-auth/packages/vue/src/provider-icon";
import { registerModelAuthElement } from "../../model-auth/packages/vue/src/custom-element";
import type { ModelAuthProvider } from "../../model-auth/packages/vue/src/types";

const fixtures = (): ModelAuthProvider[] => [
  { id: "provider-a", name: "Provider A", description: "Both methods", authMethods: ["oauth", "api-key"], available: true,
    models: ["shared", "disabled-only"], oauthModels: ["shared", "disabled-only"], apiKeyModels: ["shared"],
    oauthCredentials: [
      { id: "oauth-1", label: "Primary", enabled: true, healthy: true, models: ["shared"] },
      { id: "oauth-2", label: "Paused", enabled: false, healthy: true, models: ["disabled-only"] },
    ], apiKeyCredentials: [{ id: "key-1", label: "API", enabled: true, healthy: true, models: ["shared"] }] },
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
    onAddApiKey: on("key"), onUpdateCredential: on("credential"), onReorderCredentials: on("reorder"), onUpdateProvider: on("provider"),
    onRefreshCatalog: on("refresh"),
    onRemoveApiKey: on("remove"),
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
  await click('[data-provider-id="' + provider + '"][data-auth-method="' + method + '"]');
}
async function fill(selector: string, value: string) {
  const input = get<HTMLInputElement>(selector); input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true })); await nextTick();
}

function progress() {
  return [...document.querySelectorAll<HTMLElement>(".model-auth-progress-fill")].map(node => node.style.width);
}

function expectStage(title: string, widths: string[]) {
  expect(get("h2").textContent).toBe(title);
  expect(progress()).toEqual(widths);
}

describe("authentication dialog", () => {
  it("accepts bundled same-origin app icons without trusting another app host", () => {
    const provider = { iconUrl: "iris-ui://app/assets/codex.svg" };
    expect(providerIconUrl(provider, "iris-ui://app/index.html")).toBe(provider.iconUrl);
    expect(providerIconUrl({ iconUrl: "./assets/codex.svg" }, "iris-ui://app/index.html")).toBe(provider.iconUrl);
    expect(providerIconUrl({ iconUrl: "iris-ui://other/assets/codex.svg" }, "iris-ui://app/index.html")).toBeNull();
    expect(providerIconUrl({ iconUrl: "data:image/svg+xml,<svg/>" }, "iris-ui://app/index.html")).toBeNull();
  });

  it("confirms verified authorization without any discovered models", async () => {
    const { state, events } = await mount();
    await details("oauth", "workbuddy");
    await click('[data-part="authorize"]');
    state.providers[2]!.oauthCredentials = [{ id: "verified", label: "Verified", healthy: true, enabled: true }];
    await nextTick();
    expectStage("确认", ["100%", "100%"]);
    expect(document.querySelector('[part="models"]')).toBeNull();
    expect(get<HTMLButtonElement>('[data-part="confirm"]').disabled).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
  });
  it("exposes provider, configuration and confirmation states and only confirms from the final state", async () => {
    const { state, events } = await mount();
    expectStage("选择提供商", ["0%", "0%"]);
    expectStage("选择提供商", ["0%", "0%"]);
    await click('[data-provider-id="workbuddy"]');
    expectStage("完成配置", ["100%", "0%"]);
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    expect(document.querySelector('[data-part="confirm"]')).toBeNull();
    await click('[data-part="authorize"]');
    state.providers[2]!.models = ["test-model"];
    state.providers[2]!.oauthCredentials = [{ id: "verified", label: "Verified", healthy: true, enabled: true }];
    await nextTick();
    expectStage("确认", ["100%", "100%"]);
    expect(get('[data-part="confirmation-step"]')).toBeTruthy();
    expect(get('[data-part="authorization-result"]').textContent).toContain("凭据已验证并保存");
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    await click('[data-part="confirm"]');
    expect(events.at(-1)).toEqual({ name: "close", payload: null });
  });

  it("renders built-in inline icons for mapped ids without any image request", async () => {
    const { state } = await mount();
    state.providers[2]!.id = "ollama"; await nextTick();
    const mark = get('[data-provider-id="ollama"] .model-auth-provider-mark');
    expect(mark.querySelector("svg")).toBeTruthy();
    expect(mark.querySelector("img")).toBeNull();
    expect(mark.innerHTML).not.toMatch(/favicon|src=|href="(?!data:image\/png;base64,)/);
  });

  it("renders the letter mark for unknown provider ids", async () => {
    const { state } = await mount();
    const mark = get('[data-provider-id="provider-a"] .model-auth-provider-mark');
    expect(mark.querySelector("svg")).toBeNull();
    expect(mark.querySelector("img")).toBeNull();
    expect(mark.textContent).toBe("P");
    expect(state.providers[0]!.id).toBe("provider-a");
  });

  it("prefers the host icon and falls back to the built-in icon after an image failure", async () => {
    const { state } = await mount();
    state.providers[2]!.iconUrl = "https://assets.example.com/workbuddy.svg"; await nextTick();
    const icon = get<HTMLImageElement>('[data-provider-id="workbuddy"] img');
    expect(icon.src).toBe("https://assets.example.com/workbuddy.svg");
    icon.dispatchEvent(new Event("error"));
    await nextTick();
    expect(document.querySelector('[data-provider-id="workbuddy"] img')).toBeNull();
    expect(get('[data-provider-id="workbuddy"] .model-auth-provider-mark svg')).toBeTruthy();
  });

  it("keeps failed authorization at detail until authReady, idle, and error-free", async () => {
    const { state, events } = await mount();
    state.providers[0]!.apiKeyCredentials = [];
    await details("api-key");
    expectStage("完成配置", ["100%", "0%"]);
    await fill('input[type="password"]', "test-only-value");
    get("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await nextTick();
    expectStage("完成配置", ["100%", "0%"]);
    expect(document.querySelector('[data-part="confirm"]')).toBeNull();
    state.error = "验证失败";
    await nextTick();
    expect(document.querySelector('[data-part="confirm"]')).toBeNull();
    state.error = null;
    await fill('input[type="password"]', "retry-test-value");
    get("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    state.busy = true;
    state.providers[0]!.apiKeyCredentials = [{ id: "verified-key", label: "Verified", healthy: true, enabled: true, models: ["shared"] }];
    await nextTick();
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeNull();
    state.busy = false;
    state.error = null;
    await nextTick();
    expectStage("确认", ["100%", "100%"]);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
  });

  it("keeps a healthy account at detail until an authorization action is armed", async () => {
    const { state } = await mount();
    await details("oauth", "provider-a");
    expectStage("完成配置", ["100%", "0%"]);
    state.providers[0]!.models = ["shared"];
    await nextTick();
    expectStage("完成配置", ["100%", "0%"]);
    expect(document.querySelector('[data-part="continue-confirmation"]')).toBeTruthy();
  });

  it("advances after reconnect only when the host reports verified metadata", async () => {
    const { state, events } = await mount();
    state.providers[0]!.oauthCredentials![0]!.healthy = false;
    await details("oauth", "provider-a");
    await click('[data-part="oauth-credential"] [data-part="reconnect"]');
    expect(events.at(-1)).toEqual({ name: "reconnect-oauth", payload: ["provider-a", "oauth-1"] });
    expectStage("完成配置", ["100%", "0%"]);
    state.providers[0]!.oauthCredentials![0]!.healthy = true;
    state.providers[0]!.models = ["reconnected"];
    state.busy = false;
    await nextTick();
    expectStage("确认", ["100%", "100%"]);
  });

  it("finishes from confirmation with the done button and no back button", async () => {
    const { state } = await mount();
    await details("oauth", "workbuddy");
    await click('[data-part="authorize"]');
    state.providers[2]!.models = ["test-model"];
    state.providers[2]!.oauthCredentials = [{ id: "verified", label: "Verified", healthy: true, enabled: true }];
    await nextTick();
    expectStage("确认", ["100%", "100%"]);
    expect(document.querySelector('[data-part="back"]')).toBeNull();
    expect(get('[data-part="confirm"]').textContent).toBe("完成");
    expect(get('[data-part="confirmation-step"] h3').textContent).toBe("WorkBuddy");
  });

  it("does not advance from detail when the catalog changes without a new credential", async () => {
    const { state } = await mount();
    await details("oauth", "workbuddy");
    state.providers[2]!.models = ["changed-without-action"];
    await nextTick();
    expectStage("完成配置", ["100%", "0%"]);
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeNull();
  });

  it("moves back to detail when an authorized account is revoked", async () => {
    const { state } = await mount();
    await details("oauth", "provider-a");
    await click('[data-part="authorize"]');
    state.providers[0]!.models = ["shared"];
    await nextTick();
    expectStage("确认", ["100%", "100%"]);
    state.providers[0]!.oauthCredentials = [];
    await nextTick();
    expectStage("完成配置", ["100%", "0%"]);
    await click('[data-part="back"]');
    expectStage("选择提供商", ["0%", "0%"]);
  });

  it("opens searchable mixed provider entries and follows visible keyboard order", async () => {
    await mount();
    expect(document.querySelector('[data-part="method-list"]')).toBeNull();
    expect([...document.querySelectorAll('.model-auth-row-main strong')].map(node => node.textContent)).toContain('Provider A');
    expect(document.querySelector('[data-part="method-list"]')).toBeNull();
    get('[data-part="search"]').focus();
    expect(document.activeElement).toBe(get('[data-part="search"]'));
    const search = get('[data-part="search"]');
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    expect(get("h2").textContent).toBe("完成配置");
    expect(get('[data-part="detail"] h3').textContent).toBe("WorkBuddy");
    await click('[data-part="back"]');
    await fill('[data-part="search"]', "Unavailable");
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    expect(get<HTMLButtonElement>('[data-part="authorize"]').disabled).toBe(true);
  });

  it("keeps the provider search focus ring inside the fixed header while only the list scrolls", async () => {
    await mount();
    const step = get<HTMLElement>('[data-part="provider-step"]');
    const search = get<HTMLInputElement>('[data-part="search"]');
    const list = get<HTMLElement>('[part="provider-list"]');
  const stylesheet = readFileSync(resolve(import.meta.dirname, "../../model-auth/packages/vue/src/style.css"), "utf8");
    expect(stylesheet).toMatch(/\.model-auth-provider-step \{[^}]*overflow: hidden/);
    expect(stylesheet).toMatch(/\.model-auth-provider-list \{[^}]*overflow: auto/);
    expect(stylesheet).not.toContain(".model-auth-select-menu { position: fixed;");
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
    await click('[data-part="back"]'); await details('api-key');
    expect(get<HTMLInputElement>('input[type="password"]').value).toBe("");
    state.busy = true; await nextTick(); expect(get<HTMLButtonElement>('form button[type="submit"]').disabled).toBe(true);
    state.busy = false; await nextTick();
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.filter(event => event.name === "remove")).toHaveLength(0);
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.at(-1)).toEqual({ name: "remove", payload: ["provider-a", "key-1"] });
    await click('[data-part="back"]'); await fill('[data-part="search"]', "Unavailable"); await details('api-key', 'unavailable');
    expect(get<HTMLInputElement>('input[type="password"]').disabled).toBe(true);
  });

  it("keeps credential toggles and ordering without strategy UI", async () => {
    const { events, state } = await mount();
    state.providers[0]!.oauthCredentials![0]!.healthy = false;
    await details();
    expectStage("完成配置", ["100%", "0%"]);
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    expect(document.querySelector('[aria-haspopup="listbox"]')).toBeNull();
    const toggle = get<HTMLInputElement>('[data-part="oauth-credential"] input[role="switch"]');
    toggle.checked = false; toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "provider-a", credentialId: "oauth-1", enabled: false } });
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(document.querySelector('[data-part="credential-position"]')).toBeNull();
    expect(document.querySelectorAll('[data-part="move-up"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-part="move-down"]')).toHaveLength(1);
    expect(get('[data-part="move-down"]').getAttribute("aria-label")).toBe("下移 Primary");
    await click('[data-part="move-down"]');
    expect(events.at(-1)).toEqual({ name: "reorder", payload: { providerId: "provider-a", method: "oauth", credentialIds: ["oauth-2", "oauth-1"] } });
    state.providers[0]!.oauthEnabled = false; await nextTick();
    expect(get<HTMLButtonElement>('[data-part="authorize"]').disabled).toBe(true);
  });

  it("edits per-key extend metadata and exposes a usage query action", async () => {
    const { events, state } = await mount();
    state.providers[0]!.usageEnabled = true;
    await details("api-key");
    get<HTMLDetailsElement>('[data-part="credential-settings"]').open = true; await nextTick();
    await click('[data-part="credential-extend"] summary');
    const textarea = get<HTMLTextAreaElement>('[data-part="credential-extend"] textarea');
    textarea.value = '{"region":"us","priority":2}';
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "provider-a", credentialId: "key-1", enabled: true, extend: { region: "us", priority: 2 } } });
    await click('[data-part="query-usage"]');
    expect(events.at(-1)).toEqual({ name: "usage", payload: ["provider-a", "key-1"] });
  });

  it("shows the credential secret by default, hides it on demand and saves only a changed value", async () => {
    const { events, state } = await mount();
    state.providers[0]!.apiKeyCredentials![0]!.secret = "sk-test-value";
    state.providers[0]!.oauthCredentials![0]!.secret = '{"access":"tok"}';
    await details("api-key");
    get<HTMLDetailsElement>('[data-part="credential-settings"]').open = true; await nextTick();
    const input = get<HTMLInputElement>('[data-part="credential-secret"] input');
    const save = get<HTMLButtonElement>('[data-part="save-secret"]');
    expect(input.type).toBe("text");
    expect(input.value).toBe("sk-test-value");
    expect(save.disabled).toBe(true);
    await click('[data-part="toggle-secret"]');
    expect(input.type).toBe("password");
    expect(get('[data-part="toggle-secret"]').getAttribute("aria-pressed")).toBe("true");
    await fill('[data-part="credential-secret"] input', "sk-test-changed");
    expect(save.disabled).toBe(false);
    await fill('[data-part="credential-secret"] input', "sk-test-value");
    expect(save.disabled).toBe(true);
    await fill('[data-part="credential-secret"] input', "   ");
    expect(save.disabled).toBe(true);
    await fill('[data-part="credential-secret"] input', " sk-test-changed ");
    await click('[data-part="save-secret"]');
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "provider-a", credentialId: "key-1", enabled: true, secret: "sk-test-changed" } });
    state.providers[0]!.apiKeyCredentials![0]!.secret = "sk-test-changed";
    await nextTick();
    expect(input.value).toBe("sk-test-changed");
    expect(get<HTMLButtonElement>('[data-part="save-secret"]').disabled).toBe(true);
    await fill('[data-part="credential-secret"] input', "sk-test-draft");
    state.providers[0]!.apiKeyCredentials![0]!.secret = "sk-test-rotated";
    await nextTick();
    expect(input.value).toBe("sk-test-rotated");
    await click('[data-part="back"]');
    await details("oauth");
    get<HTMLDetailsElement>('[data-part="credential-settings"]').open = true; await nextTick();
    const oauthInput = get<HTMLInputElement>('[data-part="credential-secret"] input');
    expect(oauthInput.type).toBe("text");
    expect(oauthInput.value).toBe('{"access":"tok"}');
  });

  it("omits the secret field unless the host supplies one", async () => {
    const { state } = await mount();
    await details("api-key");
    expect(document.querySelector('[data-part="credential-secret"]')).toBeNull();
    state.providers[0]!.apiKeyCredentials![0]!.secret = "";
    await nextTick();
    expect(get<HTMLInputElement>('[data-part="credential-secret"] input').value).toBe("");
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
    const first = get('[data-part="close"]'), last = [...document.querySelectorAll<HTMLElement>(".model-auth-provider-list button")].at(-1)!;
    last.focus(); last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
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
    expect(document.querySelector(".model-auth-step-caption")).toBeNull();
    expect(document.querySelectorAll(".model-auth-progress-segment")).toHaveLength(2);
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
    expectStage("选择提供商", ["0%", "0%"]);
  });

  it("supports unstyled appearance, message overrides and slots without losing navigation", async () => {
    await mount({ styled: false, messages: { chooseProvider: "Connect a model" } }, { "provider-row": ({ method }) => h("span", "Custom " + method) });
    expect(get("h2").textContent).toBe("Connect a model");
    expect(document.querySelector(".model-auth-styled")).toBeNull();
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
    const last = [...shadow.querySelectorAll<HTMLElement>(".model-auth-provider-list button")].at(-1)!;
    last.focus(); last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(shadow.activeElement).toBe(shadow.querySelector('[data-part="close"]'));
    let selected = "";
    element.addEventListener("authorize-oauth", (event) => { selected = (event as CustomEvent).detail[0]; });
    shadow.querySelector<HTMLElement>('[data-provider-id="provider-a"]')!.click(); await nextTick();
    shadow.querySelector<HTMLElement>('[data-part="authorize"]')!.click();
    expect(selected).toBe("provider-a");
    element.remove(); await nextTick();
  });
});


it("attaches optional usage login information to one API key and clears its secret drafts", async () => {
  const { events } = await mount({ providers: [{ id: "ollama-cloud", name: "Ollama", description: "", authMethods: ["api-key"], available: true, accountLogin: true, models: [], apiKeyCredentials: [] }] });
  expect(get('[data-provider-id="ollama-cloud"]').textContent).toContain("Ollama");
  await details("api-key", "ollama-cloud");
  expect(document.querySelector('[data-part="authorize"]')).toBeNull();
  get<HTMLDetailsElement>('[data-part="key-login-info"]').open = true;
  await fill('[data-part="api-key-form"] .model-auth-key-input input', 'api-key');
  await fill('[data-part="key-login-info"] input[autocomplete="username"]', ' owner@example.test ');
  await fill('[data-part="key-login-info"] input[type="password"]', 'test-password');
  get('[data-part="api-key-form"]').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await nextTick();
  expect(events.at(-1)).toEqual({ name: "key", payload: { providerId: "ollama-cloud", label: "", apiKey: "api-key", login: { username: "owner@example.test", password: "test-password" } } });
  expect(get<HTMLInputElement>('[data-part="key-login-info"] input[type="password"]').value).toBe("");
});


it("explicit false keeps OAuth and Key in the same provider list", async () => {
  await mount({ separateAuthMethods: false });
  expect(document.querySelector('[data-part="method-list"]')).toBeNull();
  expect(document.querySelector('[data-provider-id="provider-a"][data-auth-method="oauth"]')).toBeTruthy();
  expect(document.querySelector('[data-provider-id="provider-a"][data-auth-method="api-key"]')).toBeTruthy();
  expectStage("选择提供商", ["0%", "0%"]);
});

it("true starts with authentication choice, filters providers and supports every back step", async () => {
  await mount({ separateAuthMethods: true });
  expectStage("选择方式", ["0%", "0%", "0%"]);
  expect(document.querySelector('[data-part="provider-step"]')).toBeNull();
  await click('[data-part="method-api-key"]');
  expectStage("选择提供商", ["100%", "0%", "0%"]);
  expect(document.querySelector('[data-auth-method="oauth"]')).toBeNull();
  expect(document.querySelector('[data-provider-id="workbuddy"]')).toBeNull();
  await details("api-key");
  expectStage("完成配置", ["100%", "100%", "0%"]);
  await click('[data-part="back"]');
  await click('[data-part="back"]');
  expect(document.querySelector('[data-part="method-list"]')).toBeTruthy();
  await click('[data-part="method-oauth"]');
  expect(document.querySelector('[data-auth-method="api-key"]')).toBeNull();
  expect(document.querySelector('[data-provider-id="workbuddy"]')).toBeTruthy();
});

it("changing view mode resets new-connection navigation and clears secret drafts", async () => {
  const { state } = await mount({ separateAuthMethods: false });
  await details("api-key");
  await fill('[data-part="api-key-form"] input[type="password"]', "discarded-key");
  state.separateAuthMethods = true; await nextTick();
  expect(document.querySelector('[data-part="method-list"]')).toBeTruthy();
  await click('[data-part="method-api-key"]'); await details("api-key");
  expect(get<HTMLInputElement>('[data-part="api-key-form"] input[type="password"]').value).toBe("");
});

it("separated authentication does not add a choice page to an existing connection", async () => {
  await mount({ separateAuthMethods: true, initialConnection: { providerId: "provider-a", method: "api-key" } });
  expect(document.querySelector('[data-part="connection-info"]')).toBeTruthy();
  expect(document.querySelector('[data-part="method-list"]')).toBeNull();
  expect(document.querySelector('[part="progress"]')).toBeNull();
  expect(document.querySelector('[data-part="back"]')).toBeNull();
});

describe("provider picker groups", () => {
  const english = { signIn: "Sign in", apiKey: "API key", unavailable: "Unavailable", showAll: "Show all ({count})", showLess: "Show less", noProviders: "No matching providers" };
  const entry = (id: string, authMethods: ModelAuthProvider["authMethods"], extra: Partial<ModelAuthProvider> = {}): ModelAuthProvider =>
    ({ id, name: id, description: "", authMethods, available: true, models: [], ...extra });
  const rows = (group: string) => [...document.querySelectorAll<HTMLElement>('[data-part="' + group + '-group"] .model-auth-provider-row')].map(row => row.dataset.providerId);
  const groupOrder = () => [...document.querySelectorAll<HTMLElement>(".model-auth-provider-group")].map(node => node.dataset.part);
  const keydown = (key: string) => get('[data-part="search"]').dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const keyProviders = (count: number) => Array.from({ length: count }, (_, index) => entry("key-" + (index + 1), ["api-key"]));

  it("lists sign-in entries before API key entries before unavailable ones", async () => {
    await mount({ messages: english, providers: [
      entry("A", ["api-key"]), entry("B", ["oauth"]), entry("C", ["api-key"]), entry("D", ["oauth"]), entry("E", ["oauth"], { available: false }),
    ] });
    expect(groupOrder()).toEqual(["oauth-group", "api-key-group", "unavailable-group"]);
    expect([...document.querySelectorAll(".model-auth-group-label")].map(node => node.textContent)).toEqual(["Sign in", "API key", "Unavailable"]);
    expect([rows("oauth"), rows("api-key")]).toEqual([["B", "D"], ["A", "C"]]);
    expect(rows("unavailable")).toEqual([]);
    await click('[data-part="group-toggle"][data-group="unavailable"]');
    expect(rows("unavailable")).toEqual(["E"]);
  });

  it("puts providers with saved credentials first and keeps host order otherwise", async () => {
    const saved = [{ id: "c1", label: "Saved", enabled: true, healthy: true }];
    await mount({ providers: [entry("first", ["oauth"]), entry("second", ["oauth"], { oauthCredentials: saved }), entry("third", ["oauth"])] });
    expect(rows("oauth")).toEqual(["second", "first", "third"]);
  });

  it("shows eight entries per group and reveals the rest on request", async () => {
    await mount({ messages: english, providers: keyProviders(12) });
    expect(rows("api-key")).toEqual(Array.from({ length: 8 }, (_, index) => "key-" + (index + 1)));
    const toggle = get('[data-part="group-toggle"][data-group="api-key"]');
    expect(toggle.textContent).toBe("Show all (12)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click('[data-part="group-toggle"][data-group="api-key"]');
    expect(rows("api-key")).toHaveLength(12);
    expect(get('[data-part="group-toggle"][data-group="api-key"]').textContent).toBe("Show less");
    expect(get('[data-part="group-toggle"][data-group="api-key"]').getAttribute("aria-expanded")).toBe("true");
    await click('[data-part="group-toggle"][data-group="api-key"]');
    expect(rows("api-key")).toHaveLength(8);
  });

  it("drops the keyboard highlight when expanding a group moves the entries under it", async () => {
    const oauthProviders = Array.from({ length: 10 }, (_, index) => entry("sign-" + (index + 1), ["oauth"]));
    await mount({ providers: [...oauthProviders, entry("key-a", ["api-key"]), entry("key-b", ["api-key"])] });
    keydown("End"); await nextTick();
    expect(get(".model-auth-provider-row.focused").dataset.providerId).toBe("key-b");
    await click('[data-part="group-toggle"][data-group="oauth"]');
    expect(document.querySelector(".model-auth-provider-row.focused")).toBeNull();
  });

  it("drops the keyboard highlight when the provider list shrinks under it", async () => {
    const { state } = await mount({ providers: keyProviders(8) });
    keydown("End"); await nextTick();
    expect(get(".model-auth-provider-row.focused").dataset.providerId).toBe("key-8");
    state.providers = keyProviders(3); await nextTick();
    state.providers = keyProviders(8); await nextTick();
    expect(document.querySelector(".model-auth-provider-row.focused")).toBeNull();
  });

  it("does not truncate while searching and offers no toggle", async () => {
    const providers = [...Array.from({ length: 10 }, (_, index) => entry("match-" + index, ["api-key"])), entry("other-1", ["api-key"]), entry("other-2", ["api-key"])];
    await mount({ messages: english, providers });
    expect(rows("api-key")).toHaveLength(8);
    await fill('[data-part="search"]', "match");
    expect(rows("api-key")).toHaveLength(10);
    expect(document.querySelector('[data-part="group-toggle"]')).toBeNull();
  });

  it("includes unavailable matches when a search is active", async () => {
    await mount({ providers: [entry("alive", ["oauth"]), entry("gone", ["oauth"], { available: false })] });
    expect(rows("unavailable")).toEqual([]);
    await fill('[data-part="search"]', "gone");
    expect(rows("unavailable")).toEqual(["gone"]);
  });

  it("moves keyboard focus only over visible entries", async () => {
    await mount({ providers: [...keyProviders(12), entry("hidden-unavailable", ["oauth"], { available: false })] });
    keydown("End"); await nextTick();
    expect(get(".model-auth-provider-row.focused").dataset.providerId).toBe("key-8");
    keydown("ArrowDown"); await nextTick();
    expect(get(".model-auth-provider-row.focused").dataset.providerId).toBe("key-1");
    keydown("ArrowUp"); keydown("Enter"); await nextTick();
    expect(get('[data-part="detail"] h3').textContent).toBe("key-8");
  });

  it("offers catalog refresh only when no provider matches", async () => {
    const { events } = await mount();
    expect(document.querySelector('[data-part="refresh-catalog"]')).toBeNull();
    await fill('[data-part="search"]', "no-such-provider");
    expect(rows("oauth")).toEqual([]);
    await click('[data-part="refresh-catalog"]');
    expect(events.at(-1)?.name).toBe("refresh");
  });

  it("keeps the provider dialog at a fixed height that detail pages do not use", async () => {
    await mount({ providers: keyProviders(3) });
    expect(get(".model-auth-dialog").classList.contains("model-auth-dialog-fixed")).toBe(true);
    const stylesheet = readFileSync(resolve(import.meta.dirname, "../../model-auth/packages/vue/src/style.css"), "utf8");
    expect(stylesheet).toMatch(/\.model-auth-dialog-fixed \{(?:[^}]*[\s;])?height: min\(640px, calc\(100dvh - 48px\)\)/);
    await details("api-key", "key-1");
    expect(get(".model-auth-dialog").classList.contains("model-auth-dialog-fixed")).toBe(false);
  });
});
