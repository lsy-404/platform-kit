<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from "vue";
import { defaultMessages, type ModelAuthMessages } from "./messages";
import ModelAuthIcon from "./ModelAuthIcon.vue";
import ProviderMark from "./ProviderMark.vue";
import { formatPercentage } from "./percentage";
import { fill, formatCooldown, windowRemaining } from "./usage";
import type {
  AddApiKeyPayload, AuthMethod, CredentialExtend, CredentialLoginInput, CredentialReorderPayload, CredentialUpdatePayload, CatalogStatus, 
  ModelAuthProvider, ModelConnectionTarget, ProviderAuthResponseRequest, ProviderAuthState, ProviderCredential, ProviderAuthNotice, ProviderUpdatePayload, Theme, CredentialUsageEstimate, CredentialUsageWindow,
} from "./types";

const props = withDefaults(defineProps<{
  open?: boolean;
  providers?: ModelAuthProvider[];
  styled?: boolean;
  theme?: Theme;
  initialMethod?: AuthMethod;
  separateAuthMethods?: boolean;
  initialConnection?: ModelConnectionTarget | null;
  catalogStatus?: CatalogStatus;
  messages?: Partial<ModelAuthMessages>;
  percentagePrecision?: number;
  busy?: boolean;
  error?: string | null;
  auth?: ProviderAuthState;
}>(), {
  open: false, separateAuthMethods: false, providers: () => [], styled: true, theme: "system", initialMethod: "oauth", initialConnection: null,
  catalogStatus: () => ({ state: "loading" }),
  messages: () => ({}), busy: false, error: null,
  percentagePrecision: 2,
  auth: () => ({ status: "idle", loginId: null, notices: [], prompt: null, error: null }),
});
const emit = defineEmits<{
  close: [];
  "authorize-oauth": [providerId: string];
  "reconnect-oauth": [providerId: string, credentialId: string];
  "remove-oauth": [providerId: string, credentialId: string];
  "update-credential": [payload: CredentialUpdatePayload];
  "reorder-credentials": [payload: CredentialReorderPayload];
  "update-provider": [payload: ProviderUpdatePayload];
  "add-api-key": [payload: AddApiKeyPayload];
  "remove-api-key": [providerId: string, credentialId: string];
  "refresh-catalog": [];
  "query-usage": [providerId: string, credentialId: string];
  logout: [providerId: string, credentialId: string];
  "respond-auth": [response: ProviderAuthResponseRequest];
  "cancel-auth": [loginId: string];
  "open-auth-url": [url: string];
}>();

type Step = "method" | "providers" | "detail" | "confirmation";
const step = ref<Step>("providers");
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
const accountUsername = ref("");
const accountPassword = ref("");
const methodLabel = (value: AuthMethod) => value === "oauth" ? text.value.oauth : text.value.apiKey;
const secretDrafts = reactive<Record<string, string>>({});
const labelDrafts = reactive<Record<string, string>>({});
const loginDrafts = reactive<Record<string, { username?: string; password?: string }>>({});
const pendingLoginClear = ref("");
const hiddenSecrets = reactive<Record<string, boolean>>({});
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
const steps = computed<Step[]>(() => props.separateAuthMethods ? ["method", "providers", "detail", "confirmation"] : ["providers", "detail", "confirmation"]);
const stepIndex = computed(() => steps.value.indexOf(step.value));
const stageCount = computed(() => steps.value.length - 1);
const pageTitles = computed(() => props.separateAuthMethods
  ? [text.value.addConnection, text.value.chooseProvider, text.value.completeConfiguration, text.value.confirm]
  : [text.value.chooseProvider, text.value.completeConfiguration, text.value.confirm]);
