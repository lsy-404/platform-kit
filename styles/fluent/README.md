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

```vue
<FluentSlider v-model="value" :min="0" :max="100"
  :tick-frequency="5" :major-tick-frequency="20"
  :available-values="[0, 25, 60, 100]" snap="available"
  label="Level" />
```

`stops` is an array of `{ value, label?, disabled? }` that supplies the marks, labels under each mark and snap targets for any count of stops (snap defaults to `available`). Disabled stops stay visible but are skipped by dragging and the keyboard. `tone="neutral"` renders the fill and thumb in the text color instead of the accent. When `modelValue` changes outside a drag, the thumb animates to the new value unless reduced motion is requested.

Selection controls use inline SVG affordances for their open, closed, and selected states; they do not use font glyphs for icons. Icon paths come from Microsoft Fluent UI System Icons (16px regular) and are baked in by `icons.mjs` at build time; `@fluentui/svg-icons` is a dev dependency only.
