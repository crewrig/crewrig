// Renders a status badge. `color` is one of: red, green, amber.
export function renderBadge(el, color, label) {
  el.className = `rounded px-2 py-1 text-white bg-${color}-600`;
  el.textContent = label;
}
