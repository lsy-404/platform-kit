<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { defaultMessages, type ModelAuthMessages } from "./messages";
import ModelList from "./ModelList.vue";
import ModelAuthIcon from "./ModelAuthIcon.vue";
import ProviderMark from "./ProviderMark.vue";
import { DEFAULT_PERCENTAGE_PRECISION, formatPercentage } from "./percentage";
import { credentialReady, credentialRemaining, fill, lowestRemaining } from "./usage";
import { connectionModels } from "./models";
import type { AuthMethod, ModelAuthProvider, ModelConnectionTarget, ProviderCredential, Theme } from "./types";

const props = withDefaults(defineProps<{
  providers?: ModelAuthProvider[];
  busy?: boolean;
  error?: string | null;
  styled?: boolean;
  theme?: Theme;
  messages?: Partial<ModelAuthMessages>;
  percentagePrecision?: number;
}>(), { providers: () => [], busy: false, error: null, styled: true, theme: "system", messages: () => ({}), percentagePrecision: DEFAULT_PERCENTAGE_PRECISION });
const emit = defineEmits<{ manage: [target: ModelConnectionTarget]; add: []; refresh: [] }>();
const text = computed(() => ({ ...defaultMessages, ...props.messages }));
const uid = useId();
const expanded = ref(new Set<string>());
const groups = computed(() => props.providers.flatMap(provider => (["oauth", "api-key"] as AuthMethod[]).flatMap(method => {
  const credentials = (method === "oauth" ? provider.oauthCredentials : provider.apiKeyCredentials) ?? [];
  return credentials.length ? [{ provider, method, credentials, models: connectionModels(provider, method) }] : [];
})));
const methodLabel = (method: AuthMethod) => method === "oauth" ? text.value.oauth : text.value.apiKey;
function status(credential: ProviderCredential) {
  if (!credential.enabled) return text.value.disabled;
  if (credential.cooldownUntilUtc) return `${text.value.cooling} ${credential.cooldownUntilUtc}`;
  return credential.healthy ? text.value.ready : text.value.needsReconnect;
}
function strategy(provider: ModelAuthProvider) {
  if (provider.loadStrategy === "failover") return text.value.failover;
  return provider.loadStrategy === "round-robin" ? text.value.roundRobin : "—";
}
const groupKey = (group: { provider: ModelAuthProvider; method: AuthMethod }) => `${group.provider.id}/${group.method}`;
const regionId = (group: { provider: ModelAuthProvider; method: AuthMethod }) => `${uid}-${groupKey(group)}`;
function toggle(group: { provider: ModelAuthProvider; method: AuthMethod }) {
  const next = new Set(expanded.value);
  const key = groupKey(group);
  if (!next.delete(key)) next.add(key);
  expanded.value = next;
}
const percent = (value: number) => formatPercentage(value, props.percentagePrecision) + "%";
function summaryParts(credentials: ProviderCredential[]): { text: string; attention?: boolean }[] {
  const parts: { text: string; attention?: boolean }[] = [{ text: fill(text.value.connectionSummary, { count: credentials.length, ready: credentials.filter(credentialReady).length }) }];
  const plan = credentials.map(credential => credential.usage?.plan).find(Boolean);
  if (plan) parts.push({ text: plan });
  const lowest = lowestRemaining(credentials);
  if (lowest !== null) parts.push({ text: fill(text.value.lowestRemaining, { percent: percent(lowest) }) });
  if (credentials.some(credential => credential.enabled && !credential.healthy)) parts.push({ text: text.value.needsReconnect, attention: true });
  return parts;
}
function modelCount(provider: ModelAuthProvider, method: AuthMethod, credential: ProviderCredential) {
  if (credential.models?.length) return credential.models.length;
  const models = method === "oauth" ? provider.oauthModels : provider.apiKeyModels;
  return (models?.length ? models : provider.models).length;
}
</script>

