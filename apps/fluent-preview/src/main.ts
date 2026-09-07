import {
  FluentTheme,
  FluentButton,
  FluentField,
  FluentSwitch,
  FluentSlider,
  FluentSelect,
  FluentNotice,
  FluentDialog,
  FluentPopover,
  FluentNavigation,
} from "@platform-kit/fluent/vue";
import "@platform-kit/fluent/style.css";
import {
  createApp,
  defineComponent,
  h,
  ref,
  type ComponentPublicInstance,
} from "vue";
import "./preview.css";

type Language = "en" | "zh";
type ThemeMode = "light" | "dark" | "system";

const copy: Record<Language, Record<string, string>> = {
  en: {
    appName: "Fluent Preview",
    subtitle: "Interactive Vue component showcase",
    appearance: "Appearance",
    theme: "Theme",
    language: "Language",
    light: "Light",
    dark: "Dark",
    system: "System",
    overview: "Overview",
    controls: "Controls",
    overlays: "Overlays",
    accessibility: "Accessibility",
    title: "A familiar, calm workspace",
    intro: "Every control below is rendered by the Fluent package.",
    profile: "Profile",
    displayName: "Display name",
    displayValue: "Sample listener",
    notifications: "Notifications",
    sound: "Play a sound for updates",
    volume: "Volume",
    quality: "Streaming quality",
    save: "Apply changes",
    saved: "Changes applied to this preview.",
    savedOutput: "Applied preview",
    dialog: "Open settings dialog",
    dialogTitle: "Workspace settings",
    dialogBody:
      "This dialog contains a popover. Press Escape once to close the popover, then again to close the dialog.",
    popover: "Open inline details",
    popoverTitle: "About this setting",
    popoverBody:
      "The popover is intentionally nested to exercise layered focus and Escape handling.",
    close: "Close",
    disabled: "Disabled controls",
    unavailable: "Unavailable action",
    disabledField: "Disabled field",
    live: "Live output",
    current: "Current preferences",
    sectionHint:
      "Try the controls and switch the language or theme without leaving the page.",
    contentTitle: "Long content stays readable",
    content:
      "This card verifies wrapping and scrolling behavior in a narrow viewport. It uses ordinary text length so the layout can show its real overflow boundary.",
    navigation: "Preview sections",
  },
  zh: {
    appName: "Fluent 预览",
    subtitle: "可交互 Vue 组件展示",
    appearance: "外观",
    theme: "主题",
    language: "语言",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    overview: "概览",
    controls: "控件",
    overlays: "浮层",
    accessibility: "可访问性",
    title: "熟悉而安静的工作区",
    intro: "下方每个控件都由 Fluent 套件真实渲染。",
    profile: "个人资料",
    displayName: "显示名称",
    displayValue: "示例听众",
    notifications: "通知",
    sound: "更新时播放提示音",
    volume: "音量",
    quality: "流媒体质量",
    save: "应用更改",
    saved: "更改已应用到当前预览。",
    savedOutput: "已应用的预览",
    dialog: "打开设置对话框",
    dialogTitle: "工作区设置",
    dialogBody:
      "这个对话框包含一个浮层。按一次 Escape 关闭浮层，再按一次关闭对话框。",
    popover: "打开内嵌说明",
    popoverTitle: "关于此设置",
    popoverBody: "该浮层刻意嵌套，用于验证分层焦点和 Escape 行为。",
    close: "关闭",
    disabled: "禁用控件",
    unavailable: "不可用操作",
    disabledField: "禁用输入框",
    live: "实时输出",
    current: "当前偏好",
    sectionHint: "可直接操作控件，并在不离开页面时切换语言和主题。",
    contentTitle: "长内容依然易读",
    content:
      "此卡片用于验证窄屏中的换行和滚动行为。它使用正常长度的文本，以便布局呈现真实的溢出边界。",
    navigation: "预览章节",
  },
};

const navigationItems = [
  { key: "overview", label: "Overview" },
  { key: "controls", label: "Controls" },
  { key: "overlays", label: "Overlays" },
  { key: "accessibility", label: "Accessibility", disabled: true },
];

