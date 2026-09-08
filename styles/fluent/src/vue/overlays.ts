import {
  computed,
  defineComponent,
  h,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  Teleport,
  watch,
  type ComputedRef,
  type PropType,
} from "vue";
import { placeAnchored } from "../behavior/anchorPosition.js";
import { registerOverlay, requestCloseTop } from "../behavior/overlayStack.js";
import { fluentThemeKey } from "../theme.js";

type FluentTheme = {
  mode: "light" | "dark";
  accent?: string;
  accentText?: string;
};
const fallbackTheme = computed<FluentTheme>(() => ({ mode: "light" }));
const useTheme = (): ComputedRef<FluentTheme> =>
  inject(fluentThemeKey, fallbackTheme);
function themeAttrs(theme: ComputedRef<FluentTheme>) {
  return computed(() => ({
    "data-fluent-theme": theme.value.mode,
    style: {
      ...(theme.value.accent ? { "--fluent-accent": theme.value.accent } : {}),
      ...(theme.value.accentText
        ? { "--fluent-accent-text": theme.value.accentText }
        : {}),
    },
  }));
}

export const FluentDialog = defineComponent({
  name: "FluentDialog",
  props: {
    open: Boolean,
    label: { type: String, required: true },
    closeOnOutside: Boolean,
  },
  emits: ["update:open", "close"],
  setup(props, { emit, slots }) {
    const dialog = ref<HTMLDialogElement | null>(null);
    const attrs = themeAttrs(useTheme());
    let release: (() => void) | null = null;
    let mounted = false;
    const close = () => {
      if (props.open) {
        emit("update:open", false);
        emit("close");
      }
    };
    const activate = () => {
      if (!mounted || release) return;
      release = registerOverlay({ kind: "dialog", onRequestClose: close });
      void nextTick(() => {
        if (props.open && dialog.value) {
          if (!dialog.value.open) dialog.value.showModal();
          dialog.value.focus({ preventScroll: true });
        }
      });
    };
    const deactivate = () => {
      release?.();
      release = null;
      if (dialog.value?.open) dialog.value.close();
    };
    watch(
      () => props.open,
      (open) => (open ? activate() : deactivate()),
      { immediate: true },
    );
    onMounted(() => {
      mounted = true;
      if (props.open) activate();
    });
    onBeforeUnmount(deactivate);
    return () =>
      h(
        "dialog",
        {
          ref: dialog,
          class: "fluent-dialog",
          "aria-label": props.label,
          ...attrs.value,
          onCancel: (event: Event) => {
            event.preventDefault();
            requestCloseTop();
          },
          onClose: () => {
            if (props.open) close();
          },
          onClick: (event: MouseEvent) => {
            if (props.closeOnOutside && event.target === dialog.value) close();
          },
        },
        [
          slots.title
            ? h("header", { class: "fluent-dialog__header" }, slots.title())
            : null,
          h(
            "div",
            { class: "fluent-dialog__content", tabindex: -1 },
            slots.default?.(),
          ),
          slots.footer
            ? h("footer", { class: "fluent-dialog__footer" }, slots.footer())
            : null,
        ],
      );
  },
});

export const FluentPopover = defineComponent({
  name: "FluentPopover",
  props: {
    open: Boolean,
    label: { type: String, required: true },
    anchor: { type: Object as PropType<HTMLElement | null>, default: null },
    portal: { type: Object as PropType<HTMLElement | null>, default: null },
    role: { type: String, default: "dialog" },
    focusOnOpen: { type: Boolean, default: true },
  },
  emits: ["update:open", "close"],
  setup(props, { emit, slots }) {
    const panel = ref<HTMLElement | null>(null);
    const attrs = themeAttrs(useTheme());
    const position = ref<{
      left: number;
      top: number;
      maxHeight: number | null;
      maxWidth: number | null;
      side: "top" | "bottom";
    }>({ left: 0, top: 0, maxHeight: null, maxWidth: null, side: "bottom" });
    let release: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    let mounted = false;
    const style = computed(() => ({
      left: `${position.value.left}px`,
      top: `${position.value.top}px`,
      maxHeight:
        position.value.maxHeight === null
          ? undefined
          : `${position.value.maxHeight}px`,
      maxWidth:
        position.value.maxWidth === null
          ? undefined
          : `${position.value.maxWidth}px`,
      visibility: position.value.maxHeight === null ? "hidden" : "visible",
    }));
    const close = () => {
      if (props.open) {
        emit("update:open", false);
        emit("close");
      }
    };
    const reposition = () => {
      if (!props.anchor || !panel.value) return;
      position.value = placeAnchored(
        props.anchor.getBoundingClientRect(),
        { width: panel.value.offsetWidth, height: Math.max(panel.value.offsetHeight, panel.value.scrollHeight) },
        { width: window.innerWidth, height: window.innerHeight },
      );
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        (!panel.value?.contains(target) && !props.anchor?.contains(target))
      )
        close();
    };
    const stop = () => {
      if (!mounted) return;
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      observer?.disconnect();
      observer = null;
    };
    const activate = () => {
      if (!mounted || release) return;
      release = registerOverlay({ kind: "popover", onRequestClose: close });
      document.addEventListener("pointerdown", outside, true);
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);
      void nextTick(async () => {
        if (!props.open || !panel.value) return;
        panel.value.showPopover();
        reposition();
        await nextTick();
        if (!props.open || !panel.value) return;
        if (props.focusOnOpen) panel.value.focus({ preventScroll: true });
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(reposition);
          observer.observe(panel.value);
        }
      });
    };
    const deactivate = () => {
      release?.();
      release = null;
      stop();
      if (panel.value?.matches(":popover-open")) panel.value.hidePopover();
      position.value = {
        left: 0,
        top: 0,
        maxHeight: null,
        maxWidth: null,
        side: "bottom",
      };
    };
    watch(
      () => props.open,
      (open) => (open ? activate() : deactivate()),
      { immediate: true },
    );
    watch(
      () => props.anchor,
      () => {
        if (props.open && mounted) void nextTick(reposition);
      },
    );
    onMounted(() => {
      mounted = true;
      if (props.open) activate();
    });
    onBeforeUnmount(deactivate);
    return () => {
      if (!props.open) return null;
      const node = h(
        "div",
        {
          ref: panel,
          popover: "manual",
          class: "fluent-popover",
          role: props.role,
          tabindex: -1,
          "aria-label": props.label,
          "data-side": position.value.side,
          "data-fluent-theme": attrs.value["data-fluent-theme"],
          style: [attrs.value.style, style.value],
        },
        slots.default?.(),
      );
      return props.portal ? h(Teleport, { to: props.portal }, node) : node;
    };
  },
});
