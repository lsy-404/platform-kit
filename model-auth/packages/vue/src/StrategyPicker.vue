<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from "vue";
import type { LoadStrategy } from "./types";
const props = defineProps<{ modelValue: LoadStrategy; options: { value: LoadStrategy; label: string }[]; label: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: LoadStrategy] }>();
const expanded = ref(false);
const trigger = ref<HTMLButtonElement>();
const list = ref<HTMLElement>();
const active = ref(0);
const menuStyle = ref<Record<string, string>>({});
const id = useId();
const current = computed(() => props.options.find(option => option.value === props.modelValue));
function positionMenu() {
  const element = trigger.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const menuHeight = Math.max(list.value?.offsetHeight ?? 0, props.options.length * 40 + 8);
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const below = rect.bottom + 4;
  const top = below + menuHeight <= viewportHeight - 8 ? below : Math.max(8, rect.top - menuHeight - 4);
  const maxLeft = Math.max(8, viewportWidth - 164 - 8);
  const left = Math.min(Math.max(8, rect.right - 164), maxLeft);
  menuStyle.value = { top: `${top}px`, left: `${left}px` };
}
async function open() {
  if (props.disabled) return;
  expanded.value = true;
  active.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue));
  await nextTick();
  positionMenu();
  window.addEventListener("resize", positionMenu);
  window.addEventListener("scroll", positionMenu, true);
  list.value?.focus();
}
function close() {
  expanded.value = false;
  window.removeEventListener("resize", positionMenu);
  window.removeEventListener("scroll", positionMenu, true);
}
function choose(value: LoadStrategy) { emit("update:modelValue", value); close(); trigger.value?.focus(); }
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
    event.stopPropagation(); event.preventDefault(); close(); trigger.value?.focus();
  } else if (event.key === "Tab") close();
}
function focusout(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) close();
}
onBeforeUnmount(close);
</script>
<template>
  <div class="model-auth-select" part="strategy" @keydown="keydown" @focusout="focusout">
    <button ref="trigger" type="button" class="model-auth-secondary" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="expanded" :aria-controls="id" @click="expanded ? close() : open()">
      {{ current?.label }} <svg class="model-auth-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div v-if="expanded" :id="id" ref="list" role="listbox" :aria-label="label" :aria-activedescendant="id + '-' + active" tabindex="-1" class="model-auth-select-menu" part="strategy-menu" :style="menuStyle">
      <button v-for="(option, index) in options" :id="id + '-' + index" :key="option.value" type="button" role="option" :aria-selected="modelValue === option.value" :class="{ focused: active === index }" tabindex="-1" @click="choose(option.value)">
        {{ option.label }} <svg v-if="modelValue === option.value" class="model-auth-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
      </button>
    </div>
  </div>
</template>
