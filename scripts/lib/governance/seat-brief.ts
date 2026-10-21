// seat-brief.ts — seated-pass brief form linter (spec 0276 R1-R6).
//
// Usage: evaluateSeatBrief(text) / evaluateSeatBriefOfFile(path) / evaluateStdin() / template(surface)
//   -> { code, stdout, stderr }. runSeatBrief(argv) wraps argument handling for the entry script.
// A brief is `key: value` lines (blank lines allowed). Each value is exactly one reference
// matching its key's pattern. This checks FORM only (ADR-0020 option d): a conforming brief
// is necessary, not sufficient; the orchestrator stays responsible for intent.
// Exit codes: 0 conforming, 1 breach, 2 unreadable input or usage error.
// Author-side tool: CI proves it against committed fixtures only (spec 0276 R11).

import { readFileSync, statSync } from "node:fs";

export type Surface = "specs" | "plan" | "review";
export const SURFACES: readonly Surface[] = ["specs", "plan", "review"];

export interface SeatBriefOutcome {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

export const MAX_VALUE_LENGTH = 200;

/** Rule identifiers printed after `BREACH `. */
export type Rule =
  | "unknown-key"
  | "missing-key"
  | "duplicate-key"
  | "value-length"
  | "value-pattern"
  | "non-kv-line"
  | "diff-content"
  | "vocabulary";

const LOCATION = /^(https:\/\/\S+|issue #\d+|PR #\d+|issuecomment-\d+)$/;
const PATTERNS: Record<string, RegExp> = {
  seat: /^(specs|plan|review)\/\d+(#\d+)?$/,
  artifact: /^(PR #\d+|issue #\d+|https:\/\/\S+|(?!\/)(?!https?:)[\w.@/-]+)$/,
  examined: /^([0-9a-f]{7,40}|v\d+|reconstruct from the dossier|none)$/,
  "prior-verdicts": /^(none|https:\/\/\S+|issue #\d+|PR #\d+|issuecomment-\d+)$/,
  disposition: /^(none|https:\/\/\S+|issue #\d+|PR #\d+|issuecomment-\d+)$/,
  ledger: /^(none|https:\/\/\S+|issue #\d+|PR #\d+|issuecomment-\d+)$/,
  "time-budget": /^\d+ minutes$/,
  home: /^\/\S*$/,
  "diary-agent-name": /^[A-Za-z][\w.-]*$/,
  "pass-scope": /^full \(owner request\)$/,
};
const REQUIRED = ["seat", "artifact", "examined", "prior-verdicts", "disposition"] as const;
const PLAN_TRACEABILITY = "plan finding traceability table";

const VOCABULARY = [
  "check in particular",
  "focus on",
  "pay attention",
  "background",
  "summary",
  "summarise",
  "summarize",
  "supersede",
  "superseded by",
  "this pr implements",
  "the delta",
  "rationale",
  "assessment",
  "note that",
  "in particular",
];
const VOCAB_RE = new RegExp(`\\b(${VOCABULARY.join("|")})\\b`, "i");

const KV = /^([a-z][a-z-]*): (\S.*)$/;
const DIFF_MARKER = /^(diff --git|@@|\+\+\+|---)/;
const FENCE = /^\s*```/;

const excerpt = (s: string): string => (s.length > 80 ? `${s.slice(0, 77)}...` : s);

function valueMatches(key: string, value: string, surface: string | undefined): boolean {
  const re = PATTERNS[key];
  if (re === undefined) return false;
  if (re.test(value)) return true;
  return key === "disposition" && surface === "plan" && value === PLAN_TRACEABILITY;
}

export function evaluateSeatBrief(text: string): SeatBriefOutcome {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const breaches: { line: number; rule: Rule; text: string }[] = [];
  const seen = new Set<string>();
  const add = (line: number, rule: Rule, t: string): void => {
    const id = `${line}:${rule}:${rule === "missing-key" ? t : ""}`;
    if (seen.has(id)) return;
    seen.add(id);
    breaches.push({ line, rule, text: excerpt(t) });
  };

  const keys = new Set<string>();
  let seatValue: string | undefined;
  let surface: string | undefined;
  const pending: { n: number; key: string; value: string; raw: string }[] = [];
  let inFence = false;

  lines.forEach((rawLine, i) => {
    const n = i + 1;
    const line = rawLine.replace(/\s+$/, "");
    if (inFence) {
      if (FENCE.test(line)) inFence = false;
      return;
    }
    if (FENCE.test(line)) {
      add(n, "diff-content", line);
      inFence = true;
      return;
    }
    if (line === "") return;
    if (DIFF_MARKER.test(line)) {
      add(n, "diff-content", line);
      return;
    }
    const m = KV.exec(line);
    if (m === null) {
      add(n, "non-kv-line", line);
      if (VOCAB_RE.test(line)) add(n, "vocabulary", line);
      return;
    }
    const key = m[1] as string;
    const value = (m[2] as string).trim();
    if (!(key in PATTERNS)) {
      add(n, "unknown-key", line);
      if (VOCAB_RE.test(line)) add(n, "vocabulary", line);
      return;
    }
    if (keys.has(key)) add(n, "duplicate-key", line);
    else keys.add(key);
    if (key === "seat" && seatValue === undefined && PATTERNS["seat"]?.test(value)) {
      seatValue = value;
      surface = value.split("/")[0];
    }
    pending.push({ n, key, value, raw: line });
  });

  for (const p of pending) {
    if (p.value.length > MAX_VALUE_LENGTH) {
      add(p.n, "value-length", p.raw);
      continue;
    }
    if (!valueMatches(p.key, p.value, surface)) {
      add(p.n, "value-pattern", p.raw);
      if (VOCAB_RE.test(p.raw)) add(p.n, "vocabulary", p.raw);
    }
  }
  for (const key of REQUIRED) if (!keys.has(key)) add(0, "missing-key", key);

  if (breaches.length === 0) return { code: 0, stdout: `OK: seat ${seatValue}\n`, stderr: "" };
  breaches.sort((a, b) => a.line - b.line);
  const out = breaches.map((b) => `BREACH ${b.rule}: line ${b.line}: ${b.text}`);
  return { code: 1, stdout: "", stderr: `${out.join("\n")}\n` };
}

function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "EISDIR") return "Is a directory";
  return err instanceof Error ? err.message : String(err);
}

export function evaluateSeatBriefOfFile(file: string): SeatBriefOutcome {
  let text: string;
  try {
    if (statSync(file).isDirectory())
      throw Object.assign(new Error("Is a directory"), { code: "EISDIR" });
    text = readFileSync(file, "utf8");
  } catch (err) {
    return { code: 2, stdout: "", stderr: `Error: ${file}: ${reason(err)}\n` };
  }
  return evaluateSeatBrief(text);
}

export function evaluateStdin(): SeatBriefOutcome {
  try {
    return evaluateSeatBrief(readFileSync(0, "utf8"));
  } catch (err) {
    return { code: 2, stdout: "", stderr: `Error: stdin: ${reason(err)}\n` };
  }
}

/** Canonical skeleton for a surface (spec 0276 R2). Each placeholder line names the kind of its value. */
export function template(surface: Surface): string {
  const disposition =
    surface === "plan"
      ? "<location, or none on pass 1, or the literal: plan finding traceability table>"
      : "<location, or none on pass 1>";
  return [
    `seat: ${surface}/<ticket number, optionally #<generation>>`,
    "artifact: <PR #N, issue #N, repo-relative path, or forge URL>",
    "examined: <7-40 hex sha, plan ordinal like v2, reconstruct from the dossier, or none on pass 1>",
    "prior-verdicts: <location (forge URL, issue #N, PR #N, issuecomment-<id>), or none on pass 1>",
    `disposition: ${disposition}`,
    "ledger: <location, or none>",
    "",
  ].join("\n");
}

const USAGE = "Usage: check-seat-brief.ts [path|-] | --template <specs|plan|review>\n";

export function runSeatBrief(argv: readonly string[]): SeatBriefOutcome {
  const usage = (msg: string): SeatBriefOutcome => ({
    code: 2,
    stdout: "",
    stderr: `Error: ${msg}\n${USAGE}`,
  });
  const first = argv[0];
  if (first === "--template") {
    const name = argv[1];
    if (argv.length !== 2 || name === undefined) return usage("--template takes one surface");
    if (!(SURFACES as readonly string[]).includes(name))
      return usage(`unknown template surface: ${name}`);
    return { code: 0, stdout: template(name as Surface), stderr: "" };
  }
  if (first !== undefined && first !== "-" && first.startsWith("-"))
    return usage(`unknown option: ${first}`);
  if (argv.length > 1) return usage("too many arguments");
  return first === undefined || first === "-" ? evaluateStdin() : evaluateSeatBriefOfFile(first);
}
