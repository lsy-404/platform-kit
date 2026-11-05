# Fluent Preview

Interactive catalog for every current Fluent Vue export and the native semantic controls styled by `@platform-kit/fluent/style.css`.

Run `pnpm --filter @platform-kit/fluent build`, then `pnpm --filter @platform-kit/fluent-preview dev`.

The catalog intentionally does not imitate component families that the package does not export: DataGrid, TreeView, DatePicker, CommandBar, TeachingTip, SplitView, Tabs, and InfoBar.

## Preferences

The header holds a control for every `FluentTheme` preference (`motion`, `speed`, `reducedMotion`, `corner`, `curve`, `emphasis`, `pageTransition`) next to Theme and Accent. The state is mirrored into the URL query with the prop names as keys (for example `?theme=dark&curve=spring&emphasis=filled`), so a configuration can be shared; Reset restores `fluentDefaultPreferences`.

The Preferences section plots every curve (read from the computed `--fluent-ease` of a probe element), plays the current curve at the current duration, compares selection motion and emphasis on `FluentSegmented` and `FluentNavigation`, and shows corner variants with the scaled durations. Its navigation demos mount when the section scrolls into view.
