// allowlist.ts — parser for ci/host-safety-allowlist.txt (spec 0267 R9-R10).
//
// Format: `#` lines are comments; every other line is
// `<path>::<enclosing-function>::<callee>#<ordinal><TAB><justification>`, sorted in byte order and
// unique. `scripts/lib/ratchet-lists.ts` is NOT reused: its `parseList` and `finding` are bound to
// the `ratchet:` prefix and a module-level collector, and its rule ids are `list-*`.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { WiringError, repoRoot } from "../ts-scope.ts";

export const ALLOWLIST = "ci/host-safety-allowlist.txt";

export interface AllowEntry {
  key: string;
  justification: string;
  line: number;
}

export interface Hygiene {
  line: number;
  message: string;
}

export function parseAllowlist(content: string): { entries: AllowEntry[]; hygiene: Hygiene[] } {
  const entries: AllowEntry[] = [];
  const hygiene: Hygiene[] = [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let previous: string | undefined;
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.startsWith("#")) return;
    const [key = "", ...rest] = raw.split("\t");
    if (key.trim() === "") {
      hygiene.push({ line, message: "blank entry line; remove it" });
      return;
    }
    if (previous !== undefined && key <= previous) {
      const why = key === previous ? "duplicate entry" : "entry out of byte order";
      hygiene.push({ line, message: `${why} '${key}'; keep the list sorted and unique` });
    }
    previous = key;
    entries.push({ key, justification: rest.join("\t").trim(), line });
  });
  return { entries, hygiene };
}

/** Read the allowlist of the working tree; a missing or unreadable file is a wiring fault. */
export function readAllowlist(): { entries: AllowEntry[]; hygiene: Hygiene[]; text: string } {
  const abs = path.join(repoRoot(), ALLOWLIST);
  if (!existsSync(abs)) throw new WiringError(`${ALLOWLIST} is missing`);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (err) {
    throw new WiringError(`${ALLOWLIST} is unreadable: ${String(err)}`);
  }
  return { ...parseAllowlist(text), text };
}
