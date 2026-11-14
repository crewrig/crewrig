// evidence.ts — the evidence rule of the judge (spec 0290 R13 as modified by delta-01).
//
// The judge answers each expectation with a line `<n> VERDICT=<word> EVIDENCE=<JSON string>`.
// An expectation is `passed: true` only when the verdict is PASS and the evidence is valid:
// at least 12 non-whitespace characters and either matches the run's transcript.md or a file the
// run produced under spec 0290 R49 (delta-05), or is a `path:line` reference naming a produced
// file and an existing line of it. Anything else is an unsupported PASS. R49, in order:
//   1. exact substring (line endings normalised);
//   2. normalised match: NFKC, letters and digits only, ellipsis pieces (each at least 12 letters
//      and digits) found whole-word and in order;
//   3. the longest verbatim word run of the evidence holds at least EVIDENCE_WINDOW_CHARS letters
//      and digits and at least EVIDENCE_WINDOW_SHARE of the evidence's letters and digits.
// The result names the rule that accepted the evidence (spec 0290 R50): `exact`, `normalised`,
// `window` (with the share of the evidence the longest verbatim run covers), `path_line` or
// `short_line`. The rules only widen acceptance. Rule 3 proves the quote is grounded in real
// output, not that it entails the expectation.
//
// Spec 0304 R15: evidence that begins with a `path:line` token (a path, a colon, a decimal line
// number, then whitespace or the end) is a `path_line` reference when the path names a produced
// file, the line exists and the token itself reaches EVIDENCE_MIN_CHARS non-whitespace characters;
// what follows is commentary, unchecked and not counted. R16: evidence of 6 to 11 non-whitespace
// characters is a `short_line` when, trimmed, it equals one whole trimmed line of exactly one
// produced file; the transcript never serves as the source of a short line.
//
// Usage: validateEvidence(evidence, { transcript, files }) -> { ok } | { ok: false, reason }
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import type { GradedExpectation } from "./grade.ts";
import {
  EVIDENCE_MIN_CHARS,
  EVIDENCE_SHORT_MIN_CHARS,
  EVIDENCE_WINDOW_CHARS,
  EVIDENCE_WINDOW_SHARE,
} from "./settings.ts";

export interface ProducedFile {
  /** Path relative to the run's outputs/ directory, `/` separators. */
  readonly rel: string;
  readonly content: string;
}

export interface EvidenceMaterial {
  readonly transcript: string;
  readonly files: readonly ProducedFile[];
}

const norm = (s: string) => s.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

/**
 * The `EVIDENCE=<JSON string>` (or `EVIDENCE: ...`) value of a judge answer; undefined when there
 * is none. The first JSON string literal wins and trailing text is ignored; without a quoted
 * literal the trimmed remainder is returned.
 */
export function parseEvidence(text: string): string | undefined {
  const m = /^[ \t]*[*_`]*EVIDENCE[*_`]*[ \t]*[=:](.*)$/im.exec(text);
  if (m === null) return undefined;
  const rest = (m[1] ?? "").trim();
  const lit = /"(?:[^"\\]|\\.)*"/.exec(rest);
  if (lit !== null) {
    const escapeControls = (t: string) =>
      // eslint-disable-next-line no-control-regex
      t.replace(/[\u0000-\u001f]/g, (c) => JSON.stringify(c).slice(1, -1));
    for (const candidate of [lit[0], escapeControls(lit[0])]) {
      try {
        const v: unknown = JSON.parse(candidate);
        if (typeof v === "string") return v;
      } catch {
        // not a valid JSON string: try the next candidate
      }
    }
    return lit[0].slice(1, -1);
  }
  return rest === "" ? undefined : rest;
}

/** Words of a text: maximal runs of Unicode letters and digits, after NFKC normalisation. */
const words = (s: string): string[] => s.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
const alnum = (ws: readonly string[]): number => ws.reduce((n, w) => n + [...w].length, 0);

/** The ellipsis markers a judge uses to elide text inside a quote. */
const ELLIPSIS = /\[(?:\.{3}|…)\]|\.{3}|…/;

/** A word stream wrapped in single spaces, so that a whole-word run is a plain substring. */
const padded = (ws: readonly string[]): string => ` ${ws.join(" ")} `;

/** R49 rule 2: every ellipsis piece occurs whole-word in the material, in order, without overlap. */
function matchNormalised(evidence: string, haystack: string): boolean {
  const pieces = evidence
    .split(ELLIPSIS)
    .map(words)
    .filter((w) => w.length > 0);
  if (pieces.length === 0) return false;
  let from = 0;
  for (const piece of pieces) {
    if (alnum(piece) < EVIDENCE_MIN_CHARS) return false;
    const needle = ` ${piece.join(" ")} `;
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    from = at + needle.length - 1;
  }
  return true;
}

