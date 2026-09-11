<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { defaultMessages, type ModelAuthMessages } from "./messages";
import StrategyPicker from "./StrategyPicker.vue";
import ModelPicker from "./ModelPicker.vue";
import type {
  AddApiKeyPayload, AuthMethod, CredentialExtend, CredentialUpdatePayload, CatalogStatus, LoadStrategy,
  ModelAuthProvider, ModelAuthSelection, ModelConnectionTarget, ProviderAuthResponseRequest, ProviderAuthState, ProviderCredential, ProviderAuthNotice, ProviderUpdatePayload, StrategyUpdatePayload, Theme,
} from "./types";

const props = withDefaults(defineProps<{
  open?: boolean;
  providers?: ModelAuthProvider[];
  styled?: boolean;
  theme?: Theme;
  initialMethod?: AuthMethod;
  initialConnection?: ModelConnectionTarget | null;
  model?: ModelAuthSelection | null;
  loadStrategy?: LoadStrategy;
  catalogStatus?: CatalogStatus;
  messages?: Partial<ModelAuthMessages>;
  busy?: boolean;
  error?: string | null;
  auth?: ProviderAuthState;
}>(), {
  open: false, providers: () => [], styled: true, theme: "system", initialMethod: "oauth", initialConnection: null,
  model: null, loadStrategy: "round-robin", catalogStatus: () => ({ state: "loading" }),
  messages: () => ({}), busy: false, error: null,
  auth: () => ({ status: "idle", loginId: null, notices: [], prompt: null, error: null }),
});
const emit = defineEmits<{
  close: [];
  "authorize-oauth": [providerId: string];
  "reconnect-oauth": [providerId: string, credentialId: string];
  "remove-oauth": [providerId: string, credentialId: string];
  "update-credential": [payload: CredentialUpdatePayload];
  "update-provider": [payload: ProviderUpdatePayload];
  "add-api-key": [payload: AddApiKeyPayload];
  "remove-api-key": [providerId: string, credentialId: string];
  "select-model": [selection: ModelAuthSelection];
  "update-strategy": [strategy: LoadStrategy];
  "update-provider-strategy": [payload: StrategyUpdatePayload];
  "refresh-catalog": [];
  "query-usage": [providerId: string, credentialId: string];
  logout: [providerId: string, credentialId: string];
  "respond-auth": [response: ProviderAuthResponseRequest];
  "cancel-auth": [loginId: string];
  "open-auth-url": [url: string];
}>();

type Step = "method" | "providers" | "detail" | "confirmation";
const step = ref<Step>("method");
const method = ref<AuthMethod>(props.initialMethod);
const selectedProviderId = ref("");
const search = ref("");
const focusedProviderIndex = ref(-1);
const searchInput = ref<HTMLInputElement>();
const dialog = ref<HTMLDialogElement>();
const heading = ref<HTMLElement>();
const labelInput = ref("");
const apiKeyInput = ref("");
const revealApiKey = ref(false);
const localError = ref("");
const pendingRemoval = ref("");
const connectionMode = ref(false);
let awaitingVerification = false;
const titleId = "model-auth-" + useId();
let restoreFocus: HTMLElement | undefined;
let closing = false;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let openTimer: ReturnType<typeof setTimeout> | undefined;
const visible = ref(false);
const promptValue = ref("");
const modalState = ref<"opening" | "open" | "closing">("open");
const transitionName = ref("model-auth-step-forward");
const text = computed(() => ({ ...defaultMessages, ...props.messages }));
const stepIndex = computed(() => ["method", "providers", "detail", "confirmation"].indexOf(step.value));
const pageTitles = computed(() => [text.value.addConnection, text.value.chooseProvider, text.value.completeAuthorization, text.value.confirm]);
const selectedProvider = computed(() => props.providers.find(provider => provider.id === selectedProviderId.value));
const connectionMissing = computed(() => connectionMode.value && !selectedProvider.value);
const matchingProviders = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return props.providers.filter(provider => provider.authMethods.includes(method.value)
    && [provider.name, provider.description, provider.id].some(value => value.toLocaleLowerCase().includes(query)));
});
const providerGroups = computed(() => [
  { key: "available", label: text.value.available, providers: matchingProviders.value.filter(provider => provider.available) },
  { key: "unavailable", label: text.value.unavailable, providers: matchingProviders.value.filter(provider => !provider.available) },
].filter(group => group.providers.length));
const orderedProviders = computed(() => providerGroups.value.flatMap(group => group.providers));
const credentials = computed<ProviderCredential[]>(() => {
  const provider = selectedProvider.value;
  return (method.value === "oauth" ? provider?.oauthCredentials : provider?.apiKeyCredentials) ?? [];
});
const connectionModels = computed(() => [...new Set(credentials.value.flatMap(credential => credential.models || []).filter(model => model.trim()))]);
const canUseMethod = computed(() => Boolean(selectedProvider.value?.available
  && selectedProvider.value.authMethods.includes(method.value)
  && (method.value !== "oauth" || selectedProvider.value.oauthEnabled !== false)));
