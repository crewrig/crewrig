// convert-ci-paths.ts — ONE-SHOT, kept committed as the record of how spec 0283 R3 was applied.
// Do not wire it into CI and do not run it again on a converted reference (it is idempotent: a
// capability that already carries a capability-level `paths:` is left alone).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/convert-ci-paths.ts [file]
//   file defaults to ci/ci-capabilities.yml; the file is edited in place.
//
// Rewrite (a TEXT edit: every comment and the order of the file are preserved, the YAML is never
// re-serialised; the existing readers only DECIDE, lines are edited):
//   - a capability whose pull-request and push triggers declare the SAME `paths:` list gets one
//     capability-level `paths:` (text of the pull-request list, placed after the trigger list)
//     and loses both trigger-level lists;
//   - a capability whose two lists differ keeps its trigger-level lists and is reported;
//   - `cache.files` is removed only when it equals the effective capability paths (the default
//     of spec 0283 R3 then yields the same list).

import fs from "node:fs";

import { readCapabilities } from "./lib/ci-parity/reference-read.ts";
import { parse } from "./lib/yq-accessors/index.ts";

const indentOf = (l: string): number => l.length - l.trimStart().length;
const blank = (l: string): boolean => l.trim() === "" || l.trimStart().startsWith("#");

/** End (exclusive) of the block opened at `start`: the next content line indented <= `base`. */
function blockEnd(lines: string[], start: number, base: number, limit: number): number {
  let i = start + 1;
  let last = start;
  for (; i < limit; i++) {
    const l = lines[i] as string;
    if (l.trim() === "") continue;
    if (indentOf(l) <= base && !l.trimStart().startsWith("#")) break;
    last = i;
  }
  return last + 1;
}

const same = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export interface Outcome {
  text: string;
  converted: string[];
  differing: string[];
  cacheDropped: string[];
}

export function convert(text: string): Outcome {
  const caps = readCapabilities(parse(text));
  const lines = text.split("\n");
  const starts = lines.flatMap((l, i) => (/^ {2}- id: /.test(l) ? [i] : []));
  const out: Outcome = { text, converted: [], differing: [], cacheDropped: [] };
  if (starts.length !== caps.length) throw new Error("capability count mismatch with the readers");
  // Edit bottom-up so earlier indexes stay valid.
  for (let n = caps.length - 1; n >= 0; n--) {
    const c = caps[n]!;
    const from = starts[n]!;
    const to = starts[n + 1] ?? lines.length;
    const pr = c.triggers.filter((t) => t.kind === "pull-request");
    const pu = c.triggers.filter((t) => t.kind === "push");
    if (c.capPathsTag !== "" && c.capPathsTag !== "!!null") continue;
    if (pr.length !== 1 || pu.length !== 1) {
      if (c.triggers.some((t) => t.paths.length > 0)) out.differing.push(c.id);
      continue;
    }
    const lp = pr[0]!.paths;
    if (lp.length === 0 && pu[0]!.paths.length === 0) continue;
    if (!same(lp, pu[0]!.paths)) {
      out.differing.push(c.id);
      continue;
    }
    // Locate the two trigger-level `paths:` blocks.
    const trig = lines.findIndex((l, i) => i >= from && i < to && l === "    trigger:");
    const trigEnd = blockEnd(lines, trig, 4, to);
    const blocks: [number, number][] = [];
    for (let i = trig + 1; i < trigEnd; i++) {
      if (lines[i] === "        paths:") {
        const e = blockEnd(lines, i, 8, trigEnd);
        blocks.push([i, e]);
        i = e - 1;
      } else if (/^ {8}paths:/.test(lines[i] as string)) {
        throw new Error(`capability '${c.id}': non-block trigger paths`);
      }
    }
    if (blocks.length !== 2) throw new Error(`capability '${c.id}': expected 2 paths blocks`);
    const [b1, b2] = blocks as [[number, number], [number, number]];
    const moved = lines.slice(b1[0], b1[1]).map((l) => (l === "" ? l : l.slice(4)));
    // Optional cache.files drop, decided by the effective-equality rule.
    let cacheBlock: [number, number] | null = null;
    if (c.cacheFiles.length > 0 && same(c.cacheFiles, lp)) {
      const ci = lines.findIndex((l, i) => i >= from && i < to && l === "    cache:");
      const ce = blockEnd(lines, ci, 4, to);
      for (let i = ci + 1; i < ce; i++)
        if (lines[i] === "      files:") cacheBlock = [i, blockEnd(lines, i, 6, ce)];
      if (cacheBlock !== null) out.cacheDropped.push(c.id);
    }
    // Insert point: after the trigger list, before trailing blank/comment lines.
    let ins = trigEnd;
    while (ins > trig + 1 && blank(lines[ins - 1] as string)) ins--;
    // Remove bottom-up: cache block, second trigger block, first trigger block, then insert.
    if (cacheBlock !== null) lines.splice(cacheBlock[0], cacheBlock[1] - cacheBlock[0]);
    lines.splice(b2[0], b2[1] - b2[0]);
    lines.splice(b1[0], b1[1] - b1[0]);
    const removed = b1[1] - b1[0] + (b2[1] - b2[0]);
    lines.splice(ins - removed, 0, ...moved);
    out.converted.push(c.id);
  }
  out.text = lines.join("\n");
  return out;
}

if (import.meta.main) {
  const file = process.argv[2] ?? "ci/ci-capabilities.yml";
  const r = convert(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, r.text);
  console.log(`converted ${r.converted.length} capabilities`);
  console.log(`cache.files dropped (equal to the paths): ${r.cacheDropped.join(", ") || "none"}`);
  console.log(`trigger-level lists kept (differ): ${r.differing.join(", ") || "none"}`);
}
