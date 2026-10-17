// mask.ts — masking regexes and the Markdown mask of the en-GB -> en-US sweep
// (spec 0262, twin of scripts/lib/en_us_sweep.py; the shared pipeline of spec 0023).
//
// Python `re` -> JavaScript translation table. Every pattern below is compiled
// WITHOUT the `m` and `s` flags and WITH `u` (and `i` only where Python used
// re.IGNORECASE: the detector in rules.ts and the X-token regex).
//
//   Python                       JavaScript here          Why
//   ---------------------------  -----------------------  ---------------------------
//   \w  (str pattern)            [\p{L}\p{N}_]  (PYW)     Python: Unicode alnum + `_`;
//                                                          JS `\w` is ASCII-only.
//   \b  before a word char       (?<![PYW])               JS `\b` is ASCII-only, even
//   \b  after a word char        (?![PYW])                 with `u`; every `\b` in the
//                                                          engine borders a word char.
//   \s  / \S                     [PYWS] / [^PYWS]         Python: str.isspace() set
//                                                          (adds \x1c-\x1f, \x85;
//                                                          JS `\s` adds ﻿ instead).
//   .   (no DOTALL)              [^\n]                    Python excludes only `\n`;
//                                                          JS `.` also excludes CR and the
//                                                          two Unicode line separators.
//   $   (no MULTILINE)           $  or  \n?$              Python `$` also matches
//                                                          before a final `\n`; JS does
//                                                          not, so `\n?$` where the
//                                                          subject may end in `\n`.
//   re.match / re.search         ^-anchored / unanchored  JS has no `match`-at-start.
//   m.start(g) / m.end(g)        `d` flag, m.indices[g]   exact group offsets.
//   re.IGNORECASE                `iu` flags               both use simple case
//                                                          folding (s ~ U+017F, k ~
//                                                          U+212A fold; U+0130 and
//                                                          U+0131 do not fold to i).
//   re.escape(w)                 escapeRegex(w)           JS `u` forbids `\-`.
//   str.splitlines/strip/split   pystr.ts                 different separator sets.
//
// Offsets are UTF-16 code units here and code points in Python; a mask byte is
// set per unit, so the ranges rewrite the same characters (astral chars are
// either wholly inside or wholly outside a range, and never contain `\n`).

import { PYW, PYWS, pyStrip, splitLinesKeep, stripNewlines } from "./pystr.ts";

const W = `[${PYW}]`;
const NW = `(?<!${W})`; // Python `\b` in front of a word character
const NWA = `(?!${W})`; // Python `\b` after a word character
const S = `[${PYWS}]`;
const NS = `[^${PYWS}]`;

export const FENCE_RE = new RegExp(`^(${S}*)(\`\`\`+|~~~+)`, "u");
export const INLINE_CODE_RE = /(`+)(?:[^\n]*?)(\1)/gu;
export const LINK_TARGET_RE = /\]\(([^)]*)\)/dgu;
export const AUTOLINK_RE = /<((?:https?|mailto|ftp):[^>]*)>/gu;
export const HTML_TAG_RE = new RegExp(`</?[a-zA-Z][a-zA-Z0-9-]*(?:${S}[^>]*)?/?>`, "gu");
export const BARE_URL_RE = new RegExp(`${NW}(?:https?|ftp)://[^${PYWS})\\]<>\`]+`, "gu");
export const REF_DEF_RE = new RegExp(`^${S}*\\[[^\\]]+\\]:${S}*${NS}+`, "u");
const TITLE_RE = new RegExp(`"([^"]*)"${S}*$`, "u");
const NEW_KEY_RE = new RegExp(`^${S}*[A-Za-z0-9_.-]+:(${S}|$)`, "u");
const DESC_RE = new RegExp(`^(${S}*)description:${S}*([^\\n]*)\\n?$`, "du");

export const MSG_CALL_RE = new RegExp(
  `(?:^|[;&|(]|${NW}then${NWA}|${NW}do${NWA}|${NW}else${NWA})${S}*` +
    `(echo|printf|report|note_skip|note_pass|note_fail|note_info|note_warn|log|logf|warn|info|die|fail|pass)${NWA}(?!=)${S}`,
  "u",
);
export const DQ_STRING_RE = /"((?:[^"\\]|\\[^\n])*)"/gu;
export const COMPARE_HINT_RE = new RegExp(
  `(==|!=|=~|\\[\\[|grep${S}+-[a-zA-Z]*q|${NW}case${NWA})`,
  "u",
);
export const SHELL_EXPANSION_RE = new RegExp(`(\\$\\{?${W}|\\$\\(|\`)`, "u");

