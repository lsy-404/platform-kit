# Platform Kit Fluent

Apache-2.0 Fluent-style CSS with Vue controls, navigation, and browser-native overlays.

```ts
import { FluentButton, FluentTheme } from "@platform-kit/fluent/vue";
import "@platform-kit/fluent/style.css";
```

The source repository is public and releases are distributed as GitHub Release artifacts. `private: true` only prevents accidental npm publication; it does not restrict source use under Apache-2.0.

`FluentTheme` supports `light`, `dark`, and `system` modes. Vue is a peer dependency.

Controls include buttons, fields, switches, sliders, selects, file pickers, checkboxes, progress indicators, and a scroll viewer. `FluentCheckbox` accepts boolean `v-model` and a label slot. `FluentFilePicker` exposes a Fluent button, selected file list, clear action, `accept`, and `multiple`; the browser file input remains hidden behind the control. `FluentProgressRing` supports `size`, `active`, `value`, `max`, and `indeterminate`; `FluentProgressBar` accepts `value`, `max`, `indeterminate`, `showIndicator`, and `snap` with a configurable `step` (default 10).

Switches and sliders can omit a visible `label` when an `aria-label` is supplied. `FluentScrollViewer` scrolls vertically by default, enables horizontal scrolling with `horizontal`, and exposes `element()` and `scrollTo(options)` through `FluentScrollViewerHandle`. Set `focusable` to false for a non-tab-stop container.

`FluentSlider` accepts continuous values by default. Set `snap="integer"` for whole numbers or `snap="available"` with `availableValues` for the nearest listed value. The existing `step` prop remains available for a numeric range interval when `snap` is omitted; `snap="none"` explicitly allows any value. `availableValues` also draws marks at those values; `tickFrequency` sets the small-mark interval and `majorTickFrequency` sets a larger-mark interval, independently of snapping. Set `tickPlacement` to `start`, `end`, or `outside` (both sides), and `orientation` to `horizontal` or `vertical`. Values outside the range and non-finite values are ignored in the available list. `formatValue` controls the visible value text; by default the actual number is shown.

`FluentSvgIcon` and `FluentIconText` accept an SVG string. Both default to `trim=true` and `optical=true`: rendered nontransparent bounds remove whitespace, and background-relative color weight estimates the visual center. Set either option to `false` independently. The source remains intact; the image is translated and scaled to preserve all sampled paint, including strokes. `FluentSvgIcon` uses a square `size` slot. `FluentIconText` uses the painted width for spacing and reserves the icon's height in the text line.

`FluentSvgIcon` is decorative by default; pass `label` for an accessible image name. `FluentIconText` uses the default slot as its visible and accessible text. Its vertical center follows browser font metrics for a Latin cap or CJK reference glyph; complex mixed-script shaping and multiline labels remain approximate. Logical spacing supports RTL.

A `ready` event carries the measurement; `data-status` reports `pending`, `estimated`, `empty`, `no-contrast`, or `error`. Invalid SVG emits `error`. CSS theme and interaction colors are remeasured. For gradient/image surfaces, provide an opaque `background`; `foreground` overrides inherited `currentColor`. These are geometric and color-based estimates, not a calibrated model of human perception. Supported input is self-contained, static SVG; external resources and active content are rejected.
```vue
<FluentSvgIcon :svg="searchSvg" label="Search" :size="20" />
<FluentIconText :svg="saveSvg">Save</FluentIconText>
```

```vue
<FluentSlider v-model="value" :min="0" :max="100"
  :tick-frequency="5" :major-tick-frequency="20"
  :available-values="[0, 25, 60, 100]" snap="available"
  label="Level" />
```

`stops` is an array of `{ value, label?, disabled? }` that supplies the marks, labels under each mark and snap targets for any count of stops (snap defaults to `available`). Disabled stops stay visible but are skipped by dragging and the keyboard. `tone="neutral"` renders the fill and thumb in the text color instead of the accent. When `modelValue` changes outside a drag, the thumb animates to the new value unless reduced motion is requested.

Selection controls use inline SVG affordances for their open, closed, and selected states; they do not use font glyphs for icons. Icon paths come from Microsoft Fluent UI System Icons (16px regular) and are baked in by `icons.mjs` at build time; `@fluentui/svg-icons` is a dev dependency only.

Popover controls initialize bundled standard Popover support on mount when the WebView lacks the native API. Select and menu panels render in the document body to avoid clipping by scroll containers; menus accept an explicit `portal` override. Portaled panels retain Fluent theme tokens and forwarded attributes.