/** R49 rule 3: the share of the evidence covered by its longest verbatim word run, when both floors hold. */
function matchWindow(evidence: string, haystack: string): number | undefined {
  const e = words(evidence);
  const total = alnum(e);
  if (total === 0) return undefined;
  let bestStart = 0;
  let bestLen = 0;
  for (let i = 0; i + bestLen < e.length; i++) {
    // only a run longer than the best so far matters: test one word beyond it first
    if (!haystack.includes(padded(e.slice(i, i + bestLen + 1)))) continue;
    let j = i + bestLen + 1;
    while (j < e.length && haystack.includes(padded(e.slice(i, j + 1)))) j++;
    bestStart = i;
    bestLen = j - i;
  }
  const run = alnum(e.slice(bestStart, bestStart + bestLen));
  return run >= EVIDENCE_WINDOW_CHARS && run >= EVIDENCE_WINDOW_SHARE * total
    ? run / total
    : undefined;
}

/** The rule that accepted a piece of evidence (spec 0290 R50). */
export type EvidenceMatch =
  | { readonly rule: "exact" | "normalised" | "path_line" | "short_line" }
  | { readonly rule: "window"; readonly share: number };

export type EvidenceVerdict =
  | ({ readonly ok: true } & EvidenceMatch)
  | { readonly ok: false; readonly reason: string };

/** R15: the evidence starts with a `path:line` of a produced file, the token reaching the floor. */
function matchPathLine(evidence: string, material: EvidenceMaterial): boolean {
  const trimmed = evidence.trim();
  // a bare reference keeps its former reading (the path may hold spaces); else the first word is the token
  for (const re of [/^(.+):(\d+)$/, /^(\S+):(\d+)(?=\s)/]) {
    const ref = re.exec(trimmed);
    if (ref === null || (ref[0] ?? "").replace(/\s/g, "").length < EVIDENCE_MIN_CHARS) continue;
    const rel = (ref[1] ?? "").replace(/^(?:\.\/|\/)?(?:outputs\/)?/, "");
    const line = Number(ref[2]);
    const file = material.files.find((f) => f.rel === rel);
    if (file !== undefined && line >= 1 && line <= norm(file.content).split("\n").length)
      return true;
  }
  return false;
}

/** R16: the evidence equals one whole trimmed line of exactly one produced file. */
function matchShortLine(evidence: string, material: EvidenceMaterial): boolean {
  const want = evidence.trim();
  const holders = material.files.filter((f) =>
    norm(f.content)
      .split("\n")
      .some((l) => l.trim() === want),
  );
  return holders.length === 1;
}

export function validateEvidence(
  evidence: string | undefined,
  material: EvidenceMaterial,
): EvidenceVerdict {
  if (evidence === undefined || evidence.trim() === "")
    return { ok: false, reason: "no evidence was given" };
  const nonWs = evidence.replace(/\s/g, "").length;
  if (nonWs < EVIDENCE_SHORT_MIN_CHARS)
    return {
      ok: false,
      reason: `evidence has fewer than ${EVIDENCE_MIN_CHARS} non-whitespace characters`,
    };
  if (nonWs < EVIDENCE_MIN_CHARS)
    return matchShortLine(evidence, material)
      ? { ok: true, rule: "short_line" }
      : {
          ok: false,
          reason: `evidence has fewer than ${EVIDENCE_MIN_CHARS} non-whitespace characters and is not a whole line of exactly one produced file`,
        };
  const needle = norm(evidence);
  if (norm(material.transcript).includes(needle)) return { ok: true, rule: "exact" };
  for (const f of material.files)
    if (norm(f.content).includes(needle)) return { ok: true, rule: "exact" };
  const haystacks = [material.transcript, ...material.files.map((f) => f.content)].map((t) =>
    padded(words(t)),
  );
  if (haystacks.some((h) => matchNormalised(evidence, h))) return { ok: true, rule: "normalised" };
  const shares = haystacks.flatMap((h) => matchWindow(evidence, h) ?? []);
  if (shares.length > 0) return { ok: true, rule: "window", share: Math.max(...shares) };
  if (matchPathLine(evidence, material)) return { ok: true, rule: "path_line" };
  return {
    ok: false,
    reason:
      "evidence occurs in neither the transcript nor a produced file, and is not a path:line of a produced file",
  };
}

/** A judge PASS whose evidence is valid, as a graded entry (R50: the rule that accepted it is recorded). */
export function acceptedEntry(
  text: string,
  evidence: string,
  v: Extract<EvidenceVerdict, { ok: true }>,
): GradedExpectation {
  return {
    text,
    passed: true,
    evidence,
    evidence_match: v.rule,
    ...(v.rule === "window" ? { window_share: Math.round(v.share * 100) / 100 } : {}),
  };
}

/** Read the text files a run produced under `outputsDir` (bounded), for the judge and the evidence rule. */
export function readProducedFiles(outputsDir: string, maxBytes = 1_000_000): ProducedFile[] {
  const out: ProducedFile[] = [];
  const walk = (dir: string) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && fs.statSync(abs).size <= maxBytes)
        out.push({
          rel: path.relative(outputsDir, abs).split(path.sep).join("/"),
          content: fs.readFileSync(abs, "utf8"),
        });
    }
  };
  walk(outputsDir);
  return out;
}
