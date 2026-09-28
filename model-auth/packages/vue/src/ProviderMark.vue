<script setup lang="ts">
import { computed, ref } from "vue";
import { providerIconUrls } from "./provider-icon";
import type { ModelAuthProvider } from "./types";

const props = defineProps<{ provider: ModelAuthProvider }>();
const failed = ref(new Set<string>());
const icon = computed(() => providerIconUrls(props.provider).find(url => !failed.value.has(url)) ?? null);
function onError() {
  if (icon.value) failed.value = new Set(failed.value).add(icon.value);
}
</script>

<template>
  <span class="model-auth-provider-mark" :class="'mark-' + provider.id">
    <img v-if="icon" :src="icon" alt="" aria-hidden="true" loading="lazy" decoding="async" @error="onError" />
    <template v-else>{{ provider.mark || provider.name.trim().slice(0, 1).toUpperCase() }}</template>
  </span>
</template>