<template>
  <section class="model-auth-root model-auth-connections" :class="{ 'model-auth-styled': styled }" :data-theme="theme" :aria-label="text.connections" :aria-busy="busy" data-part="connections-panel">
    <header class="model-auth-connections-heading">
      <h3>{{ text.connections }}</h3>
      <div class="model-auth-connections-actions">
        <button type="button" class="model-auth-secondary" :disabled="busy" data-part="refresh-connections" @click="emit('refresh')">{{ text.refreshConnections }}</button>
        <button type="button" class="model-auth-primary" :disabled="busy" data-part="add-connection" @click="emit('add')">{{ text.newConnection }}</button>
      </div>
    </header>
    <p v-if="error" class="model-auth-error" role="alert">{{ error }}</p>
    <p v-if="busy" class="model-auth-busy" role="status">{{ text.working }}</p>
    <p v-if="!busy && !groups.length" class="model-auth-empty" data-part="no-connections">{{ text.noConnections }}</p>
    <article v-for="group in groups" :key="group.provider.id + '/' + group.method" class="model-auth-connection-card" data-part="connection-card" :data-provider-id="group.provider.id" :data-auth-method="group.method">
      <header class="model-auth-connections-heading">
        <div class="model-auth-connection-title"><ProviderMark :provider="group.provider" /><div><h4>{{ group.provider.name }}</h4><span class="model-auth-connection-meta">{{ methodLabel(group.method) }} · {{ text.strategy }}：{{ strategy(group.provider) }}</span></div></div>
        <button type="button" class="model-auth-secondary" :disabled="busy" :aria-label="text.viewConnection + ' · ' + group.provider.name + ' · ' + methodLabel(group.method)" data-part="view-connection" @click="emit('manage', { providerId: group.provider.id, method: group.method })">{{ text.viewConnection }}</button>
      </header>
      <p v-if="!group.provider.available && group.provider.unavailableReason" class="model-auth-connection-warning" role="status">{{ group.provider.unavailableReason }}</p>
      <p class="model-auth-connection-summary" data-part="connection-summary"><template v-for="(part, index) in summaryParts(group.credentials)" :key="index"><template v-if="index"> · </template><span v-if="part.attention" data-part="connection-attention" class="model-auth-connection-attention">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></p>
      <button type="button" class="model-auth-subtle model-auth-connection-toggle" data-part="toggle-connection" :aria-label="(expanded.has(groupKey(group)) ? text.hideDetails : text.showDetails) + ' · ' + group.provider.name + ' · ' + methodLabel(group.method)" :aria-expanded="expanded.has(groupKey(group))" :aria-controls="expanded.has(groupKey(group)) ? regionId(group) : undefined" @click="toggle(group)">{{ expanded.has(groupKey(group)) ? text.hideDetails : text.showDetails }}<ModelAuthIcon name="arrow-down" /></button>
      <div v-if="expanded.has(groupKey(group))" :id="regionId(group)" class="model-auth-connection-details" data-part="connection-details">
        <ul class="model-auth-connection-accounts">
          <li v-for="(credential, index) in group.credentials" :key="credential.id" data-part="connection-account">
            <div><strong>{{ credential.label }}</strong><small v-if="credential.account && credential.account !== credential.label">{{ text.account }}：{{ credential.account }}</small></div>
            <span>{{ status(credential) }}</span>
            <span class="model-auth-connection-meta">{{ text.position }} {{ index + 1 }} · {{ modelCount(group.provider, group.method, credential) }} {{ text.modelCount }}<template v-if="credentialRemaining(credential) !== null"> · {{ fill(text.lowestRemaining, { percent: percent(credentialRemaining(credential)!) }) }}</template></span>
          </li>
        </ul>
        <details class="model-auth-connection-models" data-part="connection-models">
          <summary>{{ text.models }} ({{ group.models.length }})</summary>
          <ModelList :models="group.models" :messages="text" />
        </details>
      </div>
    </article>
  </section>
</template>