const selectedProvider = computed(() => props.providers.find(provider => provider.id === selectedProviderId.value));
const connectionMissing = computed(() => connectionMode.value && !selectedProvider.value);
const matchingProviders = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return props.providers.flatMap(provider => provider.authMethods.filter(value => !props.separateAuthMethods || value === method.value).map(method => ({ provider, method })))
    .filter(entry => [entry.provider.name, entry.provider.description, entry.provider.id, methodLabel(entry.method)].some(value => value.toLocaleLowerCase().includes(query)));
});
const providerGroups = computed(() => [
  { key: "available", label: text.value.available, providers: matchingProviders.value.filter(entry => entry.provider.available) },
  { key: "unavailable", label: text.value.unavailable, providers: matchingProviders.value.filter(entry => !entry.provider.available) },
].filter(group => group.providers.length));
const orderedProviders = computed(() => providerGroups.value.flatMap(group => group.providers));
const credentials = computed<ProviderCredential[]>(() => {
  const provider = selectedProvider.value;
  return (method.value === "oauth" ? provider?.oauthCredentials : provider?.apiKeyCredentials) ?? [];
});
const canUseMethod = computed(() => Boolean(selectedProvider.value?.available
  && selectedProvider.value.authMethods.includes(method.value)
  && (method.value !== "oauth" || selectedProvider.value.oauthEnabled !== false)));
const eligibleCredentials = computed(() => canUseMethod.value ? credentials.value.filter(credential => credential.enabled && credential.healthy
  && (!credential.cooldownUntilUtc || Date.parse(credential.cooldownUntilUtc) <= Date.now())) : []);
const authReady = computed(() => eligibleCredentials.value.length > 0);
const activePrompt = computed(() => props.auth?.prompt?.prompt ?? null);
const activePromptId = computed(() => props.auth?.prompt?.promptId ?? "");

function activeElement(): Element | null {
  let element: Element | null = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}
