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
  const app = createApp(() => h(ModelAuthDialog, { ...state, onClose: on("close"), onReconnectOauth: on("reconnect"), onAuthorizeOauth: on("authorize"), onAddApiKey: on("add-key"), onUpdateCredential: on("credential"), onRemoveOauth: on("remove-oauth"), onRemoveApiKey: on("remove-key"), onUpdateProviderStrategy: on("strategy"), onRefreshCatalog: on("refresh") }));
  apps.push(app); app.mount(host); await nextTick(); await nextTick();
  return { state, events };
}
const get = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
async function click(selector: string) { get(selector).click(); await nextTick(); await nextTick(); }

describe("connection detail dialog", () => {
  it("never renders model lists or the load strategy in the detail view", async () => {
    await mount({ providerId: "oauth", method: "oauth" });
    expect(document.querySelector('[data-part="connection-policy"], [data-part="models"], [part="strategy"]')).toBeNull();
    expect(get('[data-part="connection-info"]').textContent).not.toContain("负载策略");
  });

  it("uses only the current authentication method and preserves explicit direct provider confirmation", async () => {
    const { state, events } = await mount(null);
    const provider = state.providers[0]!;
    provider.authMethods = ["oauth", "api-key"];
    provider.apiKeyCredentials = [{ id: "api", label: "Key", enabled: true, healthy: true, models: ["key-only"] }];
    await click('[data-provider-id="oauth"]');
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    await click('[data-part="continue-confirmation"]');
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeTruthy();
    expect(document.querySelector('[data-part="models"]')).toBeNull();
    expect(events.some(event => event.name === "close")).toBe(false);
    await click('[data-part="confirm"]');
    expect(events.at(-1)?.name).toBe("close");
  });

  it("opens OAuth metadata directly, without wizard progress or a current model", async () => {
    await mount({ providerId: "oauth", method: "oauth" });
    expect(get("h2").textContent).toBe("接入信息");
    expect(document.querySelector('[part="progress"]')).toBeNull();
    expect(document.querySelector('[data-part="back"]')).toBeNull();
    expect(get('[data-part="connection-info"]').classList).toContain("model-auth-connection-detail");
    expect(get('[data-part="oauth-credential"]').textContent).toContain("user@example.test");
    expect(get('[data-part="connection-info"]').textContent).not.toContain("当前使用");
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

  it("supports disabled API credentials and confirmation deletion", async () => {
    const { events } = await mount({ providerId: "key", method: "api-key" });
    const toggle = get<HTMLInputElement>('[data-part="api-key-credential"] input[role="switch"]');
    toggle.checked = true; toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "key", credentialId: "key-1", enabled: true } });
    await click('[data-part="api-key-credential"] .model-auth-danger');
    await click('[data-part="api-key-credential"] .model-auth-danger');
    expect(events.at(-1)).toEqual({ name: "remove-key", payload: ["key", "key-1"] });
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
    expect(document.querySelector('[data-part="provider-step"]')).toBeTruthy();
  });

  it("restores its target on close and reopen, while a dialog without a target keeps the direct provider flow", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    state.open = false; await nextTick();
    get<HTMLDialogElement>('[data-part="dialog"]').dispatchEvent(new AnimationEvent("animationend", { animationName: "model-auth-modal-exit" })); await nextTick();
    state.open = true; await nextTick(); await nextTick();
    expect(get("h2").textContent).toBe("接入信息");
    expect(document.querySelector('[part="progress"]')).toBeNull();
    const standard = await mount(null);
    expect([...document.querySelectorAll("h2")].at(-1)?.textContent).toBe("选择提供商");
    expect(document.querySelector('[part="progress"]')).toBeTruthy();
    void standard;
  });

  async function fillInput(selector: string, value: string) {
    const input = get<HTMLInputElement>(selector);
    input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); await nextTick();
  }

  it("renames a credential and disables saving when the name is unchanged", async () => {
    const { events } = await mount({ providerId: "oauth", method: "oauth" });
    const save = get<HTMLButtonElement>('[data-part="save-label"]');
    expect(get<HTMLInputElement>('[data-part="credential-label"]').value).toBe("Primary");
    expect(save.disabled).toBe(true);
    await fillInput('[data-part="credential-label"]', "  Renamed  ");
    expect(save.disabled).toBe(false);
    await click('[data-part="save-label"]');
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "oauth", credentialId: "account", enabled: true, label: "Renamed" } });
  });

  async function pressEnter(selector: string, init: KeyboardEventInit) {
    get(selector).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })); await nextTick();
  }

  it("saves a rename on Enter but not while an IME composition is active", async () => {
    const { events } = await mount({ providerId: "oauth", method: "oauth" });
    await fillInput('[data-part="credential-label"]', "zhang");
    await pressEnter('[data-part="credential-label"]', { isComposing: true });
    await pressEnter('[data-part="credential-label"]', { keyCode: 229 });
    expect(events.some(event => event.name === "credential")).toBe(false);
    await fillInput('[data-part="credential-label"]', "张");
    await pressEnter('[data-part="credential-label"]', {});
    expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "oauth", credentialId: "account", enabled: true, label: "张" } });
  });

  it("ignores rename saves while busy", async () => {
    const { events, state } = await mount({ providerId: "oauth", method: "oauth" });
    await fillInput('[data-part="credential-label"]', "Other");
    state.busy = true; await nextTick();
    expect(get<HTMLButtonElement>('[data-part="save-label"]').disabled).toBe(true);
    await pressEnter('[data-part="credential-label"]', {});
    expect(events.some(event => event.name === "credential")).toBe(false);
  });

  it("adds API keys and OAuth accounts from the detail view without leaving it", async () => {
    const { events, state } = await mount({ providerId: "key", method: "api-key" });
    await fillInput('[data-part="api-key-form"] input[type="password"]', "sk-test-value");
    get('[data-part="api-key-form"]').dispatchEvent(new Event("submit", { cancelable: true })); await nextTick(); await nextTick();
    expect(events.at(-1)).toEqual({ name: "add-key", payload: { providerId: "key", label: "", apiKey: "sk-test-value" } });
    state.providers[1]!.apiKeyCredentials![0]!.enabled = true; state.providers[1]!.apiKeyCredentials![0]!.healthy = true; await nextTick(); await nextTick();
    expect(document.querySelector('[data-part="connection-info"]')).not.toBeNull();
    expect(document.querySelector('[data-part="confirmation-step"]')).toBeNull();
    const oauth = await mount({ providerId: "oauth", method: "oauth" });
    document.querySelectorAll<HTMLElement>('[data-part="authorize"]').forEach(button => button.click()); await nextTick(); await nextTick();
    expect(oauth.events.at(-1)).toEqual({ name: "authorize", payload: "oauth" });
    expect(document.querySelector('[data-part="connection-info"]')).not.toBeNull();
  });

  describe("account login", () => {
    const withLogin = (login?: { username: string; passwordSaved: boolean }) => async () => {
      const ctx = await mount({ providerId: "key", method: "api-key" });
      ctx.state.providers[1]!.accountLogin = true; ctx.state.providers[1]!.apiKeyCredentials![0]!.enabled = true;
      if (login) ctx.state.providers[1]!.apiKeyCredentials![0]!.login = login;
      await nextTick();
      return ctx;
    };
    const submit = async () => { get('[data-part="credential-login"]').dispatchEvent(new Event("submit", { cancelable: true })); await nextTick(); await nextTick(); };

    it("is absent unless the provider declares accountLogin", async () => {
      await mount({ providerId: "key", method: "api-key" });
      expect(document.querySelector('[data-part="credential-login"]')).toBeNull();
    });

    it("submits username and password, then drops the password from the input", async () => {
      const { events } = await withLogin()();
      expect(get<HTMLInputElement>('[data-part="login-username"]').type).toBe("text");
      expect(get<HTMLInputElement>('[data-part="login-username"]').inputMode).toBe("email");
      expect(get<HTMLButtonElement>('[data-part="save-login"]').disabled).toBe(true);
      await fillInput('[data-part="login-username"]', "person@example.test");
      await fillInput('[data-part="login-password"]', "fixture-password");
      await submit();
      expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "key", credentialId: "key-1", enabled: true, login: { username: "person@example.test", password: "fixture-password" } } });
      expect(get<HTMLInputElement>('[data-part="login-password"]').value).toBe("");
      expect(document.body.innerHTML).not.toContain("fixture-password");
    });

    it("emits a username-only change when a password is already saved", async () => {
      const { events } = await withLogin({ username: "old@example.test", passwordSaved: true })();
      expect(get<HTMLInputElement>('[data-part="login-password"]').placeholder).toBe("已保存（留空则不修改）");
      expect(get<HTMLButtonElement>('[data-part="save-login"]').disabled).toBe(true);
      await fillInput('[data-part="login-username"]', "new@example.test");
      await submit();
      const payload = (events.at(-1)!.payload as { login: object }).login;
      expect(payload).toEqual({ username: "new@example.test" });
      expect("password" in payload).toBe(false);
    });

    it("keeps save disabled for a password without a username and for an unchanged username", async () => {
      await withLogin()();
      await fillInput('[data-part="login-password"]', "fixture-password");
      expect(get<HTMLButtonElement>('[data-part="save-login"]').disabled).toBe(true);
      document.body.replaceChildren();
      await withLogin({ username: "old@example.test", passwordSaved: false })();
      await fillInput('[data-part="login-username"]', "new@example.test");
      expect(get<HTMLButtonElement>('[data-part="save-login"]').disabled).toBe(true);
      await fillInput('[data-part="login-username"]', "old@example.test");
      await fillInput('[data-part="login-password"]', "");
      expect(get<HTMLButtonElement>('[data-part="save-login"]').disabled).toBe(true);
    });

    it("ignores login actions while busy and keeps the typed draft", async () => {
      const { events, state } = await withLogin({ username: "old@example.test", passwordSaved: true })();
      await fillInput('[data-part="login-password"]', "fixture-password");
      state.busy = true; await nextTick();
      expect(get<HTMLButtonElement>('[data-part="save-login"]').disabled).toBe(true);
      expect(get<HTMLButtonElement>('[data-part="clear-login"]').disabled).toBe(true);
      await submit();
      expect(events.some(event => event.name === "credential")).toBe(false);
      expect(get<HTMLInputElement>('[data-part="login-password"]').value).toBe("fixture-password");
      get<HTMLButtonElement>('[data-part="clear-login"]').disabled = false;
      await click('[data-part="clear-login"]');
      state.busy = false; await nextTick();
      expect(get('[data-part="clear-login"]').textContent).not.toContain("确认");
    });

    it("clears the account after a second click", async () => {
      const { events } = await withLogin({ username: "old@example.test", passwordSaved: true })();
      await click('[data-part="clear-login"]');
      expect(events.some(event => event.name === "credential")).toBe(false);
      await click('[data-part="clear-login"]');
      expect(events.at(-1)).toEqual({ name: "credential", payload: { providerId: "key", credentialId: "key-1", enabled: true, login: null } });
    });
  });

  it("shows remaining rather than used percentage in usage windows", async () => {
    const { state } = await mount({ providerId: "oauth", method: "oauth" });
    state.providers[0]!.oauthCredentials![0]!.usage = { providerId: "oauth", credentialId: "account", status: "ok", plan: null, windows: [{ id: "w", label: "Weekly", usedPercent: 60, resetAt: Date.UTC(2030, 0, 1) }, { id: "u", label: "Unknown", usedPercent: null, resetAt: null }], balance: null, fetchedAtUtc: "2000-01-01T00:00:00.000Z", error: null };
    state.percentagePrecision = 0; await nextTick();
    const spans = [...document.querySelectorAll<HTMLElement>('[data-part="credential-usage"] span')];
    expect(spans.map(span => span.textContent)).toEqual(["Weekly · 剩余 40%", "Unknown · 剩余 —"]);
    expect(spans[0]!.title).toBe("2030-01-01T00:00:00.000Z");
  });
});
