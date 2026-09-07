<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import type { LoadStrategy } from "./types";
const props = defineProps<{ modelValue: LoadStrategy; options: { value: LoadStrategy; label: string }[]; label: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: LoadStrategy] }>();
const expanded = ref(false);
const trigger = ref<HTMLButtonElement>();
const list = ref<HTMLElement>();
const active = ref(0);
const id = useId();
const current = computed(() => props.options.find(option => option.value === props.modelValue));
async function open() {
  if (props.disabled) return;
  expanded.value = true;
  active.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue));
  await nextTick();
  list.value?.focus();
}
function choose(value: LoadStrategy) { emit("update:modelValue", value); expanded.value = false; trigger.value?.focus(); }
function keydown(event: KeyboardEvent) {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (!expanded.value) { void open(); return; }
    const count = props.options.length;
    if (!count) return;
    active.value = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (active.value + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!expanded.value) void open();
    else if (props.options[active.value]) choose(props.options[active.value]!.value);
  } else if (event.key === "Escape" && expanded.value) {
    event.stopPropagation(); event.preventDefault(); expanded.value = false; trigger.value?.focus();
  } else if (event.key === "Tab") expanded.value = false;
}
function focusout(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) expanded.value = false;
}
</script>
<template>
  <div class="model-auth-select" part="strategy" @keydown="keydown" @focusout="focusout">
    <button ref="trigger" type="button" class="model-auth-secondary" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="expanded" :aria-controls="id" @click="expanded ? expanded = false : open()">
      {{ current?.label }} <span aria-hidden="true">⌄</span>
    </button>
    <div v-if="expanded" :id="id" ref="list" role="listbox" :aria-label="label" :aria-activedescendant="id + '-' + active" tabindex="-1" class="model-auth-select-menu" part="strategy-menu">
      <button v-for="(option, index) in options" :id="id + '-' + index" :key="option.value" type="button" role="option" :aria-selected="modelValue === option.value" :class="{ focused: active === index }" tabindex="-1" @click="choose(option.value)">
        {{ option.label }} <span v-if="modelValue === option.value" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>
