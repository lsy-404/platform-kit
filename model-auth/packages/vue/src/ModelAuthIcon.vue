<script setup lang="ts">
import { ICON_PATHS, type ModelAuthIconName } from "./icons";

defineProps<{ name: ModelAuthIconName }>();
</script>

<template>
  <svg class="model-auth-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path v-for="d in ICON_PATHS[name]" :key="d" :d="d" /></svg>
</template>
