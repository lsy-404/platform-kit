import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  Teleport,
  TransitionGroup,
  type App,
  type InjectionKey,
  type PropType,
} from "vue";
import {
  observeWindowAttention,
  toastAnnouncement,
  type Toast,
  type ToastPlacement,
  type ToastStore,
  type ToastTheme,
} from "./core.js";
import { pinLeavingToast, toastStamp } from "./motion.js";
import { toast as sharedToast } from "./shared.js";

export const toastStoreKey: InjectionKey<ToastStore> = Symbol("pk-toast");

/** Installs a store for `useToast()` and `$toast`; defaults to the shared store. */
export function createToastPlugin(store: ToastStore = sharedToast) {
  return {
    store,
    install(app: App) {
      app.provide(toastStoreKey, store);
      app.config.globalProperties.$toast = store;
    },
  };
}

export function useToast(): ToastStore {
  return inject(toastStoreKey, sharedToast);
}

/** Reactive view of a store's toasts for templates. */
export function useToastList(store: ToastStore) {
  const list = shallowRef<readonly Toast[]>(store.snapshot());
  const stop = store.subscribe(() => {
    list.value = store.snapshot();
  });
  onBeforeUnmount(stop);
  return list;
}

const closeIcon = () =>
  h("svg", { viewBox: "0 0 10 10", width: 10, height: 10, "aria-hidden": "true", focusable: "false" }, [
    h("path", {
      d: "M1 1 9 9M9 1 1 9",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.1,
      "stroke-linecap": "round",
    }),
  ]);

export const ToastCard = defineComponent({
  name: "ToastCard",
  props: {
    toast: { type: Object as PropType<Toast>, required: true },
    store: { type: Object as PropType<ToastStore>, required: true },
    /** Remaining share of display time, driven by the host tick. */
    progress: { type: Number, default: 1 },
    closeLabel: { type: String, default: "Dismiss" },
    timestamp: { type: Boolean, default: true },
  },
  setup(props) {
    return () => {
      const { toast, store } = props;
      return h(
        "div",
        {
          class: ["pk-toast", `pk-toast--${toast.kind}`],
          "data-sticky": toast.duration <= 0 ? "" : undefined,
          ...toastAnnouncement(toast.kind),
        },
        [
          h(
            "button",
            {
              type: "button",
              class: "pk-toast__close",
              "aria-label": props.closeLabel,
              onClick: () => store.dismiss(toast.id),
            },
            [closeIcon()],
          ),
          toast.title ? h("div", { class: "pk-toast__title" }, toast.title) : null,
          h("div", { class: "pk-toast__message" }, toast.message),
          toast.actions.length
            ? h(
                "div",
                { class: "pk-toast__actions" },
                toast.actions.map((action, index) =>
                  h(
                    "button",
                    {
                      key: index,
                      type: "button",
                      class: ["pk-toast__action", { "pk-toast__action--primary": action.primary }],
                      onClick: (event: MouseEvent) => {
                        event.stopPropagation();
                        store.runAction(toast.id, action);
                      },
                    },
                    action.label,
                  ),
                ),
              )
            : null,
          props.timestamp
            ? h(
                "time",
                { class: "pk-toast__stamp", datetime: new Date(toast.createdAt).toISOString() },
                toastStamp(toast.createdAt),
              )
            : null,
          toast.duration > 0
            ? h("div", {
                class: "pk-toast__bar",
                "aria-hidden": "true",
                style: { transform: `scaleX(${props.progress})` },
              })
            : null,
        ],
      );
    };
  },
});

export const ToastHost = defineComponent({
  name: "ToastHost",
  props: {
    store: { type: Object as PropType<ToastStore>, default: undefined },
    /** Teleport target; `null` renders in place. */
    to: { type: [String, Object] as PropType<string | HTMLElement | null>, default: "body" },
    placement: { type: String as PropType<ToastPlacement>, default: "bottom-end" },
    theme: { type: String as PropType<ToastTheme>, default: "system" },
    label: { type: String, default: "Notifications" },
    closeLabel: { type: String, default: "Dismiss" },
    timestamp: { type: Boolean, default: true },
    /** Track window focus to speed up or slow down timers. */
    observeWindow: { type: Boolean, default: true },
  },
  setup(props) {
    const injected = useToast();
    const store = computed(() => props.store ?? injected);
    const list = shallowRef<readonly Toast[]>(store.value.snapshot());
    const tick = shallowRef(0);
    let stopList = () => {};
    let stopWindow = () => {};
    let interval: ReturnType<typeof setInterval> | undefined;

    const syncTicker = () => {
      const timed = list.value.some((toast) => toast.duration > 0);
      if (timed && interval === undefined) {
        interval = setInterval(() => {
          tick.value++;
        }, 100);
      } else if (!timed && interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    onMounted(() => {
      const target = store.value;
      list.value = target.snapshot();
      stopList = target.subscribe(() => {
        list.value = target.snapshot();
        syncTicker();
      });
      if (props.observeWindow) stopWindow = observeWindowAttention(target);
      syncTicker();
    });
    onBeforeUnmount(() => {
      stopList();
      stopWindow();
      if (interval !== undefined) clearInterval(interval);
      store.value.setAttention({ engaged: false });
    });

    const engage = (engaged: boolean) => store.value.setAttention({ engaged });
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !(event.currentTarget as HTMLElement).contains(next)) engage(false);
    };

    return () => {
      void tick.value;
      const target = store.value;
      const stack = h(
        TransitionGroup,
        {
          tag: "section",
          name: "pk-toast",
          class: "pk-toast-host",
          "data-placement": props.placement,
          "data-pk-toast-theme": props.theme,
          "aria-label": props.label,
          duration: { enter: 250, leave: 150 },
          onBeforeLeave: pinLeavingToast,
          onPointerenter: () => engage(true),
          onPointerleave: () => engage(false),
          onFocusin: () => engage(true),
          onFocusout: onFocusOut,
        },
        () =>
          list.value.map((toast) =>
            h(ToastCard, {
              key: toast.id,
              toast,
              store: target,
              progress: target.progress(toast.id),
              closeLabel: props.closeLabel,
              timestamp: props.timestamp,
            }),
          ),
      );
      return props.to === null ? stack : h(Teleport, { to: props.to }, [stack]);
    };
  },
});

declare module "vue" {
  interface ComponentCustomProperties {
    $toast: ToastStore;
  }
}

export { pinLeavingToast };
export type { ToastPlacement, ToastTheme };
