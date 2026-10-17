// rules.ts — the shared sweep/detect pipeline of the en-GB -> en-US orthographic
// sweep (spec 0023, twin of scripts/lib/en_us_sweep.py): dispatch by file type,
// the X out-of-reach allowlist, the substitution and detector regexes, and the
// loaders for the two data files. Regex translations: see the header of mask.ts.

import path from "node:path";

import { hashCommentMask, pythonMask } from "./comments.ts";
import { markdownMask, rangesFromMask } from "./mask.ts";
import {
  PYW,
  escapeRegex,
  fileLines,
  pyRepr,
  pySplit,
  pyStrip,
  readText,
  splitLinesKeep,
} from "./pystr.ts";

const X_DOC_TOKEN_FILES = new Set([
  "tests/e2e/lib/assert.sh",
  "tests/e2e/lib/llm_judge.sh",
  "tests/e2e/lib/structural.sh",
]);

const X_SAMPLE_PAYLOAD: Record<string, string[]> = {
  "docs/research/artifacts/147/trace-gemini-p.sh": ["${1:-what colour"],
};

/** Raised where the Python engine does `raise SystemExit(<message>)`. */
export class EngineExit extends Error {}

export type Range = [number, number];
export interface Substitutions {
  rx: RegExp;
  pairs: Map<string, string>;
}

function capitalize(s: string): string {
  return s === "" ? s : (s[0] as string).toUpperCase() + s.slice(1).toLowerCase();
}

export function buildSubstitutions(mapping: Array<[string, string]>): Substitutions {
  const pairs = new Map<string, string>();
  for (const [british, american] of mapping) {
    const variants: Array<[string, string]> = [
      [british.toLowerCase(), american.toLowerCase()],
      [capitalize(british), capitalize(american)],
      [british.toUpperCase(), american.toUpperCase()],
    ];
    for (const [pat, repl] of variants) if (!pairs.has(pat)) pairs.set(pat, repl);
  }
  const words = [...pairs.keys()].sort((a, b) => b.length - a.length);
  const alt = words.map(escapeRegex).join("|");
  return { rx: new RegExp(`(?<![${PYW}])(${alt})(?![${PYW}])`, "gu"), pairs };
}

export function buildDetector(words: string[]): RegExp {
  const variants = new Set(words.map((w) => w.toLowerCase()));
  const alt = [...variants]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  return new RegExp(`(?<![${PYW}])(${alt})(?![${PYW}])`, "giu");
}

/** Repo-relative form of `file`, stripping any `.worktrees/<ticket>/` prefix. */
function relPath(file: string): string {
  const p = path.resolve(file);
  const marker = "/.worktrees/";
  if (p.includes(marker)) {
    const tail = p.slice(p.indexOf(marker) + marker.length);
    const slash = tail.indexOf("/");
    if (slash !== -1) return tail.slice(slash + 1);
  }
  return path.relative(process.cwd(), p);
}

function killWordOnMatchingLines(
  text: string,
  mask: Uint8Array,
  linePred: (line: string) => boolean,
  word: string | null,
): void {
  let pos = 0;
  const wordRx =
    word === null ? null : new RegExp(`(?<![${PYW}-])${escapeRegex(word)}s?(?![${PYW}-])`, "giu");
  for (const line of splitLinesKeep(text)) {
    const start = pos;
    pos += line.length;
    if (!linePred(line)) continue;
    if (wordRx === null) mask.fill(0, start, start + line.length);
    else
      for (const mt of line.matchAll(wordRx))
        mask.fill(0, start + mt.index, start + mt.index + mt[0].length);
  }
}

function subtractX(rel: string, text: string, mask: Uint8Array): void {
  if (X_DOC_TOKEN_FILES.has(rel)) {
    killWordOnMatchingLines(
      text,
      mask,
      (ln) => ln.toLowerCase().includes("usage:") || ln.toLowerCase().includes("<artefact>"),
      "artefact",
    );
  }
  for (const [xpath, needles] of Object.entries(X_SAMPLE_PAYLOAD)) {
    if (rel === xpath)
      killWordOnMatchingLines(text, mask, (ln) => needles.some((s) => ln.includes(s)), null);
  }
}

/** THE shared pipeline: the sweepable ranges S of a file, X subtracted. */
export function sweepableRanges(file: string, text: string): Range[] {
  const rel = relPath(file);
  const lower = file.toLowerCase();
  let mask: Uint8Array;
  if (/(\.md|\.md\.template|\.markdown)$/.test(lower)) mask = markdownMask(text);
  else if (lower.endsWith(".py")) mask = pythonMask(text);
  else if (lower.endsWith(".sh") || lower.endsWith(".bash")) mask = hashCommentMask(text, true);
  else if (/(\.yml|\.yaml|\.toml|\.toml\.template)$/.test(lower))
    mask = hashCommentMask(text, false);
  else mask = new Uint8Array(text.length);
  subtractX(rel, text, mask);
  return rangesFromMask(mask);
}

export function applyMap(
  file: string,
  text: string,
  subs: Substitutions,
): { text: string; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const out: string[] = [];
  let last = 0;
  for (const [a, b] of sweepableRanges(file, text)) {
    out.push(text.slice(last, a));
    out.push(
      text.slice(a, b).replace(subs.rx, (src) => {
        counts.set(src, (counts.get(src) ?? 0) + 1);
        return subs.pairs.get(src) as string;
      }),
    );
    last = b;
  }
  out.push(text.slice(last));
  return { text: out.join(""), counts };
}

export function detect(file: string, text: string, rx: RegExp): Array<[number, string]> {
  const hits: Array<[number, string]> = [];
  for (const [a, b] of sweepableRanges(file, text)) {
    for (const mt of text.slice(a, b).matchAll(rx)) {
      const off = a + mt.index;
      let lineno = 1;
      for (let i = text.indexOf("\n"); i !== -1 && i < off; i = text.indexOf("\n", i + 1))
        lineno += 1;
      hits.push([lineno, mt[0]]);
    }
  }
  return hits;
}

export function loadMap(file: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of fileLines(readText(file))) {
    const s = pyStrip(line);
    if (s === "" || s.startsWith("#")) continue;
    const parts = pySplit(s);
    if (parts.length !== 2) throw new EngineExit(`malformed map line: ${pyRepr(line)}`);
    pairs.push([parts[0] as string, parts[1] as string]);
  }
  return pairs;
}

export function loadWords(file: string): string[] {
  const words: string[] = [];
  for (const line of fileLines(readText(file))) {
    const s = pyStrip(line);
    if (s === "" || s.startsWith("#")) continue;
    words.push(s);
  }
  return words;
}