const eligibleCredentials = computed(() => canUseMethod.value ? credentials.value.filter(credential => credential.enabled && credential.healthy
  && Number.isInteger(credential.weight) && credential.weight > 0 && credential.weight <= 100
  && (!credential.cooldownUntilUtc || Date.parse(credential.cooldownUntilUtc) <= Date.now())) : []);
const availableModels = computed(() => [...new Set(eligibleCredentials.value.flatMap(credential => credential.models || []).filter(model => model.trim()))]);
const authReady = computed(() => eligibleCredentials.value.length > 0);
const strategyOptions = computed(() => [
  { value: "round-robin" as const, label: text.value.roundRobin },
  { value: "weighted-round-robin" as const, label: text.value.weightedRoundRobin },
  { value: "failover" as const, label: text.value.failover },
]);
const currentStrategy = computed(() => selectedProvider.value?.loadStrategy ?? props.loadStrategy);
const currentModel = computed(() => props.model?.providerId === selectedProviderId.value ? props.model.model : "—");
const activePrompt = computed(() => props.auth?.prompt?.prompt ?? null);
const activePromptId = computed(() => props.auth?.prompt?.promptId ?? "");

function activeElement(): Element | null {
  let element: Element | null = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}
function clearSecret() { labelInput.value = ""; apiKeyInput.value = ""; revealApiKey.value = false; }
function resetState() {
  awaitingVerification = false;
  connectionMode.value = Boolean(props.initialConnection);
  method.value = props.initialConnection?.method ?? props.initialMethod;
  step.value = props.initialConnection ? "detail" : "method";
  selectedProviderId.value = props.initialConnection?.providerId ?? ""; search.value = "";
  focusedProviderIndex.value = -1; pendingRemoval.value = ""; localError.value = ""; clearSecret();
}
function reducedMotion() { return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; }
async function focusHeading() { await nextTick(); if (props.open && modalState.value !== "closing") heading.value?.focus(); }
function openNativeDialog() {
  const nativeDialog = dialog.value;
  if (!nativeDialog || nativeDialog.open) return;
  nativeDialog.showModal();
}
function finishClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = undefined;
  const nativeDialog = dialog.value;
  if (nativeDialog?.open) nativeDialog.close();
  visible.value = false;
  modalState.value = "open";
  resetState();
  if (restoreFocus?.isConnected) restoreFocus.focus();
}
function startClose() {
  if (!visible.value || modalState.value === "closing") return;
  if (openTimer) clearTimeout(openTimer);
  openTimer = undefined;
  modalState.value = "closing";
  if (reducedMotion()) { finishClose(); return; }
  closeTimer = setTimeout(finishClose, 220);
}
function handleModalAnimationEnd(event: AnimationEvent) {
  if (event.target !== dialog.value) return;
  if (event.animationName === "model-auth-modal-enter") { if (openTimer) clearTimeout(openTimer); openTimer = undefined; modalState.value = "open"; void focusHeading(); }
  if (event.animationName === "model-auth-modal-exit") finishClose();
}
function handleCancel(event: Event) { event.preventDefault(); close(); }
function chooseMethod(value: AuthMethod) {
  connectionMode.value = false;
  transitionName.value = "model-auth-step-forward"; method.value = value; step.value = "providers"; search.value = ""; selectedProviderId.value = "";
  clearSecret(); void nextTick(() => searchInput.value?.focus());
}
function chooseProvider(provider: ModelAuthProvider) {
  transitionName.value = "model-auth-step-forward"; clearSecret(); selectedProviderId.value = provider.id; step.value = "detail";
  pendingRemoval.value = ""; localError.value = ""; void focusHeading();
}
function back() {
  if (connectionMode.value) return;
  awaitingVerification = false;
  clearSecret(); pendingRemoval.value = ""; localError.value = "";
  transitionName.value = "model-auth-step-backward";
  if (step.value === "confirmation") { step.value = "detail"; void focusHeading(); }
  else if (step.value === "detail") { step.value = "providers"; void nextTick(() => searchInput.value?.focus()); }
  else { step.value = "method"; selectedProviderId.value = ""; void focusHeading(); }
}
function close() {
  awaitingVerification = false;
  if (closing) return;
  closing = true; clearSecret(); emit("close");
  void nextTick(() => {
    if (!props.open && restoreFocus?.isConnected) restoreFocus.focus();
    closing = false;
  });
}
function handleProviderKeydown(event: KeyboardEvent) {
  const count = orderedProviders.value.length;
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && count) {
    event.preventDefault();
    const index = focusedProviderIndex.value;
    focusedProviderIndex.value = event.key === "Home" ? 0 : event.key === "End" ? count - 1
      : index < 0 ? event.key === "ArrowDown" ? 0 : count - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
    void nextTick(() => dialog.value?.querySelector(".model-auth-provider-row.focused")?.scrollIntoView?.({ block: "nearest" }));
  } else if (event.key === "Enter" && count) {
    event.preventDefault();
    const provider = orderedProviders.value[Math.max(0, focusedProviderIndex.value)];
    if (provider) chooseProvider(provider);
  }
}
function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex='0'], a[href], summary")]
    .filter(element => element.tabIndex >= 0 && !element.closest("[hidden]")
      && (!element.closest("details:not([open])") || element.matches("summary")));
  const first = focusable[0], last = focusable.at(-1), active = activeElement();
  if (!first || !last) { event.preventDefault(); dialog.value.focus(); return; }
  if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
    event.preventDefault(); first.focus();
  }
}
function updateCredential(credential: ProviderCredential, enabled: boolean, weight: number, extend?: CredentialExtend) {
  const provider = selectedProvider.value;
  if (!provider || props.busy) return;
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) { localError.value = text.value.weightInvalid; return; }
  localError.value = "";
  emit("update-credential", { providerId: provider.id, credentialId: credential.id, enabled, weight, ...(extend ? { extend } : {}) });
}
function extendText(credential: ProviderCredential): string {
  return JSON.stringify(credential.extend ?? {}, null, 2);
}
function updateExtend(credential: ProviderCredential, value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const extend: Record<string, string | number | boolean | null> = {};
    for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean" && item !== null) throw new Error();
      extend[key] = item;
    }
    updateCredential(credential, credential.enabled, credential.weight, extend);
  } catch {
    localError.value = text.value.extendInvalid;
  }
}
function queryUsage(credential: ProviderCredential) {
  const provider = selectedProvider.value;
  if (!provider || props.busy || (!provider.usageEnabled && !credential.usage)) return;
  emit("query-usage", provider.id, credential.id);
}
function noticeText(notice: ProviderAuthNotice): string {
  if (notice.type === "device_code") return `${text.value.authDeviceCode}: ${notice.userCode} · ${notice.verificationUri}`;
  if (notice.type === "auth_url") return notice.instructions || text.value.authOpenBrowser;
  return notice.message;
}
function noticeUrl(notice: ProviderAuthNotice): string | null {
  if (notice.type === "auth_url") return notice.url;
  if (notice.type === "device_code") return notice.verificationUri;
  return null;
}
function submitAuthPrompt() {
  const loginId = props.auth?.loginId;
  if (!loginId || !activePromptId.value || !promptValue.value.trim()) return;
  emit("respond-auth", { loginId, promptId: activePromptId.value, value: promptValue.value });
  promptValue.value = "";
}
function cancelAuth() {
  if (props.auth?.loginId) emit("cancel-auth", props.auth.loginId);
}
function removeCredential(credential: ProviderCredential) {
  const provider = selectedProvider.value;
  if (!provider || props.busy) return;
  if (pendingRemoval.value !== credential.id) { pendingRemoval.value = credential.id; return; }
  pendingRemoval.value = "";
  if (method.value === "oauth") emit("remove-oauth", provider.id, credential.id);
  else emit("remove-api-key", provider.id, credential.id);
}
function addApiKey() {
  const provider = selectedProvider.value;
  if (!provider || !canUseMethod.value || props.busy || !apiKeyInput.value.trim()) return;
  const payload = { providerId: provider.id, label: labelInput.value.trim(), apiKey: apiKeyInput.value.trim() };
  clearSecret(); awaitingVerification = true; emit("add-api-key", payload); void nextTick(checkVerification);
}
function authorize(credentialId?: string) {
  if (!selectedProvider.value || props.busy || !canUseMethod.value) return;
  awaitingVerification = true;
  if (credentialId) emit("reconnect-oauth", selectedProvider.value.id, credentialId);
  else emit("authorize-oauth", selectedProvider.value.id);
  void nextTick(checkVerification);
}
function startNewConnection() {
  connectionMode.value = false;
  transitionName.value = "model-auth-step-forward";
  step.value = "method"; selectedProviderId.value = ""; search.value = "";
  pendingRemoval.value = ""; localError.value = ""; clearSecret(); void focusHeading();
}
function selectModel(model: string) {
  const provider = selectedProvider.value;
  if (!provider || props.busy || !availableModels.value.includes(model)) return;
  emit("select-model", { providerId: provider.id, model });
}
function updateStrategy(value: LoadStrategy) {
  const provider = selectedProvider.value;
  if (!provider || props.busy) return;
  emit("update-provider-strategy", { providerId: provider.id, strategy: value });
}
function advanceToConfirmation() {
  if (step.value !== "detail" || !authReady.value || props.busy) return;
  awaitingVerification = false; clearSecret(); transitionName.value = "model-auth-step-forward";
  step.value = "confirmation"; void focusHeading();
}
function checkVerification() {
  if (connectionMode.value || !awaitingVerification || step.value !== "detail" || props.busy) return;
  if (props.error) { awaitingVerification = false; return; }
  if (authReady.value) advanceToConfirmation();
}
function confirmConnection() {
  if (step.value === "confirmation" && !props.busy && authReady.value && !props.error) close();
}
function credentialStatus(credential: ProviderCredential) {
  if (!credential.enabled) return text.value.disabled;
  if (credential.cooldownUntilUtc) return text.value.cooling + " " + credential.cooldownUntilUtc;
  return credential.healthy ? text.value.ready : text.value.needsReconnect;
}
watch(() => props.open, open => {
  if (open) {
    if (modalState.value !== "closing") restoreFocus = activeElement() instanceof HTMLElement ? activeElement() as HTMLElement : undefined;
    if (closeTimer) clearTimeout(closeTimer);
    if (openTimer) clearTimeout(openTimer);
    resetState(); visible.value = true; modalState.value = "opening";
    void nextTick(() => {
      openNativeDialog();
      if (reducedMotion()) { modalState.value = "open"; void focusHeading(); return; }
      openTimer = setTimeout(() => { modalState.value = "open"; void focusHeading(); }, 220);
    });
  } else {
    clearSecret(); startClose();
  }
}, { immediate: true });
watch(search, () => { focusedProviderIndex.value = -1; });
watch(activePromptId, () => { promptValue.value = ""; });
watch([authReady, () => props.busy, () => props.error], () => {
  if (!authReady.value && step.value === "confirmation") { step.value = "detail"; void focusHeading(); }
  checkVerification();
});
watch(selectedProvider, provider => {
  if (!provider && !connectionMode.value && (step.value === "detail" || step.value === "confirmation")) { awaitingVerification = false; step.value = "providers"; }
});
onBeforeUnmount(() => { clearSecret(); if (closeTimer) clearTimeout(closeTimer); if (openTimer) clearTimeout(openTimer); if (dialog.value?.open) dialog.value.close(); if (restoreFocus?.isConnected) restoreFocus.focus(); });
</script>

