// fields.ts — payload field reading and byte-bounded cuts for the MemPalace
// transcript hook (spec 0247 R8, R12).
//
// The shell hook read every field with `jq -r '.a // .b // empty'` inside a
// command substitution. Its rules, kept here:
//   - `//` selects the first candidate that is neither absent, `null` nor
//     `false` (an empty string IS selected);
//   - the selected value is used when it is a non-empty string, or a number
//     rendered in its JSON decimal form; anything else counts as absent
//     (R8 — `jq -r` printed objects and arrays as JSON, a deviation of R30);
//   - `$(…)` drops trailing line feeds, so a string made only of line feeds
//     is empty, hence absent.
//
// Standard library only.

export type Payload = Readonly<Record<string, unknown>>;
export type FieldPath = readonly (string | number)[];

/** One `jq` path segment. A value that cannot be indexed reads as absent. */
function step(value: unknown, segment: string | number): unknown {
  if (typeof segment === "number") {
    return Array.isArray(value) ? (value[segment] as unknown) : undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[segment];
}

/** The value at a path, `undefined` when any segment is missing. */
export function valueAt(payload: unknown, path: FieldPath): unknown {
  let value = payload;
  for (const segment of path) value = step(value, segment);
  return value;
}

/** `jq`'s `//` selection: the first value that is neither absent, `null` nor `false`. */
export function selectAlt(payload: unknown, paths: readonly FieldPath[]): unknown {
  for (const path of paths) {
    const value = valueAt(payload, path);
    if (value === undefined || value === null || value === false) continue;
    return value;
  }
  return undefined;
}

/** The shell's `$(…)`: the text without its trailing line feeds. */
export function stripTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

/**
 * A selected value rendered as `jq -r` inside `$(…)` gave it, under R8: a
 * string or a number; any other value, and the empty result, is `undefined`.
 */
export function renderSelected(value: unknown): string | undefined {
  let text: string | undefined;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" && Number.isFinite(value)) text = JSON.stringify(value);
  if (text === undefined) return undefined;
  const stripped = stripTrailingNewlines(text);
  return stripped === "" ? undefined : stripped;
}

/** `$(jq -r '<paths joined by //> // empty')` under R8. */
export function readField(payload: unknown, ...paths: FieldPath[]): string | undefined {
  return renderSelected(selectAlt(payload, paths));
}

/** The first `count` characters (code points) of a text, as Bash's `${v:0:n}` reads them in a UTF-8 locale. */
export function firstChars(text: string, count: number): string {
  let out = "";
  let taken = 0;
  for (const ch of text) {
    if (taken === count) break;
    out += ch;
    taken += 1;
  }
  return out;
}

/** At most `maxBytes` bytes of UTF-8, cut on a character boundary (R12). */
export function utf8Cut(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Step back over continuation bytes (10xxxxxx) to the start of the cut character.
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
