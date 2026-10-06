import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import type {
  AddApiKeyPayload, AuthMethod, CatalogStatus, CredentialReorderPayload, CredentialUpdatePayload, ModelAuthProvider,
  ProviderAuthEvent, ProviderAuthResponseRequest, ProviderAuthState,
  ProviderUpdatePayload,
} from "./types";

export interface ModelAuthState {
  providers: ModelAuthProvider[];
  catalogStatus: CatalogStatus;
  auth?: ProviderAuthState;
}
export type ModelAuthAction =
  | { type: "authorize-oauth"; providerId: string; credentialId?: string }
  | { type: "logout"; providerId: string; credentialId: string }
  | { type: "query-usage"; providerId: string; credentialId: string }
  | { type: "add-api-key"; payload: AddApiKeyPayload }
  | { type: "remove-credential"; providerId: string; credentialId: string; authMethod: AuthMethod }
  | { type: "update-credential"; payload: CredentialUpdatePayload }
  | { type: "reorder-credentials"; providerId: string; method: AuthMethod; credentialIds: string[] }
  | { type: "update-provider"; payload: ProviderUpdatePayload }
  | { type: "refresh-catalog" };

export interface ModelAuthHost {
  getState(): Promise<ModelAuthState>;
  execute(action: ModelAuthAction, context: { signal: AbortSignal }): Promise<void>;
  subscribeAuthEvents?(listener: (event: ProviderAuthEvent) => void): () => void;
  respondAuth?(response: ProviderAuthResponseRequest): Promise<void>;
  cancelAuth?(loginId: string): Promise<void>;
  openAuthUrl?(url: string): Promise<void>;
}

export function useModelAuth(host: ModelAuthHost, options: { errorMessage?: string } = {}) {
  const open = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);
  const state = shallowRef<ModelAuthState>({ providers: [], catalogStatus: { state: "loading" } });
  const auth = shallowRef<ProviderAuthState>({ status: "idle", loginId: null, notices: [], prompt: null, error: null });
  let pending: Promise<boolean> | null = null;
  let authorization: AbortController | null = null;

  function run(action?: ModelAuthAction): Promise<boolean> {
    if (pending) return action ? Promise.resolve(false) : pending;
    busy.value = true; error.value = null;
    const controller = new AbortController();
    authorization = controller;
    if (action?.type === "authorize-oauth") {
      auth.value = { status: "running", loginId: null, notices: [], prompt: null, error: null };
    }
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
    pending = Promise.race([cancelled, Promise.resolve().then(async () => {
      if (controller.signal.aborted) return false;
      if (action) await host.execute(action, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      const next = await host.getState();
      if (controller.signal.aborted) return false;
      state.value = next;
      if (action?.type === "authorize-oauth") auth.value = { ...auth.value, status: "complete", prompt: null, error: null };
      return true;
    })]).catch(() => {
      if (!controller.signal.aborted) {
        error.value = options.errorMessage ?? "操作未完成，请重试。";
        if (action?.type === "authorize-oauth") auth.value = { ...auth.value, status: "error", error: error.value };
      }
      return false;
    }).finally(() => {
      if (action?.type === "authorize-oauth" && controller.signal.aborted && auth.value.status === "running") {
        auth.value = { ...auth.value, status: "error", error: "认证已取消。" };
      }
      busy.value = false; pending = null; authorization = null;
    });
    return pending;
  }
  const unsubscribeAuth = host.subscribeAuthEvents?.((event) => {
    if (event.type === "provider-auth-prompt") {
      auth.value = { ...auth.value, status: "running", loginId: event.loginId, prompt: { promptId: event.promptId, prompt: event.prompt }, error: null };
    } else {
      auth.value = { ...auth.value, status: "running", loginId: event.loginId, notices: [...auth.value.notices, event.notice], error: null };
    }
  });
  onBeforeUnmount(() => { authorization?.abort(); unsubscribeAuth?.(); });
  const props = computed(() => ({ ...state.value, auth: auth.value, open: open.value, busy: busy.value, error: error.value }));
  const listeners = {
    close: () => {
      if (auth.value.loginId) void host.cancelAuth?.(auth.value.loginId);
      authorization?.abort(); open.value = false;
    },
    "authorize-oauth": (providerId: string) => run({ type: "authorize-oauth", providerId }),
    "reconnect-oauth": (providerId: string, credentialId: string) => run({ type: "authorize-oauth", providerId, credentialId }),
    logout: (providerId: string, credentialId: string) => run({ type: "logout", providerId, credentialId }),
    "query-usage": (providerId: string, credentialId: string) => run({ type: "query-usage", providerId, credentialId }),
    "add-api-key": (payload: AddApiKeyPayload) => run({ type: "add-api-key", payload }),
    "remove-oauth": (providerId: string, credentialId: string) => run({ type: "remove-credential", providerId, credentialId, authMethod: "oauth" }),
    "remove-api-key": (providerId: string, credentialId: string) => run({ type: "remove-credential", providerId, credentialId, authMethod: "api-key" }),
    "update-credential": (payload: CredentialUpdatePayload) => run({ type: "update-credential", payload }),
    "reorder-credentials": (payload: CredentialReorderPayload) => run({ type: "reorder-credentials", ...payload }),
    "update-provider": (payload: ProviderUpdatePayload) => run({ type: "update-provider", payload }),
    "refresh-catalog": () => run({ type: "refresh-catalog" }),
    "respond-auth": (response: ProviderAuthResponseRequest) => host.respondAuth ? host.respondAuth(response).then(() => true, () => false) : Promise.resolve(false),
    "cancel-auth": (loginId: string) => { void host.cancelAuth?.(loginId); authorization?.abort(); },
    "open-auth-url": (url: string) => { void host.openAuthUrl?.(url); },
  };
  return { open, busy, error, state, props, listeners, refresh: () => run(), perform: (action: ModelAuthAction) => run(action) };
}