/** Collapse a boolean mask to `[start, end)` ranges. */
export function rangesFromMask(mask: Uint8Array): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < mask.length) {
    if (mask[i]) {
      let j = i;
      while (j < mask.length && mask[j]) j += 1;
      ranges.push([i, j]);
      i = j;
    } else i += 1;
  }
  return ranges;
}

function fill(mask: Uint8Array, a: number, b: number, v: number): void {
  for (let i = a; i < b; i += 1) mask[i] = v;
}

const BLOCK_SCALARS = new Set(["|", ">", "|-", ">-", "|+", ">+"]);

export function markdownMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const lines = splitLinesKeep(text);
  let pos = 0;
  let inFence = false;
  let fenceMarker = "";
  let inFront = false;
  let seenFirst = false;
  let descBlock: number | null = null;
  let descCont: number | null = null;

  for (const line of lines) {
    const start = pos;
    pos += line.length;
    const stripped = stripNewlines(line);

    if (!seenFirst) {
      seenFirst = true;
      if (pyStrip(stripped) === "---") {
        inFront = true;
        continue;
      }
    }
    if (inFront) {
      if (pyStrip(stripped) === "---") {
        inFront = false;
        descBlock = null;
        descCont = null;
        continue;
      }
      const indent = line.length - line.replace(/^ +/, "").length;
      const isNewKey = NEW_KEY_RE.test(line);
      if (descBlock !== null) {
        if (pyStrip(stripped) === "" || indent > descBlock) {
          fill(mask, start, start + stripped.length, 1);
          continue;
        }
        descBlock = null;
      }
      if (descCont !== null) {
        if (!isNewKey && pyStrip(stripped) !== "" && indent > descCont) {
          let b = stripped.length;
          if (b && "\"'".includes(stripped[b - 1] as string)) b -= 1;
          fill(mask, start, start + b, 1);
          continue;
        }
        descCont = null;
      }
      const m = DESC_RE.exec(line);
      if (m) {
        const v = m[2] as string;
        if (BLOCK_SCALARS.has(v)) descBlock = indent;
        else {
          descCont = indent;
          const vstart = start + (m.indices as RegExpIndicesArray)[2]![0];
          let a = 0;
          let b = v.length;
          if (v.length >= 2 && "\"'".includes(v[0] as string) && v[v.length - 1] === v[0]) {
            a = 1;
            b = v.length - 1;
          }
          fill(mask, vstart + a, vstart + b, 1);
        }
      }
      continue;
    }

    const fm = FENCE_RE.exec(line);
    if (fm) {
      const marker = fm[2] as string;
      if (!inFence) {
        inFence = true;
        fenceMarker = (marker[0] as string).repeat(3);
        continue;
      } else if ((marker[0] as string).repeat(3) === fenceMarker) {
        inFence = false;
        continue;
      }
    }
    if (inFence) continue;

    const lm = proseLineMask(stripped);
    for (let k = 0; k < lm.length; k += 1) mask[start + k] = lm[k] as number;
  }
  return mask;
}

function proseLineMask(line: string): Uint8Array {
  const m = new Uint8Array(line.length).fill(1);
  if (REF_DEF_RE.test(line)) {
    m.fill(0);
    const tq = TITLE_RE.exec(line);
    if (tq) fill(m, tq.index + 1, tq.index + 1 + (tq[1] as string).length, 1);
    return m;
  }
  const kill = (rx: RegExp): void => {
    for (const mt of line.matchAll(rx)) fill(m, mt.index, mt.index + mt[0].length, 0);
  };
  kill(INLINE_CODE_RE);
  for (const mt of line.matchAll(LINK_TARGET_RE)) {
    const [a, b] = (mt.indices as RegExpIndicesArray)[1] as [number, number];
    fill(m, a, b, 0);
  }
  kill(AUTOLINK_RE);
  kill(HTML_TAG_RE);
  kill(BARE_URL_RE);
  return m;
}
