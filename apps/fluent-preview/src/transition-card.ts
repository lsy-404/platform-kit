import { defineComponent, h, nextTick, ref, withDirectives, type VNode } from "vue";
import { FluentButton, FluentNavigation, FluentSelect, FluentTransitionView, fluentPreferenceOptions, vFluentShared, type FluentPageTransition } from "@platform-kit/fluent/vue";
import { card } from "./card.js";
import { preferenceLabel } from "./preferences.js";

const photos = [
  { id: "1", label: "Dunes", colors: ["#f2a65a", "#c4511d"] },
  { id: "2", label: "Lagoon", colors: ["#3fb8af", "#1d6f8f"] },
  { id: "3", label: "Forest", colors: ["#7fb069", "#2d6a4f"] },
  { id: "4", label: "Dusk", colors: ["#9d79bc", "#3d2c8d"] },
  { id: "5", label: "Blossom", colors: ["#f4a6c0", "#c1457b"] },
  { id: "6", label: "Glacier", colors: ["#a8d8ea", "#4f86c6"] },
];
const photoKey = (id: string) => `photo:${id}`;
const order = ["inbox", "compose", "photos", ...photos.map((photo) => photoKey(photo.id)), "settings"];
const pages = [{ key: "inbox", label: "Inbox" }, { key: "photos", label: "Photos" }, { key: "settings", label: "Settings" }];
const pageOf = (view: string) => view === "compose" ? "inbox" : view.startsWith("photo:") ? "photos" : view;
const gradient = (colors: string[]) => `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const TransitionsCard = defineComponent({
  setup() {
    const view = ref("inbox");
    const local = ref<"theme" | FluentPageTransition>("theme");
    const instant = ref(false);
    const sharedPhoto = ref<string | null>(null);
    const morph = ref(false);
    const last = ref<{ from: string; to: string } | null>(null);
    const go = (to: string, keepShared = false) => {
      if (to === view.value) return;
      if (!keepShared) morph.value = false;
      last.value = { from: view.value, to };
      view.value = to;
    };
    const replay = async () => {
      if (!last.value) return;
      const { from, to } = last.value;
      instant.value = true;
      view.value = from;
      await wait(60);
      instant.value = false;
      await nextTick();
      view.value = to;
    };
    const shared = (node: VNode, name: string | null) => withDirectives(node, [[vFluentShared, name]]);

    const inbox = () => h("div", { class: "mini-page", key: "inbox" }, [
      h("div", { class: "mini-toolbar" }, [h("h4", "Inbox"), shared(h("button", { type: "button", class: "mini-pill", "data-testid": "transition-new", onClick: () => { morph.value = true; go("compose", true); } }, "New"), morph.value ? "compose" : null)]),
      ...["Welcome aboard", "Your weekly summary", "Invitation: design review"].map((subject) => h("p", { class: "mini-row" }, subject)),
    ]);
    const compose = () => h("div", { class: "mini-page", key: "compose" }, [
      shared(h("div", { class: "mini-compose", "data-testid": "transition-compose" }, [
        h("h4", "New message"),
        h("div", { class: "mini-compose__body" }, "Write something and close the panel to morph it back into the button."),
        h(FluentButton, { onClick: () => go("inbox", true) }, () => "Close"),
      ]), morph.value ? "compose" : null),
    ]);
    const grid = () => h("div", { class: "mini-page", key: "photos" }, [
      h("h4", "Photos"),
      h("div", { class: "mini-grid" }, photos.map((photo) => shared(h("button", {
        key: photo.id, type: "button", class: "mini-thumb", "aria-label": `Open ${photo.label}`, "data-testid": `transition-photo-${photo.id}`, style: { background: gradient(photo.colors) },
        onClick: () => { sharedPhoto.value = photo.id; go(photoKey(photo.id), true); },
      }), sharedPhoto.value === photo.id ? `photo-${photo.id}` : null))),
    ]);
    const detail = (id: string) => {
      const photo = photos.find((item) => item.id === id)!;
      return h("div", { class: "mini-page", key: photoKey(id) }, [
        h("div", { class: "mini-toolbar" }, [h(FluentButton, { "data-testid": "transition-back", onClick: () => go("photos", true) }, () => "Back"), h("h4", photo.label)]),
        shared(h("div", { class: "mini-photo", style: { background: gradient(photo.colors) } }), `photo-${photo.id}`),
      ]);
    };
    const settings = () => h("div", { class: "mini-page", key: "settings" }, [h("h4", "Settings"), h("p", { class: "mini-row" }, "Plain content with no shared elements."), h("p", { class: "mini-row" }, "Navigate between pages to compare the transition styles.")]);
    const render = (key: string | number) => {
      const name = String(key);
      if (name === "inbox") return inbox();
      if (name === "compose") return compose();
      if (name === "photos") return grid();
      if (name === "settings") return settings();
      return detail(name.slice("photo:".length));
    };

    return () => card("pref-page-transitions", "Page transitions", "Switches the content with the View Transition API; browsers without it switch instantly.", [
      h("div", { class: "transition-controls" }, [
        h(FluentSelect, { label: "Transition", "data-testid": "transition-style", modelValue: local.value, options: [{ value: "theme", label: "Follow theme" }, ...fluentPreferenceOptions.pageTransition.map((value) => ({ value, label: preferenceLabel(value) }))], "onUpdate:modelValue": (value: string) => { local.value = value as typeof local.value; } }),
        h(FluentButton, { "data-testid": "transition-replay", disabled: !last.value, onClick: replay }, () => "Replay"),
      ]),
      h("div", { class: "transition-demo" }, [
        h(FluentNavigation, { label: "Mini app pages", modelValue: pageOf(view.value), items: pages, "onUpdate:modelValue": (key: string) => { sharedPhoto.value = null; go(key); } }),
        h("div", { class: "transition-stage" }, h(FluentTransitionView, { viewKey: view.value, order, transition: instant.value ? "none" : local.value === "theme" ? undefined : local.value, "data-testid": "transition-view" }, { default: ({ viewKey }: { viewKey: string | number }) => render(viewKey) })),
      ]),
    ], true);
  },
});
