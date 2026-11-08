# Fluent Preview

Two pages for `@platform-kit/fluent`:

- `index.html` is the showcase, an app-style tour of the theme.
- `catalog.html` is the interactive catalog for every current Fluent Vue export and the native semantic controls styled by `@platform-kit/fluent/style.css`.

Run `pnpm --filter @platform-kit/fluent build`, then `pnpm --filter @platform-kit/fluent-preview dev`. The build uses relative asset paths, so `dist` can be served from any directory.

The `Publish Fluent preview` workflow builds this app on every push to `main` and every `fluent-v*` tag and deploys `dist` to GitHub Pages at https://lsy-404.github.io/platform-kit/.

## Showcase

The showcase is one `FluentTheme` around a title bar, a two-level `FluentNavigation` side menu and a `FluentTransitionView` that switches pages with the current page transition. Each leaf page is kept in the URL hash (for example `#motion-controls`), and theme, accent and preferences are kept in the query string with the same keys as the catalog.

- **Customize** holds every preference as a real control: theme and accent (swatches and a custom color); speed, curve and reduced motion; selection indicator, toggle, check, dropdown, progress ring and indeterminate bar motion and the page transition; emphasis and corners. It is docked from 1180px and opens as a drawer below that.
- **Overview** has presets that set several preferences and an accent at once, and a tile for each preference.
- **Motion**: curves and speed (scaled durations, a curve demo that animates a pager, buttons, a toast, a drawer, an accordion and real Fluent controls with any curve, and a race of every curve), selection motion, and control motion, where every toggle, check, dropdown, progress ring and progress bar motion value sits in its own nested `FluentTheme` row for comparison.
- **Appearance**: the accent on every control type, emphasis styles and corners.
- **Page transitions** picks the app's own transition and holds the shared-element mini app.
- **Controls**, **Sliders** and **Feedback** compose every export into forms, actions and overlays, sound and display panels, an equalizer of vertical sliders, upload progress, progress rings, live gauges, activity, and a comparison of how colour and surface move the visual centre of an icon.

Below 760px the side menu becomes a drawer behind the menu button.

The catalog intentionally does not imitate component families that the package does not export: DataGrid, TreeView, DatePicker, CommandBar, TeachingTip, SplitView, Tabs, and InfoBar.

## Catalog preferences

The catalog header holds a control for every `FluentTheme` preference (`motion`, `speed`, `reducedMotion`, `corner`, `curve`, `emphasis`, `pageTransition`) next to Theme and Accent. The state is mirrored into the URL query with the prop names as keys (for example `?theme=dark&curve=spring&emphasis=filled`), so a configuration can be shared; Reset restores `fluentDefaultPreferences`.

The Preferences section plots every curve (read from the computed `--fluent-ease` of a probe element), plays the current curve at the current duration, compares selection motion and emphasis on `FluentSegmented` and `FluentNavigation`, and shows corner variants with the scaled durations. The toolbar sits at the top of the main column so keyboard order matches the visual order. The Page transitions card is a mini app on `FluentTransitionView` with a photo thumbnail that shares its name with the detail image, a pill that morphs into a panel, a per-card style override and Replay.
