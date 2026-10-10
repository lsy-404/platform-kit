# @platform-kit/visual-center

Small framework-independent visual-center estimator. The core accepts RGBA pixels in Node or the browser; the optional browser entry renders static SVG with the browser's SVG engine. It has no Vue, Playwright or native renderer dependency.

```ts
import { analyzePixels } from '@platform-kit/visual-center';
const measurement = analyzePixels(imageData, { background: '#ffffff' });
// measurement.offset is the translation toward the image viewport center, in pixels.
```

```ts
import { measureSvg } from '@platform-kit/visual-center/browser';
const measurement = await measureSvg(svgSource, {
  width: 24, height: 24, background: '#202020', color: '#ffffff'
});
```

`bounds` contains every sampled nontransparent pixel, including strokes and filters. `center` is the centroid weighted by the Oklab distance between the composited pixel and the supplied opaque background. Alpha enters through compositing once. `alphaCenter` separately reports the opacity-weighted centroid. `offset` equals viewport center minus estimated center. Browser coordinates are CSS pixels; raw RGBA coordinates are input pixels.

`status` is `estimated`, `empty` or `no-contrast`. Empty and zero-contrast images have no proposed center or offset. `paintTouchesViewport` flags paint at the sampling edge; content already clipped by the source viewport cannot be recovered. `sampleScale` defaults to 4 and accepts 1–8. Sampling is limited to four megapixels.

The SVG entry accepts self-contained, static SVGs with local definitions and embedded raster images. External resources, active content and animations are rejected. `color` must be resolved; pass the actual foreground and background for each theme. SVG measurements return the sized `svg` that was rendered, for consistent display. Arbitrary CSS from a host document and external fonts are not captured. Native image/canvas decoding can supply RGBA for PNG or other formats.

## Model and limits

The estimator uses the center-of-mass approach studied by [Hübner and Fillinger (2016)](https://doi.org/10.3389/fpsyg.2016.00335). Background-relative Oklab distance is an engineering choice using [Oklab](https://bottosson.github.io/posts/oklab/), not a psychophysically calibrated visual-weight formula. [Firestone and Keil (2016)](https://doi.org/10.1037/xge0000151) show why perceived balance need not equal pixel mass. The result is an estimate, not a guarantee of perceptual correctness; icon family conventions and human comparison still matter.

This package measures. Cropping, font baselines, spacing and application of offsets belong to the consuming design system. Fluent provides those behaviors in its SVG/icon-text components.
