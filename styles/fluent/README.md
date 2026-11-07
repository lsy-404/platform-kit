# Platform Kit Fluent

Apache-2.0 Fluent-style CSS with Vue controls, navigation, and browser-native overlays.

Live preview: [showcase](https://lsy-404.github.io/platform-kit/) and [control catalog](https://lsy-404.github.io/platform-kit/catalog.html), rebuilt from `main` and every `fluent-v*` release.

```ts
import { FluentButton, FluentTheme } from "@platform-kit/fluent/vue";
import "@platform-kit/fluent/style.css";
```

The source repository is public and releases are distributed as GitHub Release artifacts. `private: true` only prevents accidental npm publication; it does not restrict source use under Apache-2.0.

`FluentTheme` supports `light`, `dark`, and `system` modes. Vue is a peer dependency.

### Theme preferences

`FluentTheme` also takes style preferences. Each one you set is written as a `data-fluent-*` attribute and mapped to CSS custom properties, so a nested `FluentTheme` (or the same attribute on any element inside a theme) overrides only its subtree and unset values are inherited. Plain CSS consumers can set the attributes directly.

| Prop | Attribute | Values (default first) |
| --- | --- | --- |
| `motion` | `data-fluent-motion` | `slide`, `stretch`, `fade`, `none` — how selection indicators move |
| `pageTransition` | `data-fluent-page-transition` | `entrance`, `fade`, `slide`, `scale`, `wipe`, `none` — how views swap |
| `curve` | `data-fluent-curve` | `decelerate-mid`, `decelerate-max`, `decelerate-min`, `easy-ease`, `easy-ease-max`, `ease`, `linear`, `spring` |
| `speed` | `data-fluent-speed` | `normal`, `faster` (0.5×), `fast` (0.75×), `slow` (1.5×), `slower` (2×) |
| `reducedMotion` | `data-fluent-reduced-motion` | `system`, `reduce` (forces reduced motion for the subtree) |
| `emphasis` | `data-fluent-emphasis` | `indicator`, `neutral`, `tinted`, `filled`, `underline` — selected-item style |
| `corner` | `data-fluent-corner` | `medium`, `none`, `small`, `large` |
| `toggleMotion` | `data-fluent-toggle-motion` | `stretch`, `slide`, `none` — switch thumb and toggle button state change; `stretch` grows the thumb on hover and elongates it while pressed |
| `checkMotion` | `data-fluent-check-motion` | `draw`, `fade`, `none` — checkbox glyph and radio dot; `draw` reveals the check along its stroke and grows the bar and dot from the centre |
| `menuMotion` | `data-fluent-menu-motion` | `slide`, `fade`, `scale`, `none` — popover, select and menu panels; `slide` and `scale` start at the anchor edge (`data-side`) |
| `ringMotion` | `data-fluent-ring-motion` | `stretch`, `spin`, `dots` — indeterminate `FluentProgressRing`; `stretch` grows and shrinks a rotating arc, `spin` rotates a fixed quarter arc, `dots` orbits five staggered dots |
| `barMotion` | `data-fluent-bar-motion` | `dynamic`, `linear`, `bounce` — indeterminate `FluentProgressBar`; `dynamic` sweeps two segments of different timing (WinUI), `linear` sweeps one segment at constant speed, `bounce` moves one segment back and forth |

The control motions are also written onto each component's own root (switch, toggle button, checkbox, radio, popover panel, progress ring and bar) from the injected theme state, so they apply to portaled panels and nest correctly; `useFluentPreference(key)` returns the same resolved value as a computed. Unset preferences inherit through CSS from the nearest outer theme, so a nested `FluentTheme` that sets one preference keeps the parent's speed, curve and corners. `FluentDialog` opens with the ContentDialog animation (scale from 1.05 with fade, backdrop fade) and follows speed and reduced motion.

The curves follow Fluent 2 motion tokens (`decelerate-mid` is the WinUI control spline `0,0,0,1`); `spring` is a damped spring with about 8% overshoot. Durations (`--fluent-faster`, `--fluent-fast`, `--fluent-normal`) scale with `speed`, every built-in transition uses `--fluent-ease`, and `prefers-reduced-motion: reduce` or `reducedMotion="reduce"` sets the scale to zero and turns indicator motion and page transitions off. `fluentPreferenceOptions` lists every value and `fluentDefaultPreferences` the defaults; the injected theme state carries the resolved `preferences`.

```vue
<FluentTheme mode="system" motion="stretch" curve="spring" speed="slow" emphasis="tinted" corner="large">
  <App />
</FluentTheme>
```

Controls include buttons, fields, switches, sliders, selects, file pickers, checkboxes, progress indicators, and a scroll viewer. `FluentCheckbox` accepts boolean `v-model` and a label slot. `FluentFilePicker` exposes a Fluent button, selected file list, clear action, `accept`, and `multiple`; the browser file input remains hidden behind the control. `FluentProgressRing` supports `size`, `active`, `value`, `max`, and `indeterminate` (the indeterminate style follows `ringMotion`, timed by the theme speed; reduced motion leaves a still indicator); `FluentProgressBar` (indeterminate style follows `barMotion`) accepts `value`, `max`, `indeterminate`, `showIndicator`, and `snap` with a configurable `step` (default 10).

`FluentGauge` is a 270° dashboard gauge, open at the bottom, with a large centre value and an optional caption. It takes `value`, `min`, `max`, a required `label`, `formatValue`, `caption`, and `size` (default 120), exposes `role="meter"`, animates the arc and counts the centre number when the value changes (respecting reduced motion), and does not animate on first mount.

Switches and sliders can omit a visible `label` when an `aria-label` is supplied. `FluentScrollViewer` scrolls vertically by default, enables horizontal scrolling with `horizontal`, and exposes `element()` and `scrollTo(options)` through `FluentScrollViewerHandle`. Set `focusable` to false for a non-tab-stop container.

`FluentSlider` accepts continuous values by default. Set `snap="integer"` for whole numbers or `snap="available"` with `availableValues` for the nearest listed value. The existing `step` prop remains available for a numeric range interval when `snap` is omitted; `snap="none"` explicitly allows any value. `availableValues` also draws marks at those values; `tickFrequency` sets the small-mark interval and `majorTickFrequency` sets a larger-mark interval, independently of snapping. Set `tickPlacement` to `start`, `end`, or `outside` (both sides; the default, or `end` when the slider has labelled `stops`), and `orientation` to `horizontal` or `vertical`. Values outside the range and non-finite values are ignored in the available list. `formatValue` controls the visible value text; by default the actual number is shown.

`FluentSvgIcon` and `FluentIconText` accept an SVG string. Both default to `trim=true` and `optical=true`: rendered nontransparent bounds remove whitespace, and background-relative color weight estimates the visual center. Set either option to `false` independently. `opticalStrength` (0–1, default 1) moves the centre only part of the way from the geometric centre towards the colour-weighted estimate. `scale` chooses how the paint is sized around that centre: `fill` (default) grows or shrinks it to the largest size that keeps all paint in the slot, `fit` keeps the source scale and only shrinks when the shift would push paint out, and `none` keeps the source scale even if paint is clipped. The source remains intact; the image is translated and scaled to preserve all sampled paint, including strokes. `FluentSvgIcon` uses a square `size` slot. `FluentIconText` uses the painted width for spacing and reserves the icon's height in the text line.

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

`stops` is an array of `{ value, label?, disabled? }` that supplies the marks, labels under each mark and snap targets for any count of stops (snap defaults to `available`). Disabled stops stay visible but are skipped by dragging and the keyboard. `tone="neutral"` renders the fill and thumb in the text color instead of the accent. A slider with labelled stops exposes the active label as `aria-valuetext` and omits the header value unless `formatValue` is passed. When `modelValue` changes outside a drag, the thumb glides to the new value over the theme `fast` duration, which is zero when motion is reduced.

Selection controls use inline SVG affordances for their open, closed, and selected states; they do not use font glyphs for icons. Icon paths come from Microsoft Fluent UI System Icons (16px regular) and are baked in by `icons.mjs` at build time; `@fluentui/svg-icons` is a dev dependency only.

Popover controls initialize bundled standard Popover support on mount when the WebView lacks the native API. Select and menu panels render in their nearest open dialog or the document body, preserving modal focus while avoiding nested scroll containers; menus accept an explicit `portal` override. Portaled panels retain Fluent theme tokens and forwarded attributes. Select width follows its current anchor when the layout or viewport changes.

`FluentSegmented` is an equal-width option switch (`role="radiogroup"` with roving tabindex; arrow keys, Home and End move and select, skipping disabled options, with Left/Right swapped in RTL). It takes `modelValue`, `options` (`{ value, label, disabled? }[]`, exported as `FluentSegmentedOption`), `label` (accessible name) and `disabled`, and emits `update:modelValue` and `change`.

`FluentNavigation` is a vertical list of `items` (`{ key, label, disabled?, children? }`, exported as `FluentNavigationItem`) with `modelValue` (the selected leaf key) and `label` (accessible name); it emits `update:modelValue` and `select` with the key. An item with `children` (any depth) is a group header: click, Enter or Space toggles it, it shows a chevron, has `aria-expanded` and `aria-controls` for its `role="group"` list, and is never selected and never emits. Children are indented per level and expand with a height reveal that follows the theme `normal` duration and curve; collapsed children are hidden from focus and assistive technology. Expansion is internal state; when `modelValue` changes (including its initial value) to a leaf inside collapsed groups, those groups expand. While a group hides the selected leaf, the indicator and selected colours sit on the outermost collapsed group and move back to the leaf when it expands. Arrow Up/Down move through visible items (selecting leaves, only focusing headers), Home and End go to the first and last visible item, Right expands a collapsed header or moves into an expanded one, and Left collapses an expanded header or moves to the parent header; disabled items are skipped and Left/Right swap in RTL.

`FluentSegmented` and `FluentNavigation` animate a selection indicator that lives inside the selected item. Motion follows the theme's `motion`, `curve` and `speed` preferences (`slide`, `stretch`, `fade`, `none`; no animation under reduced motion), and the selected colours follow `emphasis`. Both components accept optional `motion` and `emphasis` props that override the theme for that component.

### View transitions

`FluentTransitionView` swaps its slot content with the native View Transition API, using the `pageTransition` theme preference (`entrance`, `fade`, `slide`, `scale`, `wipe`, `none`; `none` under reduced motion). Without `document.startViewTransition`, or when the style is `none` or motion is scaled to 0, the content simply changes with no animation.

```vue
<FluentTransitionView :view-key="page" :order="['home', 'detail']" v-slot="{ viewKey }">
  <Home v-if="viewKey === 'home'" />
  <Detail v-else />
</FluentTransitionView>
```

Props: `viewKey` (required), `transition` (overrides the theme preference for this view), `direction` (`forward` or `back`; slide, scale and wipe depend on it) and `order` (when `direction` is omitted, moving to a later index is forward). The slot receives the displayed `viewKey`, which changes only when the browser has captured the outgoing view; rapid changes end on the latest key.

Slide moves new content in from the right (forward) or left (back). Scale is the drill transition: forward grows from 0.94 while the old view grows slightly and fades, back reverses. Wipe sweeps an accent-coloured block across the view and then reveals the new content from the same side.

Element-level transitions combine with every style. Give an element in the old view and the matching element in the new view the same name with `v-fluent-shared="'photo'"`; it moves and resizes between them, and elements of different shape (a small rounded button and a large panel) morph into one continuous shape. A name must be unique within each view; an empty value clears it.

`fluentViewTransition(update, { element?, transition?, direction?, onFinish? })` is the framework-free entry point; it resolves once `update` has been applied. Its CSS custom properties and `data-fluent-view-*` attributes are placed on `<html>` for the duration of the transition.