function clearNewKey() { labelInput.value = ""; apiKeyInput.value = ""; revealApiKey.value = false; }
function clearSecret() {
  clearNewKey(); accountUsername.value = ""; accountPassword.value = "";
  for (const id of Object.keys(secretDrafts)) delete secretDrafts[id];
  for (const id of Object.keys(labelDrafts)) delete labelDrafts[id];
  for (const id of Object.keys(loginDrafts)) delete loginDrafts[id];
  pendingLoginClear.value = "";
  for (const id of Object.keys(hiddenSecrets)) delete hiddenSecrets[id];
}
function resetState() {
  awaitingVerification = false;
  connectionMode.value = Boolean(props.initialConnection);
  method.value = props.initialConnection?.method ?? props.initialMethod;
  step.value = props.initialConnection ? "detail" : props.separateAuthMethods ? "method" : "providers";
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
  method.value = value; step.value = "providers"; search.value = ""; selectedProviderId.value = "";
  transitionName.value = "model-auth-step-forward"; clearSecret(); void nextTick(() => searchInput.value?.focus());
}
function chooseProvider(entry: { provider: ModelAuthProvider; method: AuthMethod }) {
  const { provider, method: chosenMethod } = entry; method.value = chosenMethod;
  transitionName.value = "model-auth-step-forward"; clearSecret(); selectedProviderId.value = provider.id; step.value = "detail";
  pendingRemoval.value = ""; localError.value = ""; void focusHeading();
}
function back() {
  if (connectionMode.value) return;
  awaitingVerification = false;
  clearSecret(); pendingRemoval.value = ""; localError.value = "";
  transitionName.value = "model-auth-step-backward";
  if (step.value === "detail") { step.value = "providers"; void nextTick(() => searchInput.value?.focus()); }
  else { step.value = props.separateAuthMethods ? "method" : "providers"; selectedProviderId.value = ""; void focusHeading(); }
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
function closedDetailsAncestors(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = element.closest<HTMLElement>("details:not([open])"); node; node = node.parentElement?.closest<HTMLElement>("details:not([open])") ?? null) found.push(node);
  return found;
}
function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex='0'], a[href], summary")]
    .filter(element => element.tabIndex >= 0 && !element.closest("[hidden]")
      && !closedDetailsAncestors(element).some(details => !(element.matches("summary") && element.parentElement === details)));
  const first = focusable[0], last = focusable.at(-1), active = activeElement();
  if (!first || !last) { event.preventDefault(); dialog.value.focus(); return; }
  if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) {
    event.preventDefault(); first.focus();
  }
}
function updateCredential(credential: ProviderCredential, enabled: boolean, patch: { extend?: CredentialExtend; secret?: string; label?: string; login?: CredentialLoginInput | null } = {}) {
  const provider = selectedProvider.value;
  if (!provider || props.busy) return;
  localError.value = "";
  emit("update-credential", { providerId: provider.id, credentialId: credential.id, enabled, ...(patch.extend ? { extend: patch.extend } : {}), ...(patch.secret !== undefined ? { secret: patch.secret } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.login !== undefined ? { login: patch.login } : {}) });
}
function secretValue(credential: ProviderCredential): string {
  return secretDrafts[credential.id] ?? credential.secret ?? "";
}
function secretChanged(credential: ProviderCredential): boolean {
  const value = secretValue(credential).trim();
  return Boolean(value) && value !== (credential.secret ?? "");
}
function saveSecret(credential: ProviderCredential) {
  if (secretChanged(credential)) updateCredential(credential, credential.enabled, { secret: secretValue(credential).trim() });
}
function labelValue(credential: ProviderCredential): string {
  return labelDrafts[credential.id] ?? credential.label;
}
function labelChanged(credential: ProviderCredential): boolean {
  const value = labelValue(credential).trim();
  return Boolean(value) && value !== credential.label;
}
function rename(credential: ProviderCredential, label: string) {
  const value = label.trim();
  if (value && value !== credential.label) updateCredential(credential, credential.enabled, { label: value });
}
function onLabelEnter(event: KeyboardEvent, credential: ProviderCredential) {
  if (event.isComposing || event.keyCode === 229) return;
  saveLabel(credential);
}
function saveLabel(credential: ProviderCredential) {
  rename(credential, labelValue(credential));
}
function loginUsername(credential: ProviderCredential): string {
  return loginDrafts[credential.id]?.username ?? credential.login?.username ?? "";
}
function loginPassword(credential: ProviderCredential): string {
  return loginDrafts[credential.id]?.password ?? "";
}
function setLoginDraft(credential: ProviderCredential, field: "username" | "password", value: string) {
  loginDrafts[credential.id] = { ...loginDrafts[credential.id], [field]: value };
}
function loginSavable(credential: ProviderCredential): boolean {
  const username = loginUsername(credential).trim();
  if (!username) return false;
  if (loginPassword(credential)) return true;
  return Boolean(credential.login?.passwordSaved) && username !== credential.login?.username;
}
function saveLogin(credential: ProviderCredential, login: CredentialLoginInput | null) {
  if (props.busy) return;
  updateCredential(credential, credential.enabled, { login });
  delete loginDrafts[credential.id];
  pendingLoginClear.value = "";
}
function submitLogin(credential: ProviderCredential) {
  if (!loginSavable(credential)) return;
  const password = loginPassword(credential);
  saveLogin(credential, { username: loginUsername(credential).trim(), ...(password ? { password } : {}) });
}
function clearLogin(credential: ProviderCredential) {
  if (props.busy) return;
  if (pendingLoginClear.value !== credential.id) { pendingLoginClear.value = credential.id; return; }
  saveLogin(credential, null);
}
function moveCredential(index: number, offset: -1 | 1) {
  const provider = selectedProvider.value;
  const target = index + offset;
  if (!provider || props.busy || target < 0 || target >= credentials.value.length) return;
  const credentialIds = credentials.value.map(credential => credential.id);
  [credentialIds[index], credentialIds[target]] = [credentialIds[target]!, credentialIds[index]!];
  emit("reorder-credentials", { providerId: provider.id, method: method.value, credentialIds });
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
    updateCredential(credential, credential.enabled, { extend });
  } catch {
    localError.value = text.value.extendInvalid;
  }
}
function queryUsage(credential: ProviderCredential) {
  const provider = selectedProvider.value;
  if (!provider || props.busy || (!provider.usageEnabled && !credential.usage)) return;
  emit("query-usage", provider.id, credential.id);
}
function usageEstimateText(estimate: CredentialUsageEstimate): string {
  const remaining = estimate.remainingPercent === null ? text.value.remainingUnknown : `${formatPercentage(estimate.remainingPercent, props.percentagePrecision)}%`;
  return text.value.usageEstimate.replace("{tokens}", new Intl.NumberFormat().format(estimate.windowTokens)).replace("{remaining}", remaining);
}
function usagePercentText(value: number | null): string {
  return value === null ? "—" : formatPercentage(value, props.percentagePrecision) + "%";
}
function windowText(window: CredentialUsageWindow): string {
  return fill(text.value.usageRemaining, { label: window.label, percent: usagePercentText(windowRemaining(window)) });
}
function windowTitle(window: CredentialUsageWindow): string | undefined {
  return window.resetAt ? new Date(window.resetAt).toLocaleString() : undefined;
}
function windowLow(window: CredentialUsageWindow): boolean {
  return window.status === "exhausted" || (windowRemaining(window) ?? 100) <= 10;
}
function credentialCount(entry: { provider: ModelAuthProvider; method: AuthMethod }): number {
  return ((entry.method === "oauth" ? entry.provider.oauthCredentials : entry.provider.apiKeyCredentials) ?? []).length;
}
const needsReconnect = (credential: ProviderCredential) => credential.enabled && !credential.healthy;
const isHealthy = (credential: ProviderCredential) => credential.enabled && credential.healthy && !credential.cooldownUntilUtc;
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
  if (provider.accountLogin && Boolean(accountUsername.value.trim()) !== Boolean(accountPassword.value)) return;
  const payload = { providerId: provider.id, label: labelInput.value.trim(), apiKey: apiKeyInput.value.trim(),
    ...(provider.accountLogin && accountUsername.value.trim() && accountPassword.value ? { login: { username: accountUsername.value.trim(), password: accountPassword.value } } : {}) };
  accountUsername.value = ""; accountPassword.value = "";
  clearNewKey(); awaitingVerification = true; emit("add-api-key", payload); void nextTick(checkVerification);
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
  step.value = props.separateAuthMethods ? "method" : "providers"; selectedProviderId.value = ""; search.value = "";
  pendingRemoval.value = ""; localError.value = ""; clearSecret(); void focusHeading();
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
  if (credential.cooldownUntilUtc) return text.value.cooling + " " + formatCooldown(credential.cooldownUntilUtc);
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
watch(() => props.separateAuthMethods, () => { if (!connectionMode.value) resetState(); });
watch(search, () => { focusedProviderIndex.value = -1; });
watch(activePromptId, () => { promptValue.value = ""; });
watch([authReady, () => props.busy, () => props.error], () => {
  if (!authReady.value && step.value === "confirmation") { step.value = "detail"; void focusHeading(); }
  checkVerification();
});
watch(() => credentials.value.map(credential => [credential.id, credential.secret] as const), (current, previous) => {
  const before = new Map(previous);
  for (const [id, secret] of current) if (before.get(id) !== secret) delete secretDrafts[id];
});
watch(() => credentials.value.map(credential => [credential.id, credential.label] as const), (current, previous) => {
  const before = new Map(previous);
  for (const [id, label] of current) if (before.get(id) !== label) delete labelDrafts[id];
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
          <button v-if="stepIndex > 0 && !connectionMode && step !== 'confirmation'" type="button" class="model-auth-back" part="back" data-part="back" :aria-label="text.back" @click="back"><ModelAuthIcon name="back" /></button>
          <h2 :id="titleId" ref="heading" class="model-auth-title" tabindex="-1">{{ connectionMode ? text.connectionInfo : pageTitles[stepIndex] }}</h2>
          <button type="button" class="model-auth-close" part="close" data-part="close" :aria-label="text.close" @click="close"><ModelAuthIcon name="close" /></button>
        </header>
        <div v-if="!connectionMode" class="model-auth-progress" part="progress" role="progressbar" :aria-label="text.progress" :aria-valuemin="0" :aria-valuemax="stageCount" :aria-valuenow="stepIndex" :aria-valuetext="pageTitles[stepIndex]">
          <div v-for="segment in stageCount" :key="segment" class="model-auth-progress-segment"><div class="model-auth-progress-fill" :style="{ width: (segment <= stepIndex ? 100 : 0) + '%' }" /></div>
        </div>
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
              <span class="model-auth-method-icon" aria-hidden="true"><ModelAuthIcon :name="choice === 'oauth' ? 'oauth' : 'key'" /></span>
              <span><strong>{{ methodLabel(choice) }}</strong><small>{{ choice === 'oauth' ? text.oauthDescription : text.apiKeyDescription }}</small></span>
              <ModelAuthIcon name="next" />
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
              <button v-for="entry in group.providers" :key="entry.provider.id + '/' + entry.method" type="button" class="model-auth-provider-row" part="provider-row" :class="{ focused: orderedProviders.indexOf(entry) === focusedProviderIndex, unavailable: !entry.provider.available }" :data-provider-id="entry.provider.id" :data-auth-method="entry.method" @click="chooseProvider(entry)">
                <slot name="provider-row" :provider="entry.provider" :method="entry.method">
                  <ProviderMark :provider="entry.provider" />
                  <span class="model-auth-row-main"><strong>{{ entry.provider.name }}</strong><small>{{ entry.provider.available ? methodLabel(entry.method) : entry.provider.unavailableReason || text.unavailable }}</small></span>
                  <span v-if="entry.provider.available && credentialCount(entry) > 0" class="model-auth-badge">{{ credentialCount(entry) }} {{ entry.method === 'api-key' ? text.apiKeyCount : text.accountCount }}</span>
                  <ModelAuthIcon name="next" class="model-auth-row-chevron" />
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
          <div class="model-auth-connection-title">
            <ProviderMark :provider="selectedProvider" />
            <div><h3>{{ selectedProvider.name }}</h3><span class="model-auth-connection-meta">{{ methodLabel(method) }}</span></div>
            <button v-if="connectionMode" type="button" class="model-auth-secondary" data-part="refresh-connections" :disabled="busy" @click="emit('refresh-catalog')">{{ text.refreshCatalog }}</button>
          </div>
          <p v-if="!selectedProvider.available" class="model-auth-error" role="status">{{ selectedProvider.unavailableReason || text.unavailable }}</p>
          <section v-if="method === 'oauth'" class="model-auth-credential-section" data-part="oauth-config">
            <div v-if="connectionMode || credentials.length" class="model-auth-section-heading">
              <small v-if="credentials.length > 1">{{ text.credentialHint }}</small>
              <button type="button" class="model-auth-primary" data-part="authorize" :disabled="busy || !canUseMethod" @click="authorize()">{{ selectedProvider.authorizeLabel || text.authorize }}</button>
            </div>
            <label v-if="connectionMode || credentials.length || selectedProvider.oauthEnabled === false" class="model-auth-toggle model-auth-provider-toggle">
              <input type="checkbox" role="switch" :checked="selectedProvider.oauthEnabled !== false" :disabled="busy" :aria-label="text.oauthEnabled" @change="emit('update-provider', { providerId: selectedProvider.id, oauthEnabled: ($event.target as HTMLInputElement).checked })" />
              <span class="model-auth-switch-track" aria-hidden="true"></span>{{ text.oauthEnabled }}
            </label>
          </section>
          <section v-else class="model-auth-credential-section" data-part="api-key-config">
            <form class="model-auth-api-form" part="api-key-form" data-part="api-key-form" @submit.prevent="addApiKey">
              <div><strong>{{ text.addApiKey }}</strong><small>{{ text.keyHint }}</small></div>
              <input v-model="labelInput" :disabled="busy || !canUseMethod" type="text" autocomplete="off" :placeholder="text.label" :aria-label="text.label" />
              <label class="model-auth-key-input">
                <input v-model="apiKeyInput" :disabled="busy || !canUseMethod" :type="revealApiKey ? 'text' : 'password'" autocomplete="off" :spellcheck="false" :placeholder="text.apiKeyPlaceholder" :aria-label="text.apiKey" />
                <button type="button" class="model-auth-subtle model-auth-with-icon" :aria-pressed="revealApiKey" @click="revealApiKey = !revealApiKey"><ModelAuthIcon :name="revealApiKey ? 'eye-off' : 'eye'" />{{ revealApiKey ? text.hide : text.show }}</button>
              </label>
              <details v-if="selectedProvider.accountLogin" class="model-auth-credential-login" data-part="key-login-info">
                <summary>{{ text.accountLogin }}</summary>
                <small>{{ text.accountLoginHint }}</small>
                <input v-model="accountUsername" :disabled="busy" autocomplete="username" :placeholder="text.username" :aria-label="text.username" />
                <input v-model="accountPassword" :disabled="busy" type="password" autocomplete="current-password" :placeholder="text.password" :aria-label="text.password" />
              </details>
              <button type="submit" class="model-auth-primary" :disabled="busy || !canUseMethod || !apiKeyInput.trim() || (selectedProvider.accountLogin && Boolean(accountUsername.trim()) !== Boolean(accountPassword))">{{ text.saveAndVerify }}</button>
            </form>
          </section>

          <section class="model-auth-credentials" :aria-label="text.credentials">
            <article v-for="(credential, index) in credentials" :key="credential.id" class="model-auth-credential-row" part="credential-row" :data-part="method === 'oauth' ? 'oauth-credential' : 'api-key-credential'">
              <slot name="credential-row" :credential="credential" :provider="selectedProvider" :method="method" :update="(enabled: boolean) => updateCredential(credential, enabled)" :remove="() => removeCredential(credential)" :rename="(label: string) => rename(credential, label)" :save-login="(login: CredentialLoginInput | null) => saveLogin(credential, login)">
                <div class="model-auth-credential-summary">
                  <span class="model-auth-health" :class="{ healthy: isHealthy(credential), attention: needsReconnect(credential) }" aria-hidden="true"></span>
                  <span class="model-auth-row-main"><strong>{{ credential.label }}</strong><small :class="{ 'model-auth-connection-attention': needsReconnect(credential) }" :title="credential.cooldownUntilUtc ?? undefined">{{ connectionMode && credential.account ? text.account + ' · ' + credential.account + ' · ' : '' }}{{ credentialStatus(credential) }}</small></span>
                  <span v-if="credentials.length > 1" class="model-auth-move-group">
                    <button v-if="index > 0" type="button" class="model-auth-subtle model-auth-with-icon model-auth-move" data-part="move-up" :disabled="busy" :aria-label="text.moveUp + ' ' + credential.label" @click="moveCredential(index, -1)"><ModelAuthIcon name="arrow-up" /></button>
                    <span v-else class="model-auth-move-spacer" aria-hidden="true"></span>
                    <button v-if="index < credentials.length - 1" type="button" class="model-auth-subtle model-auth-with-icon model-auth-move" data-part="move-down" :disabled="busy" :aria-label="text.moveDown + ' ' + credential.label" @click="moveCredential(index, 1)"><ModelAuthIcon name="arrow-down" /></button>
                    <span v-else class="model-auth-move-spacer" aria-hidden="true"></span>
                  </span>
                  <label class="model-auth-toggle">
                    <input :checked="credential.enabled" :disabled="busy" type="checkbox" role="switch" :aria-label="text.enable + ' ' + credential.label" @change="updateCredential(credential, ($event.target as HTMLInputElement).checked)" />
                    <span class="model-auth-switch-track" aria-hidden="true"></span>{{ text.enable }}
                  </label>
                </div>
                <div v-if="credential.usage || selectedProvider.usageEnabled" class="model-auth-usage" data-part="credential-usage">
                  <template v-if="credential.usage">
                    <span v-if="credential.usage.plan">{{ credential.usage.plan }}</span>
                    <span v-if="credential.usage.balance">{{ credential.usage.balance.amount }} {{ credential.usage.balance.unit }}</span>
                    <span v-for="window in credential.usage.windows" :key="window.id" :title="windowTitle(window)" :data-low="windowLow(window)">{{ windowText(window) }}</span>
                    <span v-if="credential.usage.estimate">{{ usageEstimateText(credential.usage.estimate) }}</span>
                    <span v-if="credential.usage.error">{{ credential.usage.error }}</span>
                  </template>
                  <button type="button" class="model-auth-subtle" data-part="query-usage" :disabled="busy" @click="queryUsage(credential)">{{ credential.usage ? text.refreshUsage : text.queryUsage }}</button>
                </div>
                <div v-if="method === 'oauth' && needsReconnect(credential)" class="model-auth-credential-actions">
                  <button type="button" class="model-auth-primary" data-part="reconnect" :disabled="busy || !canUseMethod" @click="authorize(credential.id)">{{ text.reconnect }}</button>
                </div>
                <details class="model-auth-credential-settings" data-part="credential-settings">
                  <summary>{{ text.credentialSettings }}</summary>
                  <div class="model-auth-credential-rename">
                    <input :value="labelValue(credential)" :disabled="busy" maxlength="80" type="text" autocomplete="off" data-part="credential-label" :aria-label="text.label" @input="labelDrafts[credential.id] = ($event.target as HTMLInputElement).value" @keydown.enter.prevent="onLabelEnter($event, credential)" />
                    <button type="button" class="model-auth-secondary" data-part="save-label" :disabled="busy || !labelChanged(credential)" @click="saveLabel(credential)">{{ text.saveLabel }}</button>
                  </div>
                  <div v-if="credential.secret !== undefined" class="model-auth-credential-secret" data-part="credential-secret">
                    <label class="model-auth-key-input">
                      <input :value="secretValue(credential)" :disabled="busy" :type="hiddenSecrets[credential.id] ? 'password' : 'text'" autocomplete="off" :spellcheck="false" :aria-label="text.secret + ' ' + credential.label" @input="secretDrafts[credential.id] = ($event.target as HTMLInputElement).value" />
                      <button type="button" class="model-auth-subtle model-auth-with-icon" data-part="toggle-secret" :aria-pressed="!!hiddenSecrets[credential.id]" @click="hiddenSecrets[credential.id] = !hiddenSecrets[credential.id]"><ModelAuthIcon :name="hiddenSecrets[credential.id] ? 'eye' : 'eye-off'" />{{ hiddenSecrets[credential.id] ? text.show : text.hide }}</button>
                    </label>
                    <button type="button" class="model-auth-secondary" data-part="save-secret" :disabled="busy || !secretChanged(credential)" @click="saveSecret(credential)">{{ text.saveSecret }}</button>
                  </div>
                  <form v-if="method === 'api-key' && selectedProvider.accountLogin === true" class="model-auth-credential-login" data-part="credential-login" @submit.prevent="submitLogin(credential)">
                    <div><strong>{{ text.accountLogin }}</strong><small>{{ text.accountLoginHint }}</small></div>
                    <input :value="loginUsername(credential)" :disabled="busy" type="text" inputmode="email" autocomplete="username" data-part="login-username" :placeholder="text.username" :aria-label="text.username" @input="setLoginDraft(credential, 'username', ($event.target as HTMLInputElement).value)" />
                    <input :value="loginPassword(credential)" :disabled="busy" type="password" autocomplete="current-password" data-part="login-password" :placeholder="credential.login?.passwordSaved ? text.passwordSaved : text.password" :aria-label="text.password" @input="setLoginDraft(credential, 'password', ($event.target as HTMLInputElement).value)" />
                    <div class="model-auth-credential-actions">
                      <button type="submit" class="model-auth-secondary" data-part="save-login" :disabled="busy || !loginSavable(credential)">{{ text.saveLogin }}</button>
                      <button v-if="credential.login" type="button" class="model-auth-danger" data-part="clear-login" :disabled="busy" :data-confirmed="pendingLoginClear === credential.id" @click="clearLogin(credential)">{{ pendingLoginClear === credential.id ? text.confirmRemove : text.clearLogin }}</button>
                    </div>
                  </form>
                  <details class="model-auth-credential-extend" data-part="credential-extend">
                    <summary>{{ text.extend }}</summary>
                    <textarea :value="extendText(credential)" :disabled="busy" :aria-label="text.extend" spellcheck="false" @change="updateExtend(credential, ($event.target as HTMLTextAreaElement).value)" />
                    <small>{{ text.extendHint }}</small>
                  </details>
                  <div class="model-auth-credential-actions">
                    <button v-if="method === 'oauth' && selectedProvider.logoutEnabled" type="button" class="model-auth-secondary" data-part="logout" :disabled="busy" @click="emit('logout', selectedProvider!.id, credential.id)">{{ text.logout }}</button>
                    <button type="button" class="model-auth-danger" :disabled="busy" :data-confirmed="pendingRemoval === credential.id" @click="removeCredential(credential)">{{ pendingRemoval === credential.id ? text.confirmRemove : text.remove }}</button>
                  </div>
                </details>
              </slot>
            </article>
            <div v-if="!credentials.length" class="model-auth-empty">
              <p>{{ connectionMode ? text.noConnections : text.noCredentials }}</p>
              <button v-if="method === 'oauth' && !connectionMode" type="button" class="model-auth-primary" data-part="authorize" :disabled="busy || !canUseMethod" @click="authorize()">{{ selectedProvider.authorizeLabel || text.authorize }}</button>
            </div>
          </section>

        </div>
        <div v-else-if="step === 'confirmation' && selectedProvider" key="confirmation" :class="['model-auth-detail', transitionName]" data-part="confirmation-step">
          <div class="model-auth-connection-title">
            <ProviderMark :provider="selectedProvider" />
            <div><h3>{{ selectedProvider.name }}</h3><span class="model-auth-connection-meta">{{ methodLabel(method) }}</span></div>
          </div>
          <section class="model-auth-success" data-part="authorization-result" role="status">
            <ModelAuthIcon name="check" />
            <p class="model-auth-success-title">{{ text.authorizationComplete }}</p>
            <small>{{ text.verified }}</small>
          </section>
        </div>
        <footer v-if="!connectionMode && step === 'detail' && authReady" class="model-auth-actions">
          <button type="button" class="model-auth-primary" data-part="continue-confirmation" :disabled="busy" @click="advanceToConfirmation">{{ text.continue }}</button>
        </footer>
        <footer v-if="!connectionMode && step === 'confirmation' && authReady" class="model-auth-confirmation" part="confirmation" data-part="confirmation">
          <button type="button" class="model-auth-primary" data-part="confirm" :disabled="busy || !!error" @click="confirmConnection">{{ text.done }}</button>
        </footer>
        <slot name="footer" :step="step" :close="close"></slot>
      </section>
    </div>
  </dialog>
</template>
