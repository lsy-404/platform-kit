<script setup lang="ts">
import { computed, ref } from "vue";
import type { ModelAuthMessages } from "./messages";

const props = defineProps<{
  models: string[];
  availableModels: string[];
  selected: string;
  disabled: boolean;
  messages: ModelAuthMessages;
}>();
const emit = defineEmits<{ select: [model: string] }>();
const search = ref("");
const matches = computed(() => props.models.filter(model => model.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const eligible = computed(() => new Set(props.availableModels));
function select(model: string) {
  if (!props.disabled && eligible.value.has(model)) emit("select", model);
}
</script>

<template>
  <section class="model-auth-model-section" part="models" data-part="models" :aria-label="messages.models">
    <input v-model="search" type="search" class="model-auth-search" part="model-search" data-part="model-search" :aria-label="messages.modelSearch" :placeholder="messages.modelSearch" autocomplete="off" />
    <div class="model-auth-models" role="group" :aria-label="messages.models">
      <button v-for="model in matches" :key="model" type="button" class="model-auth-model-row model-auth-secondary" part="model-row" data-part="model-row" :data-model-id="model" :aria-pressed="selected === model && eligible.has(model)" :disabled="disabled || !eligible.has(model)" @click="select(model)">
        <span>{{ model }}</span><small>{{ !eligible.has(model) ? messages.unavailable : selected === model ? messages.current : messages.select }}</small>
      </button>
      <p v-if="!matches.length" class="model-auth-empty" role="status">{{ messages.emptyModels }}</p>
    </div>
  </section>
</template>
