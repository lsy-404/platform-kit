# Platform Kit Fluent

Apache-2.0 Fluent-style CSS with Vue controls, navigation, and browser-native overlays.

```ts
import { FluentButton, FluentTheme } from "@platform-kit/fluent/vue";
import "@platform-kit/fluent/style.css";
```

The source repository is public and releases are distributed as GitHub Release artifacts. `private: true` only prevents accidental npm publication; it does not restrict source use under Apache-2.0.

`FluentTheme` supports `light`, `dark`, and `system` modes. Vue is a peer dependency.

Controls include buttons, fields, switches, sliders, selects, checkboxes, progress indicators, and a scroll viewer. `FluentCheckbox` accepts boolean `v-model` and a label slot. `FluentProgressRing` supports `size`, `active`, `value`, `max`, and `indeterminate`; `FluentProgressBar` accepts `value`, `max`, and `indeterminate`.

Switches and sliders can omit a visible `label` when an `aria-label` is supplied. `FluentScrollViewer` scrolls vertically by default, enables horizontal scrolling with `horizontal`, and exposes `element()` and `scrollTo(options)` through `FluentScrollViewerHandle`. Set `focusable` to false for a non-tab-stop container.
