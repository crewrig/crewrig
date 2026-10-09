// mempalace-pin.ts — read the MemPalace supported-range pin (spec 0252
// requirement 4, delta-01).
//
// The TypeScript counterpart of the pin reader in scripts/lib/mempalace_pin.py
// (`read_pin`): the pin is the two declaration lines
//
//     MEMPALACE_MIN_VERSION="<version>"
//     MEMPALACE_MAX_VERSION_EXCLUSIVE="<version>"
//
// of scripts/lib/common.sh (lines 15 and 16), which stay the single executable
// declaration until row J4 relocates it. This module SHALL NOT declare either
// value a second time: it reads them, by the same rules as `read_pin` —
// line-anchored, double-quoted, and exactly one declaration per name (an
// ambiguous file is a refusal, never a guess between candidates). The
// interpolated consumer forms further down common.sh
// (`mempalace>=${MEMPALACE_MIN_VERSION},<...`) never match the anchored form.
// No shell is spawned to obtain the values. J4 changes only this module.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

/** The MemPalace supported range `[min, maxExclusive)`. */
export interface MempalacePin {
  readonly min: string;
  readonly maxExclusive: string;
}

/** Where the pin is declared, relative to the repository root. */
const PIN_FILE = ["scripts", "lib", "common.sh"] as const;

const MIN_NAME = "MEMPALACE_MIN_VERSION";
const MAX_NAME = "MEMPALACE_MAX_VERSION_EXCLUSIVE";

// Line-anchored like `_PIN_RE` of mempalace_pin.py, whose `$` ends a line at
// `\n` only. JavaScript's `m` flag also ends one at `\r`, so the anchors are
// spelled out: not preceded and not followed by anything but a newline. The
// file is read as Python reads it in text mode (universal newlines): `\r\n` and
// a lone `\r` are translated to `\n` first, so a CRLF checkout reads the same pin.
const PIN_RE =
  /(?<![^\n])(MEMPALACE_MIN_VERSION|MEMPALACE_MAX_VERSION_EXCLUSIVE)="([^"]*)"(?![^\n])/g;

/**
 * Read the pin from `<repoRoot>/scripts/lib/common.sh`.
 *
 * Throws the file-system error when the file cannot be read, and an `Error`
 * naming the offending variable when either name is absent or declared more
 * than once.
 */
export function readMempalacePin(repoRoot: string): MempalacePin {
  const file = path.join(repoRoot, ...PIN_FILE);
  const text: unknown = fs.readFileSync(file, "utf8");
  if (typeof text !== "string") throw new Error(`${file} did not read as text`);
  const seen = new Map<string, string[]>();
  for (const match of text.replace(/\r\n?/g, "\n").matchAll(PIN_RE)) {
    const name: unknown = match[1];
    const value: unknown = match[2];
    if (typeof name !== "string" || typeof value !== "string") continue;
    const values = seen.get(name) ?? [];
    values.push(value);
    seen.set(name, values);
  }
  return { min: single(seen, MIN_NAME, file), maxExclusive: single(seen, MAX_NAME, file) };
}

function single(seen: ReadonlyMap<string, readonly string[]>, name: string, file: string): string {
  const values = seen.get(name) ?? [];
  const only = values[0];
  if (values.length !== 1 || only === undefined) {
    throw new Error(
      `${name} must be declared exactly once as ${name}="<version>" at line start; ` +
        `found ${values.length} declaration(s) in ${file}`,
    );
  }
  return only;
}

/**
 * The pip requirement for the pinned range, the text `offer_mempalace_install`
 * of common.sh hands to `pipx install` (`mempalace>=3.6.0,<3.7` for a pin of
 * 3.6.0 and 3.7): the lower bound inclusive, the upper bound exclusive.
 */
export function installSpec(pin: MempalacePin): string {
  return `mempalace>=${pin.min},<${pin.maxExclusive}`;
}
