import { computed, ref, shallowRef } from "vue";
import type {
  AddApiKeyPayload, CatalogStatus, CredentialUpdatePayload, ModelAuthProvider,
  ModelAuthSelection, ProviderUpdatePayload, StrategyUpdatePayload,
} from "./types";

export interface ModelAuthState {
  providers: ModelAuthProvider[];
  model: ModelAuthSelection | null;
  catalogStatus: CatalogStatus;
}
export type ModelAuthAction =
  | { type: "authorize-oauth"; providerId: string; credentialId?: string }
  | { type: "add-api-key"; payload: AddApiKeyPayload }
  | { type: "remove-credential"; providerId: string; credentialId: string; authMethod: "oauth" | "api-key" }
  | { type: "update-credential"; payload: CredentialUpdatePayload }
  | { type: "update-provider"; payload: ProviderUpdatePayload }
  | { type: "select-model"; payload: ModelAuthSelection }
  | { type: "update-strategy"; payload: StrategyUpdatePayload }
  | { type: "refresh-catalog" };

export interface ModelAuthHost {
  getState(): Promise<ModelAuthState>;
  execute(action: ModelAuthAction, context: { signal: AbortSignal }): Promise<void>;
}

export function useModelAuth(host: ModelAuthHost, options: { errorMessage?: string } = {}) {
  const open = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);
  const state = shallowRef<ModelAuthState>({ providers: [], model: null, catalogStatus: { state: "loading" } });
  let pending: Promise<boolean> | null = null;
  let authorization: AbortController | null = null;

  function run(action?: ModelAuthAction): Promise<boolean> {
    if (pending) return action ? Promise.resolve(false) : pending;
    busy.value = true; error.value = null;
    const controller = new AbortController();
    if (action?.type === "authorize-oauth") authorization = controller;
    pending = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return false;
      if (action) await host.execute(action, { signal: controller.signal });
      state.value = await host.getState();
      return true;
    }).catch(() => {
      if (!controller.signal.aborted) error.value = options.errorMessage ?? "操作未完成，请重试。";
      return false;
    }).finally(() => { busy.value = false; pending = null; authorization = null; });
    return pending;
  }
  const props = computed(() => ({ ...state.value, open: open.value, busy: busy.value, error: error.value }));
  const listeners = {
    close: () => { authorization?.abort(); open.value = false; },
    "authorize-oauth": (providerId: string) => run({ type: "authorize-oauth", providerId }),
    "reconnect-oauth": (providerId: string, credentialId: string) => run({ type: "authorize-oauth", providerId, credentialId }),
    "add-api-key": (payload: AddApiKeyPayload) => run({ type: "add-api-key", payload }),
    "remove-oauth": (providerId: string, credentialId: string) => run({ type: "remove-credential", providerId, credentialId, authMethod: "oauth" }),
    "remove-api-key": (providerId: string, credentialId: string) => run({ type: "remove-credential", providerId, credentialId, authMethod: "api-key" }),
    "update-credential": (payload: CredentialUpdatePayload) => run({ type: "update-credential", payload }),
    "update-provider": (payload: ProviderUpdatePayload) => run({ type: "update-provider", payload }),
    "select-model": (payload: ModelAuthSelection) => run({ type: "select-model", payload }),
    "update-provider-strategy": (payload: StrategyUpdatePayload) => run({ type: "update-strategy", payload }),
    "refresh-catalog": () => run({ type: "refresh-catalog" }),
  };
  return { open, busy, error, state, props, listeners, refresh: () => run(), perform: (action: ModelAuthAction) => run(action) };
}