<template>
  <dialog v-if="visible" ref="dialog" class="model-auth-modal" :class="{ 'model-auth-styled': styled }" :data-theme="theme" :data-state="modalState" part="dialog" data-part="dialog" :aria-labelledby="titleId" :aria-busy="busy" @cancel="handleCancel" @click.self="close" @keydown="handleDialogKeydown" @animationend="handleModalAnimationEnd">
    <div class="model-auth-root">
      <section class="model-auth-dialog" role="document" tabindex="-1">
        <header class="model-auth-header" part="header" data-part="navigation">
          <button v-if="step !== 'method' && !connectionMode" type="button" class="model-auth-back" part="back" data-part="back" :aria-label="text.back" @click="back"><span aria-hidden="true">←</span></button>
          <h2 :id="titleId" ref="heading" class="model-auth-title" tabindex="-1">{{ connectionMode ? text.connectionInfo : pageTitles[stepIndex] }}</h2>
          <button type="button" class="model-auth-close" part="close" data-part="close" :aria-label="text.close" @click="close">×</button>
        </header>
        <div v-if="!connectionMode" class="model-auth-progress" part="progress" role="progressbar" :aria-label="text.progress" :aria-valuemin="0" :aria-valuemax="3" :aria-valuenow="stepIndex" :aria-valuetext="pageTitles[stepIndex]">
          <div v-for="segment in 3" :key="segment" class="model-auth-progress-segment"><div class="model-auth-progress-fill" :style="{ width: (segment <= stepIndex ? 100 : 0) + '%' }" /></div>
        </div>
        <p v-if="!connectionMode" class="model-auth-step-caption">{{ text.stepOf.replace('{current}', String(stepIndex)).replace('{total}', '3') }}</p>
        <div v-if="error || localError" class="model-auth-error" role="alert" part="error">{{ error || localError }}</div>
        <p v-if="busy" class="model-auth-busy" role="status">{{ text.working }}</p>
        <section v-if="auth && auth.status === 'running' && (auth.notices.length || activePrompt)" class="model-auth-auth-interaction" data-part="auth-interaction" aria-live="polite">
          <div v-for="(notice, index) in auth.notices" :key="index" class="model-auth-auth-notice">
            <p>{{ noticeText(notice) }}</p>
            <button v-if="noticeUrl(notice)" type="button" class="model-auth-secondary" @click="emit('open-auth-url', noticeUrl(notice)!)">{{ text.authOpenBrowser }}</button>
            <template v-if="(notice.type === 'info' || notice.type === 'message') && notice.links">
              <button v-for="link in notice.links" :key="link.url" type="button" class="model-auth-subtle" @click="emit('open-auth-url', link.url)">{{ link.label }}</button>
            </template>
          </div>
          <form v-if="activePrompt" class="model-auth-auth-prompt" @submit.prevent="submitAuthPrompt">
            <label>{{ activePrompt.message }}
              <select v-if="activePrompt.type === 'select'" v-model="promptValue">
                <option value="" disabled>{{ text.authChooseOption }}</option>
                <option v-for="option in activePrompt.options" :key="option.id" :value="option.id">{{ option.label }}{{ option.description ? ' · ' + option.description : '' }}</option>
              </select>
              <input v-else v-model="promptValue" :type="activePrompt.type === 'secret' ? 'password' : 'text'" :placeholder="activePrompt.placeholder" autocomplete="off" />
            </label>
            <div class="model-auth-credential-actions">
              <button type="submit" class="model-auth-primary" :disabled="!promptValue.trim()">{{ text.authSubmit }}</button>
              <button type="button" class="model-auth-secondary" @click="cancelAuth">{{ text.authCancel }}</button>
            </div>
          </form>
        </section>

        <div v-if="step === 'method'" key="method" :class="['model-auth-methods', transitionName]" part="method-list" data-part="method-list">
          <button v-for="choice in (['oauth', 'api-key'] as const)" :key="choice" type="button" class="model-auth-method-card" part="method-card" :data-part="'method-' + choice" @click="chooseMethod(choice)">
            <slot name="method-card" :method="choice" :choose="() => chooseMethod(choice)">
              <span class="model-auth-method-icon" aria-hidden="true">{{ choice === 'oauth' ? '◎' : '⌘' }}</span>
              <span><strong>{{ choice === 'oauth' ? text.oauth : text.apiKey }}</strong><small>{{ choice === 'oauth' ? text.oauthDescription : text.apiKeyDescription }}</small></span>
              <span aria-hidden="true">→</span>
            </slot>
          </button>
        </div>

        <div v-else-if="step === 'providers'" key="providers" :class="['model-auth-provider-step', transitionName]" part="provider-step" data-part="provider-step">
          <div class="model-auth-provider-search">
            <input ref="searchInput" v-model="search" class="model-auth-search" part="search" data-part="search" type="search" :placeholder="text.search" :aria-label="text.search" autocomplete="off" @keydown="handleProviderKeydown" />
            <button type="button" class="model-auth-secondary" data-part="refresh-catalog" :disabled="catalogStatus.state === 'loading'" @click="emit('refresh-catalog')">{{ catalogStatus.state === 'loading' ? text.refreshingCatalog : text.refreshCatalog }}</button>
          </div>
          <p v-if="catalogStatus.error || catalogStatus.state === 'error'" class="model-auth-error" part="catalog-status" data-part="catalog-status" role="status">{{ catalogStatus.error || text.catalogUnavailable }}</p>
          <div class="model-auth-provider-list" part="provider-list">
            <section v-for="group in providerGroups" :key="group.key" class="model-auth-provider-group" :data-part="group.key + '-group'" :aria-label="group.label">
              <h3 class="model-auth-group-label">{{ group.label }}</h3>
              <button v-for="provider in group.providers" :key="provider.id" type="button" class="model-auth-provider-row" part="provider-row" :class="{ focused: orderedProviders.indexOf(provider) === focusedProviderIndex, unavailable: !provider.available }" :data-provider-id="provider.id" @click="chooseProvider(provider)">
                <slot name="provider-row" :provider="provider" :method="method">
                  <span class="model-auth-provider-mark" :class="'mark-' + provider.id">{{ provider.mark || provider.name.trim().slice(0, 1).toUpperCase() }}</span>
                  <span class="model-auth-row-main"><strong>{{ provider.name }}</strong><small>{{ provider.available ? provider.id : provider.unavailableReason || text.unavailable }}</small></span>
                  <span class="model-auth-badge">{{ provider.available ? (method === 'oauth' ? (provider.oauthCredentials?.length || 0) + ' ' + text.oauthCount : (provider.apiKeyCredentials?.length || 0) + ' ' + text.apiKeyCount) : text.unavailable }}</span>
                  <span aria-hidden="true">→</span>
                </slot>
              </button>
            </section>
            <p v-if="!orderedProviders.length" class="model-auth-empty" role="status">{{ text.noProviders }}</p>
          </div>
        </div>

        <div v-else-if="connectionMissing" key="missing-connection" class="model-auth-detail" part="connection-empty" data-part="connection-empty">
          <p class="model-auth-empty" role="status">{{ text.noConnections }}</p>
          <button type="button" class="model-auth-primary" data-part="new-connection" :disabled="busy" @click="startNewConnection">{{ text.newConnection }}</button>
        </div>
        <div v-else-if="step === 'detail' && selectedProvider" key="detail" :class="['model-auth-detail', transitionName, { 'model-auth-connection-detail': connectionMode }]" part="detail" :data-part="connectionMode ? 'connection-info' : 'detail'">
          <strong class="model-auth-selected-provider">{{ selectedProvider.name }}</strong>
          <p v-if="connectionMode" class="model-auth-connection-meta">{{ text.authenticationMethod }}：{{ method === 'oauth' ? text.oauth : text.apiKey }}</p>
          <p v-if="!selectedProvider.available" class="model-auth-error" role="status">{{ selectedProvider.unavailableReason || text.unavailable }}</p>
          <button v-if="connectionMode" type="button" class="model-auth-secondary" data-part="refresh-connections" :disabled="busy" @click="emit('refresh-catalog')">{{ text.refreshCatalog }}</button>
          <section v-if="method === 'oauth'" class="model-auth-credential-section" data-part="oauth-config">
            <div class="model-auth-section-heading">
              <div><strong>{{ connectionMode ? text.connections : text.oauth }}</strong><small>{{ text.credentialHint }}</small></div>
              <button v-if="!connectionMode" type="button" class="model-auth-primary" :disabled="busy || !canUseMethod" @click="authorize()">{{ selectedProvider.authorizeLabel || text.authorize }}</button>
            </div>
            <label class="model-auth-toggle model-auth-provider-toggle">
              <input type="checkbox" role="switch" :checked="selectedProvider.oauthEnabled !== false" :disabled="busy" :aria-label="text.oauthEnabled" @change="emit('update-provider', { providerId: selectedProvider.id, oauthEnabled: ($event.target as HTMLInputElement).checked })" />
              <span class="model-auth-switch-track" aria-hidden="true"></span>{{ text.oauthEnabled }}
            </label>
          </section>
          <section v-else-if="!connectionMode" class="model-auth-credential-section" data-part="api-key-config">
            <form class="model-auth-api-form" part="api-key-form" data-part="api-key-form" @submit.prevent="addApiKey">
              <div><strong>{{ text.addApiKey }}</strong><small>{{ text.keyHint }}</small></div>
              <input v-model="labelInput" :disabled="busy || !canUseMethod" type="text" autocomplete="off" :placeholder="text.label" :aria-label="text.label" />
              <label class="model-auth-key-input">
                <input v-model="apiKeyInput" :disabled="busy || !canUseMethod" :type="revealApiKey ? 'text' : 'password'" autocomplete="off" :spellcheck="false" :placeholder="text.apiKeyPlaceholder" :aria-label="text.apiKey" />
                <button type="button" class="model-auth-subtle" :aria-pressed="revealApiKey" @click="revealApiKey = !revealApiKey">{{ revealApiKey ? text.hide : text.show }}</button>
              </label>
              <button type="submit" class="model-auth-primary" :disabled="busy || !canUseMethod || !apiKeyInput.trim()">{{ text.saveAndVerify }}</button>
            </form>
          </section>

          <section class="model-auth-credentials" :aria-label="text.credentials">
            <article v-for="credential in credentials" :key="credential.id" class="model-auth-credential-row" part="credential-row" :data-part="method === 'oauth' ? 'oauth-credential' : 'api-key-credential'">
              <slot name="credential-row" :credential="credential" :provider="selectedProvider" :method="method" :update="(enabled: boolean, weight: number) => updateCredential(credential, enabled, weight)" :remove="() => removeCredential(credential)">
                <div class="model-auth-credential-summary">
                  <span class="model-auth-health" :class="{ healthy: credential.enabled && credential.healthy }" aria-hidden="true"></span>
                  <span class="model-auth-row-main"><strong>{{ credential.label }}</strong><small>{{ connectionMode && credential.account ? text.account + ' · ' + credential.account + ' · ' : '' }}{{ credentialStatus(credential) }}</small></span>
                  <label class="model-auth-toggle">
                    <input :checked="credential.enabled" :disabled="busy" type="checkbox" role="switch" :aria-label="text.enable + ' ' + credential.label" @change="updateCredential(credential, ($event.target as HTMLInputElement).checked, credential.weight)" />
                    <span class="model-auth-switch-track" aria-hidden="true"></span>{{ text.enable }}
                  </label>
                </div>
                <div class="model-auth-credential-actions">
                  <label class="model-auth-weight">{{ text.weight }}<input :value="credential.weight" :disabled="busy" type="number" min="1" max="100" step="1" :aria-label="text.weight + ' ' + credential.label" @change="updateCredential(credential, credential.enabled, Number(($event.target as HTMLInputElement).value))" /></label>
                  <button v-if="method === 'oauth'" type="button" class="model-auth-secondary" :disabled="busy || !canUseMethod" @click="authorize(credential.id)">{{ text.reconnect }}</button>
                  <button v-if="selectedProvider.usageEnabled || credential.usage" type="button" class="model-auth-secondary" data-part="query-usage" :disabled="busy" @click="queryUsage(credential)">{{ credential.usage ? text.refreshUsage : text.queryUsage }}</button>
                  <button v-if="method === 'oauth' && selectedProvider.logoutEnabled" type="button" class="model-auth-secondary" data-part="logout" :disabled="busy" @click="emit('logout', selectedProvider!.id, credential.id)">{{ text.logout }}</button>
                  <button type="button" class="model-auth-danger" :disabled="busy" :data-confirmed="pendingRemoval === credential.id" @click="removeCredential(credential)">{{ pendingRemoval === credential.id ? text.confirmRemove : text.remove }}</button>
                </div>
                <details class="model-auth-credential-extend" data-part="credential-extend">
                  <summary>{{ text.extend }}</summary>
                  <textarea :value="extendText(credential)" :disabled="busy" :aria-label="text.extend" spellcheck="false" @change="updateExtend(credential, ($event.target as HTMLTextAreaElement).value)" />
                  <small>{{ text.extendHint }}</small>
                </details>
                <div v-if="credential.usage" class="model-auth-usage" data-part="credential-usage">
                  <span v-if="credential.usage.plan">{{ credential.usage.plan }}</span>
                  <span v-if="credential.usage.balance">{{ credential.usage.balance.amount }} {{ credential.usage.balance.unit }}</span>
                  <span v-for="window in credential.usage.windows" :key="window.id">{{ window.label }} · {{ window.usedPercent === null ? '—' : window.usedPercent.toFixed(1) + '%' }}</span>
                  <span v-if="credential.usage.error">{{ credential.usage.error }}</span>
                </div>
              </slot>
            </article>
            <p v-if="!credentials.length" class="model-auth-empty">{{ connectionMode ? text.noConnections : text.noCredentials }}</p>
          </section>
          <section v-if="connectionMode" class="model-auth-credential-section" data-part="connection-policy">
            <details class="model-auth-connection-models" open><summary>{{ text.models }} ({{ connectionModels.length }})</summary><ModelPicker :models="connectionModels" :available-models="availableModels" :selected="currentModel" :disabled="busy" :messages="text" @select="selectModel" /></details>
            <div class="model-auth-section-heading"><div><strong>{{ text.current }}</strong><small>{{ currentModel }}</small></div><StrategyPicker :model-value="currentStrategy" :options="strategyOptions" :label="text.strategy" :disabled="busy" @update:model-value="updateStrategy" /></div>
          </section>

        </div>
        <div v-else-if="step === 'confirmation' && selectedProvider" key="confirmation" :class="['model-auth-detail', transitionName]" data-part="confirmation-step">
          <strong class="model-auth-selected-provider">{{ selectedProvider.name }}</strong>
          <section data-part="authorization-result" role="status">
            <p>{{ text.authorizationComplete }}</p>
            <p>{{ method === 'oauth' ? text.oauth : text.apiKey }} · {{ text.verified }}</p>
          </section>
          <ModelPicker v-if="connectionModels.length" :models="connectionModels" :available-models="availableModels" :selected="currentModel" :disabled="busy" :messages="text" @select="selectModel" />
        </div>
        <footer v-if="!connectionMode && step === 'detail' && authReady" class="model-auth-actions">
          <button type="button" class="model-auth-primary" data-part="continue-confirmation" :disabled="busy" @click="advanceToConfirmation">{{ text.continue }}</button>
        </footer>
        <footer v-if="!connectionMode && step === 'confirmation' && authReady" class="model-auth-confirmation" part="confirmation" data-part="confirmation">
          <button type="button" class="model-auth-primary" data-part="confirm" :disabled="busy || !!error" @click="confirmConnection">{{ text.confirm }}</button>
        </footer>
        <slot name="footer" :step="step" :close="close"></slot>
      </section>
    </div>
  </dialog>
</template>
