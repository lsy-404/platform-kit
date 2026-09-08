<script setup lang="ts">
import { computed } from "vue";
import { defaultMessages, type ModelAuthMessages } from "./messages";
import type { AuthMethod, ModelAuthProvider, ModelAuthSelection, ModelConnectionTarget, OAuthCredential, Theme } from "./types";

const props = withDefaults(defineProps<{
  providers?: ModelAuthProvider[];
  model?: ModelAuthSelection | null;
  busy?: boolean;
  error?: string | null;
  styled?: boolean;
  theme?: Theme;
  messages?: Partial<ModelAuthMessages>;
}>(), { providers: () => [], model: null, busy: false, error: null, styled: true, theme: "system", messages: () => ({}) });
const emit = defineEmits<{ manage: [target: ModelConnectionTarget]; add: []; refresh: [] }>();
const text = computed(() => ({ ...defaultMessages, ...props.messages }));
const groups = computed(() => props.providers.flatMap(provider => (["oauth", "api-key"] as AuthMethod[]).flatMap(method => {
  const credentials = (method === "oauth" ? provider.oauthCredentials : provider.apiKeyCredentials) ?? [];
  return credentials.length ? [{ provider, method, credentials }] : [];
})));
const methodLabel = (method: AuthMethod) => method === "oauth" ? text.value.oauth : text.value.apiKey;
function status(credential: OAuthCredential) {
  if (!credential.enabled) return text.value.disabled;
  if (credential.cooldownUntilUtc) return `${text.value.cooling} ${credential.cooldownUntilUtc}`;
  return credential.healthy ? text.value.ready : text.value.needsReconnect;
}
function strategy(provider: ModelAuthProvider) {
  if (provider.loadStrategy === "failover") return text.value.failover;
  if (provider.loadStrategy === "weighted-round-robin") return text.value.weightedRoundRobin;
  return provider.loadStrategy === "round-robin" ? text.value.roundRobin : "—";
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
        <div><h4>{{ group.provider.name }}</h4><span class="model-auth-connection-meta">{{ methodLabel(group.method) }} · {{ text.strategy }}：{{ strategy(group.provider) }}</span></div>
        <button type="button" class="model-auth-secondary" :disabled="busy" :aria-label="text.viewConnection + ' · ' + group.provider.name + ' · ' + methodLabel(group.method)" data-part="view-connection" @click="emit('manage', { providerId: group.provider.id, method: group.method })">{{ text.viewConnection }}</button>
      </header>
      <p v-if="!group.provider.available && group.provider.unavailableReason" class="model-auth-connection-warning" role="status">{{ group.provider.unavailableReason }}</p>
      <ul class="model-auth-connection-accounts">
        <li v-for="credential in group.credentials" :key="credential.id" data-part="connection-account">
          <div><strong>{{ credential.label }}</strong><small v-if="credential.account && credential.account !== credential.label">{{ text.account }}：{{ credential.account }}</small></div>
          <span>{{ status(credential) }}</span>
          <span class="model-auth-connection-meta">{{ text.weight }} {{ credential.weight }} · {{ credential.models?.length ?? '—' }} {{ text.modelCount }}</span>
        </li>
      </ul>
      <p v-if="model?.providerId === group.provider.id" class="model-auth-connection-meta" data-part="connection-current-model">{{ text.current }}：{{ model.model }}</p>
    </article>
  </section>
</template>
