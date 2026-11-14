# Performance: Core Web Vitals and assets

## Contents

- [Core Web Vitals targets](#core-web-vitals-targets)
- [Measurement](#measurement)
- [LCP levers](#lcp-levers)
- [CLS levers](#cls-levers)
- [INP levers](#inp-levers)
- [Fonts](#fonts)
- [Responsive images](#responsive-images)
- [Script loading](#script-loading)

## Core Web Vitals targets

| Metric                              | Good     | Needs improvement | Poor     |
|-------------------------------------|----------|-------------------|----------|
| **LCP**: Largest Contentful Paint   | ≤ 2.5 s  | ≤ 4.0 s           | > 4.0 s  |
| **CLS**: Cumulative Layout Shift    | ≤ 0.1    | ≤ 0.25            | > 0.25   |
| **INP**: Interaction to Next Paint  | ≤ 200 ms | ≤ 500 ms          | > 500 ms |

INP replaced FID as a Core Web Vital in March 2024. It measures the
worst input latency across the page lifetime, not the first.

## Measurement

- **Lighthouse** in Chrome DevTools: synthetic lab data. Use it for
  before/after diffs.
- **`web-vitals`** library: real-user metrics emitted from the page.

```js
import { onLCP, onCLS, onINP } from 'web-vitals';

onLCP((m) => navigator.sendBeacon('/rum', JSON.stringify(m)));
onCLS((m) => navigator.sendBeacon('/rum', JSON.stringify(m)));
onINP((m) => navigator.sendBeacon('/rum', JSON.stringify(m)));
```

- **Chrome User Experience Report (CrUX)**: field data aggregated by
  Google. Use it for ground truth at a domain level.

## LCP levers

- Preload the LCP image with `<link rel="preload" as="image" fetchpriority="high">`.
- Set `fetchpriority="high"` on the LCP `<img>`.
- Inline critical CSS, defer the rest with `media="print"` + onload swap.
- Eliminate render-blocking third-party scripts above the fold.

## CLS levers

- Reserve space with explicit `width` and `height` attributes on
  `<img>` and `<iframe>`, or `aspect-ratio` in CSS.
- Load custom fonts with `font-display: swap` and a metric-matched
  fallback to keep layout stable during swap.
- Reserve space for ads, embeds, and skeleton states.

## INP levers

- Break long tasks (> 50 ms) with `scheduler.yield()` or
  `requestIdleCallback`.
- Defer non-critical hydration. Ship less JavaScript.
- Debounce input handlers; batch DOM reads and writes.

## Fonts

- Self-host critical fonts; third-party font services add a DNS lookup
  and a TCP handshake to the critical path.
- Subset to the glyphs you actually use (`pyftsubset`, `glyphhanger`).
- Serve WOFF2 only. Browsers without WOFF2 support are below relevance.
- Set `font-display: swap` (or `optional` for non-critical faces) to
  prevent invisible text during font load.
- Preload the one or two faces used above the fold:

```html
<link rel="preload" href="/fonts/Inter-Regular.woff2" as="font"
      type="font/woff2" crossorigin>
```

## Responsive images

```html
<img
  src="/img/hero-800.jpg"
  srcset="/img/hero-400.jpg 400w,
          /img/hero-800.jpg 800w,
          /img/hero-1600.jpg 1600w"
  sizes="(min-width: 64rem) 50vw, 100vw"
  width="1600" height="900"
  alt="Product dashboard showing weekly revenue"
  loading="lazy"
  decoding="async">
```

- Always set `width` / `height` to reserve layout space.
- `loading="lazy"` for below-the-fold images; never for the LCP image.
- Prefer AVIF, fall back to WebP, then JPEG via `<picture>`.

## Script loading

| Attribute                | Effect                                                        |
|--------------------------|---------------------------------------------------------------|
| `<script>`               | Blocks parser. Avoid in `<head>`.                             |
| `<script defer>`         | Downloads in parallel, executes after parse, preserves order. |
| `<script async>`         | Downloads in parallel, executes ASAP, order undefined.        |
| `<script type="module">` | `defer` by default. Use for ES modules.                       |

Default to `defer` (or `type="module"`) unless the script genuinely
needs to run before parse completes, which it almost never does.
