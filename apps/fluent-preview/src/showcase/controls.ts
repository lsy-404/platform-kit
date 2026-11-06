import { computed, defineComponent, h, reactive, ref, type ComponentPublicInstance } from "vue";
import { FluentButton, FluentCheckbox, FluentDialog, FluentField, FluentFilePicker, FluentMenu, FluentNumberField, FluentPasswordField, FluentPopover, FluentRadio, FluentSegmented, FluentSelect, FluentSwitch, FluentTextArea, FluentToggleButton, type FluentFile } from "@platform-kit/fluent/vue";
import { card } from "../card.js";
import { PageFrame } from "./frame.js";

const channels = [{ key: "email", label: "Email" }, { key: "push", label: "Push notifications" }, { key: "sms", label: "Text messages" }] as const;
const languages = [{ value: "en", label: "English" }, { value: "zh", label: "中文" }, { value: "ja", label: "日本語" }, { value: "de", label: "Deutsch" }];
const menuItems = [{ value: "list", label: "List" }, { value: "grid", label: "Grid" }, { separator: true }, { value: "preview", label: "Preview pane" }, { value: "archive", label: "Archive", disabled: true }];

export const ControlsPage = defineComponent({
  setup() {
    const profile = reactive({ name: "Sample Studio", email: "team@example.com", password: "a long passphrase", seats: 12 as number | null, bio: "We design calm, fast tools.", language: "en" });
    const files = ref<FluentFile[]>([]);
    const density = ref("comfortable"), sync = ref(true), pinned = ref(false), plan = ref("team");
    const notify = reactive<Record<(typeof channels)[number]["key"], boolean>>({ email: true, push: false, sms: false });
    const notified = computed(() => channels.filter((channel) => notify[channel.key]).length);
    const menuOpen = ref(false), menuValues = ref<string[]>(["grid", "preview"]), dialogOpen = ref(false), popoverOpen = ref(false), saved = ref(false);
    const menuAnchor = ref<HTMLElement | null>(null), popoverAnchor = ref<HTMLElement | null>(null);
    const anchor = (target: typeof menuAnchor) => (element: Element | ComponentPublicInstance | null) => { target.value = element instanceof HTMLElement ? element : null; };

    return () => h(PageFrame, { title: "Controls", lead: "A settings form built only from package exports: fields, choices, buttons, menus and overlays, all following the current theme." }, () => [
      h("div", { class: "showcase-columns" }, [
        card("showcase-profile", "Profile", null, [
          h(FluentField, { label: "Display name", modelValue: profile.name, "onUpdate:modelValue": (value: string) => { profile.name = value; } }),
          h(FluentField, { label: "Email", type: "email", modelValue: profile.email, "onUpdate:modelValue": (value: string) => { profile.email = value; } }),
          h(FluentField, { label: "Email with an error", type: "email", modelValue: "team@", invalid: true }),
          h(FluentPasswordField, { label: "Password", modelValue: profile.password, "onUpdate:modelValue": (value: string) => { profile.password = value; } }),
          h(FluentNumberField, { label: "Seats", modelValue: profile.seats, "onUpdate:modelValue": (value: number | null) => { profile.seats = value; } }),
          h(FluentTextArea, { label: "About", modelValue: profile.bio, "onUpdate:modelValue": (value: string) => { profile.bio = value; } }),
          h(FluentFilePicker, { label: "Logo", selectLabel: "Choose image", accept: "image/*", modelValue: files.value, "onUpdate:modelValue": (value: FluentFile[]) => { files.value = value; } }),
          h(FluentField, { label: "Workspace ID", modelValue: "ws-20481", readonly: true }),
        ]),
        card("showcase-preferences-form", "Preferences", null, [
          h(FluentSelect, { label: "Language", modelValue: profile.language, options: languages, "onUpdate:modelValue": (value: string) => { profile.language = value; } }),
          h("div", { class: "form-group", role: "radiogroup", "aria-label": "Density" }, [
            h("span", { class: "pane-label" }, "Density"),
            ...[["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]].map(([value, label]) => h(FluentRadio, { key: value, value: value!, label, modelValue: density.value, "onUpdate:modelValue": (next: string) => { density.value = next; } })),
          ]),
          h("div", { class: "form-group" }, [
            h(FluentCheckbox, { label: "All notifications", modelValue: notified.value === channels.length, indeterminate: notified.value > 0 && notified.value < channels.length, "onUpdate:modelValue": (value: boolean) => { for (const channel of channels) notify[channel.key] = value; } }),
            h("div", { class: "form-group form-group--nested" }, channels.map((channel) => h(FluentCheckbox, { key: channel.key, label: channel.label, modelValue: notify[channel.key], "onUpdate:modelValue": (value: boolean) => { notify[channel.key] = value; } }))),
          ]),
          h(FluentSwitch, { label: "Sync across devices", modelValue: sync.value, "onUpdate:modelValue": (value: boolean) => { sync.value = value; } }),
          h(FluentSwitch, { label: "Beta features (managed by your organization)", modelValue: false, disabled: true }),
          h("div", { class: "form-group" }, [
            h("span", { class: "pane-label" }, "Plan"),
            h(FluentSegmented, { label: "Plan", modelValue: plan.value, options: [{ value: "free", label: "Free" }, { value: "team", label: "Team" }, { value: "enterprise", label: "Enterprise", disabled: true }], "onUpdate:modelValue": (value: string | number) => { plan.value = String(value); } }),
          ]),
        ]),
        card("showcase-actions", "Actions", null, [
          h("div", { class: "control-row" }, [
            h(FluentButton, { tone: "primary", busy: saved.value, onClick: () => { saved.value = true; setTimeout(() => { saved.value = false; }, 1200); } }, () => saved.value ? "Saving" : "Save changes"),
            h(FluentButton, () => "Cancel"),
            h(FluentButton, { tone: "subtle" }, () => "Learn more"),
            h(FluentButton, { disabled: true }, () => "Disabled"),
          ]),
          h("div", { class: "control-row" }, [
            h(FluentToggleButton, { modelValue: pinned.value, "onUpdate:modelValue": (value: boolean) => { pinned.value = value; } }, () => pinned.value ? "Pinned to start" : "Pin to start"),
            h("span", { ref: anchor(menuAnchor) }, [h(FluentButton, { "aria-haspopup": "menu", "aria-expanded": String(menuOpen.value), "data-testid": "showcase-menu-trigger", onClick: () => { menuOpen.value = !menuOpen.value; } }, () => "View options")]),
            h("span", { ref: anchor(popoverAnchor) }, [h(FluentButton, { tone: "subtle", "aria-expanded": String(popoverOpen.value), onClick: () => { popoverOpen.value = !popoverOpen.value; } }, () => "What is a workspace?")]),
          ]),
          h("div", { class: "danger-zone" }, [
            h("div", [h("strong", "Delete workspace"), h("p", { class: "pref-note" }, "Removes every member and file. This cannot be undone.")]),
            h(FluentButton, { tone: "danger", "data-testid": "showcase-dialog-trigger", onClick: () => { dialogOpen.value = true; } }, () => "Delete"),
          ]),
        ]),
      ]),
      h(FluentMenu, { open: menuOpen.value, label: "View options", anchor: menuAnchor.value, items: menuItems, multiple: true, closeOnSelect: false, modelValue: menuValues.value, "onUpdate:open": (value: boolean) => { menuOpen.value = value; }, "onUpdate:modelValue": (value: string[]) => { menuValues.value = value; } }),
      h(FluentPopover, { open: popoverOpen.value, label: "About workspaces", anchor: popoverAnchor.value, "onUpdate:open": (value: boolean) => { popoverOpen.value = value; } }, { default: () => h("p", { class: "popover-copy" }, "A workspace groups members, files and billing. You can belong to several.") }),
      h(FluentDialog, { open: dialogOpen.value, label: "Delete workspace?", "onUpdate:open": (value: boolean) => { dialogOpen.value = value; } }, {
        title: () => "Delete workspace?",
        default: () => h("p", `${profile.name} and its files will be removed for everyone.`),
        footer: () => [h(FluentButton, { tone: "danger", onClick: () => { dialogOpen.value = false; } }, () => "Delete"), h(FluentButton, { onClick: () => { dialogOpen.value = false; } }, () => "Keep it")],
      }),
    ]);
  },
});
