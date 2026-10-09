// json-write.ts — the `jq` writer (spec 0254 R12).
//
// Writes what `jq .` (pretty) and `jq -c` (compact) write: two-space indentation, one
// member or element per line, `[]` and `{}` for empty containers, `": "` after a key,
// the keys of every object in the order the `Map` holds them, the string escapes of
// `jq` (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, every other control character and
// U+007F as lowercase `\u00xx`; `/` and every non-ASCII character as themselves), and a
// final line feed on the pretty form.
//
// Numbers are written as JavaScript writes the value (listed deviation 28(d)): `jq` 1.8
// keeps a literal's spelling (`30.0`, `1E+3`) where this writes `30` and `1000`.
// `formatNumber` is the one seam where that is decided.

import type { JsonValue } from "./types.ts";

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/** The text of a number, as `jq` would print the value `-0` and finite doubles. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("cannot write a non-finite number as JSON");
  return Object.is(value, -0) ? "-0" : String(value);
}

/** A JSON string literal as `jq` writes it. */
export function quote(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const simple = ESCAPES[ch];
    if (simple !== undefined) out += simple;
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

function render(value: JsonValue, indent: string | null, level: number): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return quote(value);
  const members: string[] =
    value instanceof Map
      ? [...value].map(
          ([key, item]) =>
            `${quote(key)}${indent === null ? ":" : ": "}${render(item, indent, level + 1)}`,
        )
      : value.map((item) => render(item, indent, level + 1));
  const [open, close] = value instanceof Map ? ["{", "}"] : ["[", "]"];
  if (members.length === 0) return `${open}${close}`;
  if (indent === null) return `${open}${members.join(",")}${close}`;
  const inner = indent.repeat(level + 1);
  return `${open}\n${inner}${members.join(`,\n${inner}`)}\n${indent.repeat(level)}${close}`;
}

/** The pretty form of `jq .`, with its final line feed. */
export function writeJsonText(value: JsonValue): string {
  return `${render(value, "  ", 0)}\n`;
}

/** The compact form of `jq -c`, without a line feed. */
export function writeJsonCompact(value: JsonValue): string {
  return render(value, null, 0);
}

/**
 * The text `jq -r` prints for a value, trailing line feeds removed as the shell's
 * command substitution removed them: a string verbatim, an absent or null value as
 * `null`, a number or a boolean as its JSON text, a container in its pretty form.
 */
export function jqText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return value.replace(/\n+$/, "");
  return render(value, "  ", 0);
}

/** An object whose members keep the order of `pairs` (a later pair replaces an earlier key in place). */
export function obj(pairs: ReadonlyArray<readonly [string, JsonValue]>): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>();
  for (const [key, value] of pairs) map.set(key, value);
  return map;
}
