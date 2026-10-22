# @platform-kit/liquid-glass

An appearance pack for liquid glass surfaces, after Shu Ding's
[Liquid Glass](https://github.com/shuding/liquid-glass): a surface keeps its own edge, its middle stays nearly clear,
and only the band along its rim refracts the page behind it.

- **Lens** — `liquidGlass()` watches a subtree and gives each matching element an SVG displacement filter sized to
  its box and corner radius (`--pk-lens`). Filters are shared per shape, maps are cached, resizes are throttled.
- **Materials** — `.pk-glass` for cards, panels and chart backgrounds (fill, stroke, edge light, a masked rim
  gradient) and `.pk-glass-field` for inputs, selects and search boxes (inset rim light, no pseudo-element).
- **Fallbacks** — forced colors, more contrast and reduced transparency get an opaque surface and no lens; engines
  that cannot lead `backdrop-filter` with an SVG filter keep the material without the lens.

## Install

```json
"@platform-kit/liquid-glass": "https://github.com/lsy-404/platform-kit/releases/download/liquid-glass-v0.1.0/platform-kit-liquid-glass-0.1.0.tgz"
```

## Use

```ts
import '@platform-kit/liquid-glass/style.css'
import { liquidGlass } from '@platform-kit/liquid-glass'

// Every .pk-glass / .pk-glass-field / [data-pk-glass] under body refracts as it mounts.
const stop = liquidGlass(document.body)
```

```html
<section class="pk-glass">…</section>
<input class="pk-glass-field">
```

Bring your own selectors when the host already has surface classes; style them with the `--pk-glass-*` tokens and
lead their `backdrop-filter` with `var(--pk-lens,)`:

```ts
liquidGlass(document.body, { selector: '.card, .input, .chart-frame' })
```

```css
.card { background-color: var(--pk-glass-fill); backdrop-filter: var(--pk-lens,) var(--pk-glass-filter); }
```

An element inside another refracting one stays flat (`flatWhenNested`, default true): the outer surface's backdrop
filter makes it the inner one's backdrop root, so an inner lens would only bend the outer fill.

Vue: `import { vLiquidGlass } from '@platform-kit/liquid-glass/vue'`, then `v-liquid-glass` or
`v-liquid-glass="enabled"` on any element. Pages without a bundler can load `./browser` and use
`window.PlatformKitLiquidGlass`.

## Theme

Dark tokens are the default; `prefers-color-scheme: light` switches `:root` unless it carries
`data-pk-glass-theme="dark"`, and `data-pk-glass-theme="light" | "dark"` forces a container. Override any token:

| Token | Use |
| --- | --- |
| `--pk-glass-fill`, `--pk-glass-fill-hover` | Surface fill |
| `--pk-glass-filter` | Filter after the lens (a hair of blur, brightness, saturation) |
| `--pk-glass-stroke`, `--pk-glass-stroke-hover` | Surface border |
| `--pk-glass-rim` | Rim light gradient |
| `--pk-glass-edge`, `--pk-glass-shadow` | Inset edge light and outer shadow |
| `--pk-glass-radius` | Surface corner radius |
| `--pk-glass-field-*` | The same for fields: `fill`, `fill-hover`, `stroke`, `stroke-hover`, `edge`, `filter`, `radius` |
| `--pk-glass-solid`, `--pk-glass-solid-stroke` | Opaque fallback |

## License

Apache-2.0. The rim lens adapts MIT-licensed code by Shu Ding; see [NOTICE](NOTICE).