const FluentPreview = defineComponent({
  name: "FluentPreview",
  setup() {
    const language = ref<Language>("en");
    const theme = ref<ThemeMode>("system");
    const activeSection = ref("overview");
    const name = ref(copy.en.displayValue ?? "Sample listener");
    const playSound = ref(true);
    const volume = ref(62);
    const quality = ref("balanced");
    const notice = ref("sectionHint");
    const savedSnapshot = ref<{
      name: string;
      playSound: boolean;
      volume: number;
      quality: string;
    } | null>(null);
    const dialogOpen = ref(false);
    const popoverOpen = ref(false);
    const popoverAnchor = ref<HTMLElement | null>(null);
    const sections = new Map<string, HTMLElement>();

    const t = (key: string): string => copy[language.value][key] ?? key;
    const selectOptions = () => [
      {
        value: "balanced",
        label: language.value === "zh" ? "平衡" : "Balanced",
      },
      {
        value: "high",
        label: language.value === "zh" ? "高质量" : "High quality",
      },
      {
        value: "lossless",
        label: language.value === "zh" ? "无损" : "Lossless",
        disabled: true,
      },
    ];

    function save() {
      savedSnapshot.value = {
        name: name.value,
        playSound: playSound.value,
        volume: volume.value,
        quality: quality.value,
      };
      notice.value = "saved";
    }

    function selectSection(value: string): void {
      activeSection.value = value;
      sections
        .get(value)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeDialog(): void {
      popoverOpen.value = false;
      dialogOpen.value = false;
    }

    function setDialogOpen(value: boolean): void {
      if (!value) closeDialog();
      else dialogOpen.value = true;
    }

    return () =>
      h(
        FluentTheme,
        { mode: theme.value, class: "preview-theme" },
        {
          default: () =>
            h("div", { class: "preview-page" }, [
              h("aside", { class: "preview-sidebar" }, [
                h("div", { class: "preview-brand" }, [
                  h("strong", t("appName")),
                  h("span", t("subtitle")),
                ]),
                h(FluentNavigation, {
                  label: t("navigation"),
                  items: navigationItems.map((item) => ({
                    ...item,
                    label: t(item.key),
                  })),
                  modelValue: activeSection.value,
                  "onUpdate:modelValue": (value: string) => {
                    activeSection.value = value;
                  },
                  onSelect: selectSection,
                }),
                h("div", { class: "preview-sidebar-footer" }, t("sectionHint")),
              ]),
              h("div", { class: "preview-workspace" }, [
                h("header", { class: "preview-toolbar" }, [
                  h("div", [
                    h("span", { class: "preview-eyebrow" }, t("appearance")),
                    h("h1", t("title")),
                  ]),
                  h(
                    "div",
                    {
                      class: "preview-preferences",
                      "aria-label": t("appearance"),
                    },
                    [
                      h("label", [
                        h("span", t("theme")),
                        h(
                          "select",
                          {
                            value: theme.value,
                            onChange: (event: Event) => {
                              theme.value = (event.target as HTMLSelectElement)
                                .value as ThemeMode;
                            },
                          },
                          [
                            h("option", { value: "light" }, t("light")),
                            h("option", { value: "dark" }, t("dark")),
                            h("option", { value: "system" }, t("system")),
                          ],
                        ),
                      ]),
                      h("label", [
                        h("span", t("language")),
                        h(
                          "select",
                          {
                            value: language.value,
                            onChange: (event: Event) => {
                              language.value = (
                                event.target as HTMLSelectElement
                              ).value as Language;
                            },
                          },
                          [
                            h("option", { value: "en" }, "English"),
                            h("option", { value: "zh" }, "中文"),
                          ],
                        ),
                      ]),
                    ],
                  ),
                ]),
                h("main", { class: "preview-main" }, [
                  h(
                    "section",
                    {
                      ref: (
                        element: Element | ComponentPublicInstance | null,
                      ) => {
                        if (element instanceof HTMLElement)
                          sections.set("overview", element);
                      },
                      class: "preview-hero",
                      id: "overview",
                    },
                    [
                      h("p", t("intro")),
                      h(
                        "p",
                        { class: "preview-live" },
                        `${t("live")}: ${t("current")} · ${name.value} · ${volume.value}%`,
                      ),
                    ],
                  ),
                  h(
                    "div",
                    {
                      ref: (
                        element: Element | ComponentPublicInstance | null,
                      ) => {
                        if (element instanceof HTMLElement)
                          sections.set("controls", element);
                      },
                      class: "preview-grid",
                      id: "controls",
                    },
                    [
                      h(
                        "section",
                        {
                          class: "preview-card",
                          "aria-labelledby": "profile-title",
                        },
                        [
                          h("h2", { id: "profile-title" }, t("profile")),
                          h(FluentField, {
                            modelValue: name.value,
                            label: t("displayName"),
                            "onUpdate:modelValue": (value: string) => {
                              name.value = value;
                            },
                          }),
                          h(FluentSwitch, {
                            modelValue: playSound.value,
                            label: t("sound"),
                            "onUpdate:modelValue": (value: boolean) => {
                              playSound.value = value;
                            },
                          }),
                          h(FluentSlider, {
                            modelValue: volume.value,
                            min: 0,
                            max: 100,
                            step: 1,
                            label: t("volume"),
                            "onUpdate:modelValue": (value: number) => {
                              volume.value = value;
                            },
                          }),
                          h(FluentSelect, {
                            modelValue: quality.value,
                            label: t("quality"),
                            options: selectOptions(),
                            "onUpdate:modelValue": (value: string) => {
                              quality.value = value;
                            },
                          }),
                          h("div", { class: "preview-actions" }, [
                            h(
                              FluentButton,
                              {
                                tone: "primary",
                                type: "button",
                                onClick: save,
                              },
                              () => t("save"),
                            ),
                          ]),
                        ],
                      ),
                      h(
                        "section",
                        { class: "preview-card preview-card--side" },
                        [
                          h("h2", t("notifications")),
                          h(
                            FluentNotice,
                            { tone: "success" },
                            () => t(notice.value),
                          ),
                          savedSnapshot.value
                            ? h(
                                "output",
                                { class: "preview-snapshot" },
                                `${t("savedOutput")}: ${savedSnapshot.value.name} · ${savedSnapshot.value.volume}% · ${savedSnapshot.value.quality} · ${savedSnapshot.value.playSound ? "on" : "off"}`,
                              )
                            : null,
                          h("h2", t("disabled")),
                          h(FluentField, {
                            modelValue: t("unavailable"),
                            label: t("disabledField"),
                            disabled: true,
                          }),
                          h(FluentSwitch, {
                            modelValue: false,
                            label: t("unavailable"),
                            disabled: true,
                          }),
                          h(
                            FluentButton,
                            { tone: "danger", type: "button", disabled: true },
                            () => t("unavailable"),
                          ),
                        ],
                      ),
                    ],
                  ),
                  h(
                    "section",
                    {
                      ref: (
                        element: Element | ComponentPublicInstance | null,
                      ) => {
                        if (element instanceof HTMLElement)
                          sections.set("overlays", element);
                      },
                      class: "preview-card preview-overlays",
                      id: "overlays",
                    },
                    [
                      h("h2", t("overlays")),
                      h("p", t("dialogBody")),
                      h(
                        FluentButton,
                        {
                          tone: "secondary",
                          type: "button",
                          onClick: () => {
                            popoverOpen.value = false;
                            dialogOpen.value = true;
                          },
                        },
                        () => t("dialog"),
                      ),
                    ],
                  ),
                  h("section", { class: "preview-card preview-content" }, [
                    h("h2", t("contentTitle")),
                    h("p", t("content")),
                    h("p", t("content")),
                    h("p", t("content")),
                  ]),
                  h(
                    FluentDialog,
                    {
                      open: dialogOpen.value,
                      label: t("dialogTitle"),
                      "onUpdate:open": setDialogOpen,
                    },
                    {
                      default: () => [
                        h(
                          "h2",
                          { class: "preview-dialog-title" },
                          t("dialogTitle"),
                        ),
                        h("p", t("dialogBody")),
                        h(
                          "span",
                          {
                            ref: (
                              element: Element | ComponentPublicInstance | null,
                            ) => {
                              popoverAnchor.value =
                                element instanceof HTMLElement ? element : null;
                            },
                            class: "preview-popover-anchor",
                          },
                          [
                            h(
                              FluentButton,
                              {
                                tone: "subtle",
                                type: "button",
                                onClick: () => {
                                  popoverOpen.value = true;
                                },
                              },
                              () => t("popover"),
                            ),
                          ],
                        ),
                        h(
                          FluentPopover,
                          {
                            open: popoverOpen.value,
                            label: t("popoverTitle"),
                            anchor: popoverAnchor.value,
                            "onUpdate:open": (value: boolean) => {
                              popoverOpen.value = value;
                            },
                          },
                          { default: () => h("p", t("popoverBody")) },
                        ),
                      ],
                      footer: () =>
                        h(
                          FluentButton,
                          {
                            tone: "primary",
                            type: "button",
                            onClick: closeDialog,
                          },
                          () => t("close"),
                        ),
                    },
                  ),
                ]),
              ]),
            ]),
        },
      );
  },
});

createApp(FluentPreview).mount("#app");
