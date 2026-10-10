import { createApp, h, ref } from "vue";
import { FluentIconText, FluentSvgIcon, FluentTheme } from "../../styles/fluent/src/vue/index.js";

declare global { interface Window { graphicResults: Array<{ status: string; bounds: unknown }>; graphicErrors: string[] } }
window.graphicResults = [];
window.graphicErrors = [];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="10" y="7" width="12" height="18" fill="none" stroke="currentColor" stroke-width="4"/></svg>`;
const dark = ref(false);
const label = ref("Save");
const source = ref(svg);
const events = ref(0);
const app = createApp({ setup: () => () => h(FluentTheme, { mode: dark.value ? "dark" : "light" }, {
  default: () => h("main", { style: { backgroundColor: "#eef0f4" } }, [
    h(FluentSvgIcon, { svg: source.value, size: 24, label: "File", onReady: result => { events.value++; window.graphicResults.push(result); }, onError: error => window.graphicErrors.push(error.message) }),
    h(FluentSvgIcon, { svg, size: 24 }),
    h(FluentIconText, { svg, size: 20, dir: "rtl", onReady: result => { events.value++; window.graphicResults.push(result); }, onError: error => window.graphicErrors.push(error.message) }, { default: () => label.value }),
    h(FluentSvgIcon, { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"/>`, size: 16, label: "Empty" }),
    h("button", { id: "toggle", onClick: () => { dark.value = !dark.value; } }, "theme"),
    h("button", { id: "label", onClick: () => { label.value = "保存"; } }, "label"),
    h("button", { id: "play", onClick: () => { label.value = "Play"; } }, "play"),
    h("button", { id: "gyp", onClick: () => { label.value = "gyp"; } }, "gyp"),
    h("button", { id: "source", onClick: () => { source.value = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="currentColor" d="M3 16 29 3 22 29z"/></svg>`; } }, "source"),
    h("output", { id: "events" }, String(events.value)),
  ]),
}) });
app.mount("#app");
