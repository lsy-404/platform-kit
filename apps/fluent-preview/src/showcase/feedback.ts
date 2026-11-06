import { computed, defineComponent, h, onBeforeUnmount, ref } from "vue";
import { FluentButton, FluentNotice, FluentProgressBar, FluentProgressRing, FluentScrollViewer } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { preferenceLabel, preferences } from "../preferences.js";
import { GraphicsPreview } from "../graphics.js";
import { pageFrame } from "./frame.js";
import { GaugeDashboardCard, SpinnerCard } from "./gauges.js";
import { VisualWeightCard } from "./visual-weight.js";

const activity = Array.from({ length: 24 }, (_, index) => {
  const minute = String(59 - index * 2).padStart(2, "0");
  const events = ["Synced 14 files", "Shared the design review", "Renamed Q3 plan", "Restored a previous version", "Invited two members", "Exported the report"];
  return { time: `09:${minute}`, text: events[index % events.length]! };
});

export const ProgressPage = defineComponent({
  setup() {
    const progress = ref(35);
    const running = ref(false);
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(timer); timer = undefined; running.value = false; };
    const start = () => {
      if (progress.value >= 100) progress.value = 0;
      running.value = true;
      timer = setInterval(() => {
        progress.value = Math.min(100, progress.value + 1 + Math.random() * 4);
        if (progress.value >= 100) stop();
      }, 160);
    };
    onBeforeUnmount(stop);
    const done = computed(() => progress.value >= 100);

    return () => pageFrame("feedback-progress", "Notices, determinate and indeterminate progress, spinning rings and gauges.", () => [
      card("showcase-notices", "Notices", null, [
        h(FluentNotice, { tone: "info" }, () => "A new version of the workspace app is available."),
        h(FluentNotice, { tone: "success" }, () => "Your changes were saved."),
        h(FluentNotice, { tone: "warning" }, () => "Storage is 90% full."),
        h(FluentNotice, { tone: "danger" }, () => "Two files could not be uploaded."),
      ], true),
      h("div", { class: "showcase-columns" }, [
        card("showcase-upload", "Upload", null, [
          h(FluentProgressBar, { label: "Uploading files", value: progress.value, showIndicator: true, "data-testid": "showcase-upload-progress" }),
          h(FluentProgressBar, { label: "Snapped to tens", value: progress.value, showIndicator: true, snap: true, step: 10 }),
          h("div", { class: "progress-row" }, [
            h(FluentProgressRing, { label: "Upload progress", value: progress.value, indeterminate: false, size: 40 }),
            h(FluentProgressRing, { label: "Upload status", indeterminate: running.value, active: running.value, size: 40 }),
            h("span", { class: "pref-note", "aria-live": "polite" }, done.value ? "Upload complete" : running.value ? `${Math.round(progress.value)}% uploaded` : "Paused"),
          ]),
          h("div", { class: "control-row" }, [
            h(FluentButton, { tone: "primary", "data-testid": "showcase-upload-toggle", onClick: () => running.value ? stop() : start() }, () => running.value ? "Pause" : done.value ? "Upload again" : "Resume"),
            h(FluentButton, { onClick: () => { stop(); progress.value = 0; } }, () => "Reset"),
          ]),
          ...(done.value ? [h(FluentNotice, { tone: "success" }, () => "All files uploaded.")] : []),
        ]),
        h(SpinnerCard),
      ]),
      h(GaugeDashboardCard),
      card("showcase-waiting", "Indeterminate bar", `Showing the ${preferenceLabel(preferences.barMotion)} style from Customize; compare every style on Control motion.`, [h(FluentProgressBar, { label: "Preparing", indeterminate: true })], true),
    ]);
  },
});

export const ActivityPage = defineComponent({
  setup: () => () => pageFrame("feedback-activity", "A scroll viewer, optically centred SVG icons, and how colour changes the visual weight they are centred by.", () => [
    card("showcase-activity", "Activity", null, [
      h(FluentScrollViewer, { class: "activity-log", "aria-label": "Recent activity" }, () => h("ol", { class: "activity-list" }, activity.map((entry) => h("li", { key: entry.time }, [h("time", entry.time), h("span", entry.text)])))),
    ]),
    h(GraphicsPreview),
    h(VisualWeightCard),
  ]),
});
