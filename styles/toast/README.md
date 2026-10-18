# Platform Kit Toast

Apache-2.0 transient notifications: a framework-free store with focus-aware timing, a Vue host, a DOM host for pages without Vue, and one stylesheet for both.

```json
{
  "dependencies": {
    "@platform-kit/toast": "https://github.com/lsy-404/platform-kit/releases/download/toast-v0.1.0/platform-kit-toast-0.1.0.tgz"
  }
}
```

## Vue

```ts
import { createApp } from "vue";
import { createToastPlugin } from "@platform-kit/toast/vue";
import "@platform-kit/toast/style.css";

createApp(App).use(createToastPlugin()).mount("#app");
```

```vue
<!-- once, in the root component -->
<ToastHost :label="t('notifications')" :close-label="t('close')" :theme="theme" />
```

Call sites import the shared store; it works outside components, in stores and in API helpers:

```ts
import { toast } from "@platform-kit/toast";

toast.success("Saved");
toast.error("Upload failed", "Network");
const id = toast.push("Restarting in 10 s", {
  title: "Update ready",
  duration: 0,
  actions: [
    { label: "Later", onClick: cancel },
    { label: "Restart now", onClick: restart, primary: true },
  ],
});
toast.update(id, { message: "Restarting in 9 s" });
```

Inside components `useToast()` returns the injected store (or the shared one). To let toasts in a background window linger, enable the unfocused rate once at startup:

```ts
toast.configure({ unfocusedRate: true }); // 0.5× while unfocused; or a number such as 0.25
```

## Without Vue

Bundled pages use the DOM host:

```ts
import { toast } from "@platform-kit/toast";
import { mountToastHost } from "@platform-kit/toast/dom";
import "@platform-kit/toast/style.css";

const host = mountToastHost({ closeLabel: "Close", theme: "dark" });
toast.info("Connected");
host.setTheme("light");
```

Pages without a bundler load the single-file build, which defines `window.PlatformKitToast` with the store API and `mountToastHost`:

```html
<link rel="stylesheet" href="vendor/platform-kit-toast/toast.css" />
<script src="vendor/platform-kit-toast/toast.browser.js"></script>
<script>
  const { toast, mountToastHost } = PlatformKitToast;
  mountToastHost();
  toast.success("Saved");
</script>
```

Copy `dist/toast.browser.js` and `dist/toast.css` from the release archive into the page's static files. Messages and titles are always rendered as text.

## Behavior

- `duration` is the display time in milliseconds at rate 1. It defaults to 3000, 5000 for `error`; `0` keeps the toast until it is closed.
- Timers pause while the pointer or keyboard focus is inside the stack.
- `unfocusedRate` sets the clock rate while the window is unfocused or hidden: `false` (default) keeps 1, `true` uses 0.5, and a number sets the rate. Focused windows always run at 1. A rate change keeps elapsed time and reschedules every timer.
- `createToastStore({ unfocusedRate, duration, errorDuration, limit })` sets these per store; `toast.configure({ ... })` changes the shared store at runtime. `createToastStore({ rate })` replaces the whole attention policy.
- Past `limit` (default 5) the oldest timed toast goes first, then the oldest sticky one; the newest toast always stays.
- An action dismisses its toast after running unless it sets `keepOpen: true`.
- `error` toasts use `role="alert"` and `aria-live="assertive"`; other kinds use `role="status"` and `aria-live="polite"`.
- `snapshot()` returns a new immutable array after every change, so it can back React's `useSyncExternalStore` or any other renderer that reuses the same class names.

## Host options

`ToastHost` props and `mountToastHost` options share names.

| Option | Default | Notes |
| --- | --- | --- |
| `store` | injected store or shared `toast` | Separate stores for tests or multiple windows |
| `to` (Vue) / `target` (DOM) | `"body"` / `document.body` | `to: null` renders the Vue host in place |
| `placement` | `"bottom-end"` | `bottom-start`, `bottom-center`, `top-end`, `top-start`, `top-center` |
| `theme` | `"system"` | `light`, `dark`, `system` |
| `label`, `closeLabel` | English | Pass localized text from the host app |
| `timestamp` | `true` | Shows the creation time |
| `observeWindow` | `true` | Tracks window focus and page visibility for `unfocusedRate` |

## Theming

Override any `--pk-toast-*` variable on `.pk-toast-host`. Defaults have zero specificity, so stylesheet order does not matter.

```css
.pk-toast-host {
  --pk-toast-surface: var(--ui-surface-raised);
  --pk-toast-accent: var(--ui-accent);
  --pk-toast-radius: var(--ui-radius-md);
  --pk-toast-z: 1000;
}
```

Reduced-motion preferences replace slide and move transitions with a short fade.
