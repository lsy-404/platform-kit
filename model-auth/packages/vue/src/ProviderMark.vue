<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { providerIconUrl } from "./provider-icon";
import { builtinProviderIcon } from "./provider-icons";
import type { ModelAuthProvider } from "./types";

const props = defineProps<{ provider: ModelAuthProvider }>();
const failed = ref(false);
const hostIcon = computed(() => (failed.value ? null : providerIconUrl(props.provider)));
const builtin = computed(() => builtinProviderIcon(props.provider.id));
watch(() => props.provider.iconUrl, () => { failed.value = false; });
</script>

<template>
  <span class="model-auth-provider-mark" :class="'mark-' + provider.id">
    <img v-if="hostIcon" :src="hostIcon" alt="" aria-hidden="true" loading="lazy" decoding="async" @error="failed = true" />
    <span v-else-if="builtin" class="model-auth-provider-svg" aria-hidden="true" v-html="builtin"></span>
    <template v-else>{{ provider.mark || provider.name.trim().slice(0, 1).toUpperCase() }}</template>
  </span>
</template>
