import { defineComponent, h, onBeforeUnmount, reactive, ref, watch } from "vue";
import { FluentButton, FluentNavigation, FluentSegmented, FluentSelect, FluentSlider, FluentSwitch, FluentTheme, fluentPreferenceOptions, type FluentCurve } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { preferenceLabel, preferences } from "../preferences.js";
import { appearance } from "./state.js";
import { arrowGlyph } from "./icons.js";

const pages = [
  { title: "Welcome", body: "Swipe through a short tour.", colors: ["#0078d4", "#5ea7e6"] },
  { title: "Sync", body: "Your files follow you across devices.", colors: ["#107c10", "#6ccb5f"] },
  { title: "Share", body: "Invite people with a link.", colors: ["#ca5010", "#f7a55a"] },
  { title: "Ready", body: "That is all you need to start.", colors: ["#744da9", "#b39ddb"] },
];
const tabs = [{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
const folders = ["Inbox", "Drafts", "Sent"].map((label) => ({ key: label.toLowerCase(), label }));
const notices = ["Saved to the cloud", "Three new messages", "Backup finished", "Link copied"];

export const CurveDemoCard = defineComponent({
  setup() {
    const curve = ref<"theme" | FluentCurve>("theme");
    const slow = ref(false), auto = ref(false);
    const state = reactive({ page: 0, added: false, liked: false, drawer: false, expanded: false, on: false, tab: "week", folder: "inbox", level: 20, progress: 15 });
    const toasts = ref<{ id: number; text: string }[]>([]);
    let toastId = 0, step = 0, timer: ReturnType<typeof setInterval> | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const toast = () => {
      const id = ++toastId;
      toasts.value = [...toasts.value.slice(-2), { id, text: notices[id % notices.length]! }];
      later(() => { toasts.value = toasts.value.filter((item) => item.id !== id); }, 2600);
    };
    const go = (delta: number) => { state.page = (state.page + delta + pages.length) % pages.length; };
    const actions = [
      () => go(1),
      () => { state.added = !state.added; },
      () => { state.on = !state.on; state.liked = !state.liked; },
      () => { state.tab = tabs[(tabs.findIndex((tab) => tab.value === state.tab) + 1) % tabs.length]!.value; state.folder = folders[(folders.findIndex((f) => f.key === state.folder) + 1) % folders.length]!.key; },
      () => { state.level = state.level > 50 ? 15 : 85; state.progress = state.progress > 50 ? 15 : 90; },
      () => { state.drawer = !state.drawer; },
      () => { state.expanded = !state.expanded; },
      toast,
    ];
    const playAll = () => actions.forEach((action) => action());
    watch([auto, slow], () => {
      clearInterval(timer);
      if (auto.value) timer = setInterval(() => { actions[step % actions.length]!(); step += 1; }, slow.value ? 1100 : 700);
    });
    onBeforeUnmount(() => { clearInterval(timer); timers.forEach(clearTimeout); });

    const stage = (title: string, testId: string, children: unknown[]) => h("section", { class: "curve-stage", "data-testid": testId }, [h("h4", title), ...(children as never[])]);

    return () => card("showcase-curve-demo", "Curves in practice", "Common controls animated with one curve. Pick a curve here to try it without changing the app, or follow the app's curve from Customize.", [
      h("div", { class: "curve-demo-toolbar" }, [
        h(FluentSelect, { label: "Curve", "data-testid": "curve-demo-curve", modelValue: curve.value, options: [{ value: "theme", label: `Follow app (${preferenceLabel(preferences.curve)})` }, ...fluentPreferenceOptions.curve.map((value) => ({ value, label: preferenceLabel(value) }))], "onUpdate:modelValue": (value: string) => { curve.value = value as typeof curve.value; } }),
        h(FluentSwitch, { label: "Slow motion", modelValue: slow.value, "onUpdate:modelValue": (value: boolean) => { slow.value = value; } }),
        h(FluentSwitch, { label: "Auto-play", "data-testid": "curve-demo-auto", modelValue: auto.value, "onUpdate:modelValue": (value: boolean) => { auto.value = value; } }),
        h(FluentButton, { tone: "primary", "data-testid": "curve-demo-play", onClick: playAll }, () => "Play all"),
      ]),
      // A nested theme applies the chosen curve and speed to this demo only, including the real Fluent controls inside it.
      h(FluentTheme, { mode: appearance.mode, accent: appearance.accent, curve: curve.value === "theme" ? undefined : curve.value, speed: slow.value ? "slower" : undefined, class: "curve-demo" }, () => [
        stage("Page flip", "curve-demo-pager", [
          h("div", { class: "curve-pager" }, [
            h("div", { class: "curve-pager__track", style: { transform: `translateX(${-state.page * 100}%)` } }, pages.map((page, index) => h("article", { key: page.title, class: "curve-pager__page", "aria-hidden": index !== state.page ? "true" : undefined, style: { background: `linear-gradient(135deg, ${page.colors[0]}, ${page.colors[1]})` } }, [h("strong", page.title), h("span", page.body)]))),
          ]),
          h("div", { class: "curve-pager__controls" }, [
            h(FluentButton, { tone: "subtle", "aria-label": "Previous page", onClick: () => go(-1) }, () => "‹"),
            h("div", { class: "curve-pager__dots", role: "tablist", "aria-label": "Pages" }, pages.map((page, index) => h("button", { key: page.title, type: "button", role: "tab", "aria-selected": String(index === state.page), "aria-label": page.title, class: ["curve-pager__dot", { "is-active": index === state.page }], onClick: () => { state.page = index; } }))),
            h(FluentButton, { tone: "subtle", "aria-label": "Next page", onClick: () => go(1) }, () => "›"),
          ]),
        ]),
        stage("Buttons", "curve-demo-buttons", [
          h("div", { class: "control-row" }, [
            h("button", { type: "button", class: ["curve-cart", { "is-added": state.added }], "aria-pressed": String(state.added), onClick: () => { state.added = !state.added; } }, [h("span", { class: "curve-cart__label" }, state.added ? "Added to cart" : "Add to cart"), h("span", { class: "curve-cart__check", "aria-hidden": "true" }, "✓")]),
            h("button", { type: "button", class: ["curve-like", { "is-liked": state.liked }], "aria-pressed": String(state.liked), "aria-label": "Like", onClick: () => { state.liked = !state.liked; } }, "♥"),
          ]),
          h("div", { class: "control-row" }, [
            h(FluentSwitch, { label: "Notifications", modelValue: state.on, "onUpdate:modelValue": (value: boolean) => { state.on = value; } }),
            h(FluentButton, { onClick: toast }, () => ["Show a toast", arrowGlyph()]),
          ]),
        ]),
        stage("Selection and values", "curve-demo-controls", [
          h(FluentSegmented, { label: "Calendar view", modelValue: state.tab, options: tabs, "onUpdate:modelValue": (value: string | number) => { state.tab = String(value); } }),
          h(FluentNavigation, { class: "curve-nav", label: "Folders", modelValue: state.folder, items: folders, "onUpdate:modelValue": (value: string) => { state.folder = value; } }),
          h(FluentSlider, { label: "Volume", modelValue: state.level, formatValue: (value: number) => `${Math.round(value)}%`, "onUpdate:modelValue": (value: number) => { state.level = value; } }),
          h("div", { class: "control-row" }, [h(FluentButton, { tone: "subtle", onClick: () => { state.level = 15; state.progress = 15; } }, () => "Low"), h(FluentButton, { tone: "subtle", onClick: () => { state.level = 85; state.progress = 90; } }, () => "High")]),
          h("div", { class: "curve-meter", role: "img", "aria-label": `Meter at ${state.progress}%` }, h("span", { style: { transform: `scaleX(${state.progress / 100})` } })),
        ]),
        stage("Panels", "curve-demo-panels", [
          h("div", { class: "curve-app" }, [
            h("div", { class: "curve-app__body" }, [
              h(FluentButton, { "aria-expanded": String(state.drawer), onClick: () => { state.drawer = !state.drawer; } }, () => state.drawer ? "Close details" : "Open details"),
              h("button", { type: "button", class: "curve-accordion__head", "aria-expanded": String(state.expanded), onClick: () => { state.expanded = !state.expanded; } }, [h("span", "Advanced options"), h("span", { class: "curve-accordion__chevron", "aria-hidden": "true" }, "⌄")]),
              h("div", { class: ["curve-accordion", { "is-open": state.expanded }] }, h("div", { class: "curve-accordion__inner" }, [h("p", "Proxy: automatic"), h("p", "Metered connection: off"), h("p", "Data saver: on")])),
            ]),
            h("aside", { class: ["curve-drawer", { "is-open": state.drawer }], "aria-hidden": state.drawer ? undefined : "true" }, [h("strong", "Details"), h("span", "Size 2.4 MB"), h("span", "Modified today")]),
            h("div", { class: "curve-toasts", "aria-live": "polite" }, toasts.value.map((item) => h("div", { key: item.id, class: "curve-toast" }, item.text))),
          ]),
        ]),
      ]),
    ], true);
  },
});
