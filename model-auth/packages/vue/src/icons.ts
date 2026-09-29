const files = import.meta.glob(
  [
    "../node_modules/@fluentui/svg-icons/icons/arrow_down_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/arrow_up_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/checkmark_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/chevron_down_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/chevron_left_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/chevron_right_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/dismiss_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/eye_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/eye_off_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/key_16_regular.svg",
    "../node_modules/@fluentui/svg-icons/icons/person_key_16_regular.svg",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const ICON_FILES = {
  "arrow-down": "arrow_down",
  "arrow-up": "arrow_up",
  "check": "checkmark",
  "chevron-down": "chevron_down",
  "back": "chevron_left",
  "next": "chevron_right",
  "close": "dismiss",
  "eye": "eye",
  "eye-off": "eye_off",
  "key": "key",
  "oauth": "person_key",
} as const;

export type ModelAuthIconName = keyof typeof ICON_FILES;

export const ICON_PATHS = Object.fromEntries(
  Object.entries(ICON_FILES).map(([name, file]) => {
    const svg = files[`../node_modules/@fluentui/svg-icons/icons/${file}_16_regular.svg`] ?? "";
    return [name, [...svg.matchAll(/<path d="([^"]+)"/g)].map(match => match[1])];
  }),
) as Record<ModelAuthIconName, string[]>;
