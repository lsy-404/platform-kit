<script setup lang="ts">
import { computed, ref } from "vue";
import type { ModelAuthMessages } from "./messages";

const props = defineProps<{ models: string[]; messages: ModelAuthMessages }>();
const search = ref("");
const matches = computed(() => props.models.filter(model => model.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
</script>

<template>
  <section class="model-auth-model-section" part="models" data-part="models" :aria-label="messages.models">
    <input v-if="models.length > 8" v-model="search" type="search" class="model-auth-search" part="model-search" data-part="model-search" :aria-label="messages.modelSearch" :placeholder="messages.modelSearch" autocomplete="off" />
    <ul class="model-auth-models" :aria-label="messages.models">
      <li v-for="model in matches" :key="model" class="model-auth-model-row" part="model-row" data-part="model-row" :data-model-id="model">{{ model }}</li>
    </ul>
    <p v-if="!matches.length" class="model-auth-empty" role="status">{{ messages.emptyModels }}</p>
  </section>
</template>
