# Framework-agnostic JavaScript

## Contents

- [ES modules](#es-modules)
- [IntersectionObserver](#intersectionobserver)
- [ResizeObserver](#resizeobserver)
- [Fetch and async patterns](#fetch-and-async-patterns)

Assume an evergreen browser baseline.

## ES modules

```js
// src/components/disclosure.js
export function attach(root) {
  const trigger = root.querySelector('[data-disclosure-trigger]');
  const panel = root.querySelector('[data-disclosure-panel]');
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });
}
```

Use native ESM (`<script type="module">`); no bundler is required for
small islands of interactivity.

## IntersectionObserver

Use for lazy reveals, infinite scroll, and view-tracking. Cheaper than
`scroll` listeners and runs off the main thread.

```js
const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    }
  }
}, { rootMargin: '0px 0px -10% 0px' });

document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
```

## ResizeObserver

Use for container-aware components when `@container` is not enough.

```js
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { width } = entry.contentRect;
    entry.target.dataset.size = width > 600 ? 'lg' : 'sm';
  }
});
ro.observe(document.querySelector('.card-host'));
```

## Fetch and async patterns

```js
async function loadPosts(signal) {
  const res = await fetch('/api/posts', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const controller = new AbortController();
loadPosts(controller.signal).catch((err) => {
  if (err.name !== 'AbortError') console.error(err);
});
// later, on navigation away:
controller.abort();
```

Pass an `AbortSignal` to `fetch` so in-flight requests cancel when the
consumer unmounts. Unhandled aborts pollute INP and leak memory in
long-lived SPAs.

## Layout thrash

Read layout properties (`offsetHeight`, `getBoundingClientRect`) in one pass
and write styles in the next. Interleaving reads and writes forces a
synchronous reflow on every iteration.
