import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { FluentButton, FluentNavigation, FluentTheme, FluentToggleButton, FluentTransitionView } from "@platform-kit/fluent/vue";
import { version } from "../../../../styles/fluent/package.json";
import { preferences } from "../preferences.js";
import { ControlMotionPage } from "./control-motion.js";
import { ActionsPage, FormsPage } from "./controls.js";
import { CustomizePane } from "./customize.js";
import { ActivityPage, ProgressPage } from "./feedback.js";
import { menuGlyph, tuneGlyph } from "./icons.js";
import { AccentPage, CornersPage, CurvesPage, EmphasisPage, SelectionMotionPage, TransitionsPage } from "./motion.js";
import { OverviewPage } from "./overview.js";
import { EqualizerPage, SoundDisplayPage } from "./sliders.js";
import { appearance, navigate, navigation, pageLabel, pageOrder, syncShowcaseQuery, ui, type PageKey } from "./state.js";

const views: Record<PageKey, Component> = {
  "overview": OverviewPage,
  "motion-curves": CurvesPage,
  "motion-selection": SelectionMotionPage,
  "motion-controls": ControlMotionPage,
  "appearance-accent": AccentPage,
  "appearance-emphasis": EmphasisPage,
  "appearance-corners": CornersPage,
  "transitions": TransitionsPage,
  "controls-forms": FormsPage,
  "controls-actions": ActionsPage,
  "sliders-panels": SoundDisplayPage,
  "sliders-equalizer": EqualizerPage,
  "feedback-progress": ProgressPage,
  "feedback-activity": ActivityPage,
};

const useMedia = (query: string) => {
  const media = matchMedia(query);
  const matches = ref(media.matches);
  const sync = () => { matches.value = media.matches; };
  onMounted(() => media.addEventListener("change", sync));
  onBeforeUnmount(() => media.removeEventListener("change", sync));
  return matches;
};

export const Showcase = defineComponent({
  name: "Showcase",
  setup() {
    syncShowcaseQuery();
    const docked = useMedia("(min-width: 1180px)");
    const compact = useMedia("(max-width: 760px)");
    ui.paneOpen = docked.value;
    watch(docked, (value) => { ui.paneOpen = value; });
    watch(compact, (value) => { if (!value) ui.navOpen = false; });
    watch(() => ui.page, (page) => { document.title = `${pageLabel(page)} · Fluent showcase`; }, { immediate: true });
    const overlay = () => (compact.value && ui.navOpen) || (!docked.value && ui.paneOpen);
    const dismiss = () => { ui.navOpen = false; if (!docked.value) ui.paneOpen = false; };
    const onKeydown = (event: KeyboardEvent) => { if (event.key === "Escape" && overlay()) dismiss(); };
    onMounted(() => addEventListener("keydown", onKeydown));
    onBeforeUnmount(() => removeEventListener("keydown", onKeydown));

    return () => h(FluentTheme, { mode: appearance.mode, accent: appearance.accent, ...preferences, class: "showcase-theme" }, () => h("div", {
      class: ["showcase", { "is-pane-open": ui.paneOpen, "is-nav-open": ui.navOpen, "is-compact": compact.value, "is-docked": docked.value }],
    }, [
      h("header", { class: "showcase-titlebar" }, [
        h(FluentButton, { tone: "subtle", iconOnly: true, class: "showcase-menu", "aria-label": "Navigation", "aria-expanded": String(ui.navOpen), "aria-controls": "showcase-nav", onClick: () => { ui.navOpen = !ui.navOpen; } }, menuGlyph),
        h("div", { class: "showcase-brand" }, [
          h("span", { class: "showcase-logo", "aria-hidden": "true" }),
          h("h1", "Fluent showcase"),
          h("span", { class: "showcase-version" }, `@platform-kit/fluent ${version}`),
        ]),
        h("div", { class: "showcase-titlebar__actions" }, [
          h("a", { class: "showcase-catalog-link", href: "catalog.html" }, "Control catalog"),
          h(FluentToggleButton, { "data-testid": "showcase-customize-toggle", "aria-label": "Customize", "aria-controls": "showcase-customize", modelValue: ui.paneOpen, "onUpdate:modelValue": (value: boolean) => { ui.paneOpen = value; } }, () => [tuneGlyph(), h("span", { class: "showcase-customize-label" }, "Customize")]),
        ]),
      ]),
      h("div", { class: "showcase-body" }, [
        h("div", { id: "showcase-nav", class: "showcase-nav" }, [
          h(FluentNavigation, { label: "Showcase pages", "data-testid": "showcase-navigation", modelValue: ui.page, items: navigation, "onUpdate:modelValue": (key: string) => navigate(key as PageKey) }),
          h("p", { class: "showcase-nav__note" }, "Selection motion, emphasis and the page transition all follow Customize."),
        ]),
        h("main", { class: "showcase-content" }, h(FluentTransitionView, { class: "showcase-view", viewKey: ui.page, order: pageOrder, "data-testid": "showcase-view" }, {
          default: ({ viewKey }: { viewKey: string | number }) => h(views[viewKey as PageKey], { key: viewKey }),
        })),
        ui.paneOpen ? h(CustomizePane) : null,
        overlay() ? h("div", { class: "showcase-scrim", "aria-hidden": "true", onClick: dismiss }) : null,
      ]),
    ]));
  },
});
