// plan-review-gate.ts — conditional cold plan review decision (spec 0277 R1-R11).
//
// Usage: runPlanReview(argv, io?) -> { code, stdout, stderr }. resolveComponent(path, manifestText)
//   maps a repo path to a component; extractPathTokens(text) lists the backticked repo paths.
// Decision order, fail closed: usage/unreadable (exit 2) -> tier -> large -> small/trivial
// not-applicable -> --prior-review -> manifests -> plan structure -> threshold and shared hit.
// `skipped` only when every check passed; any ambiguity yields `required` with a named cause.
// Exit codes: 0 for every decision, 2 unreadable input or usage error.
// Author-side tool: CI proves it against committed fixtures only (spec 0277 R20).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Decision = "required" | "skipped" | "not-applicable";

export interface PlanReviewOutcome {
  code: 0 | 2;
  stdout: string;
  stderr: string;
}

/** Manifest FILE PATHS and stdin reader; defaults are the live `.crewrig/` files and fd 0. */
export interface PlanReviewIo {
  stdin?: () => string;
  componentsManifest?: string;
  sharedManifest?: string;
}

/** A standard plan skips the review only with at most this many components (spec 0277 R4). */
export const COMPONENT_THRESHOLD = 3;

/** One backticked span without whitespace; the capture group is the candidate token (R6). */
export const PATH_TOKEN_REGEX = /`([^`\s]+)`/;
const PATH_EXTENSIONS = [".md", ".ts", ".js", ".yml", ".yaml", ".json", ".txt", ".sh"];

/** Predicate (i)+(ii) of R6 on a raw token: path-like and not a URL. */
export function isPathToken(token: string): boolean {
  if (token.startsWith("http://") || token.startsWith("https://")) return false;
  return token.includes("/") || PATH_EXTENSIONS.some((e) => token.endsWith(e));
}

/** Unique path tokens in document order, leading `./` stripped. */
export function extractPathTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(PATH_TOKEN_REGEX.source, "g"))) {
    const raw = m[1] as string;
    if (!isPathToken(raw)) continue;
    const token = raw.replace(/^\.\//, "");
    if (token === "" || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

interface ComponentEntry {
  re: RegExp;
  literal: number;
  component: string;
}

/** Non-comment, non-blank manifest lines, trimmed. */
function manifestLines(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

function parseComponents(text: string): ComponentEntry[] | { malformed: string } {
  const entries: ComponentEntry[] = [];
  for (const line of manifestLines(text)) {
    const parts = line.split(/\s+/);
    const [prefix, component] = parts;
    if (parts.length !== 2 || prefix === undefined || component === undefined) {
      return { malformed: line };
    }
    const stars = (component.match(/\*/g) ?? []).length;
    if (stars > 1 || (stars === 1 && !prefix.includes("*"))) return { malformed: line };
    const re = new RegExp(`^${prefix.split("*").map(escapeRe).join("([^/]+)")}`);
    entries.push({ re, literal: prefix.replace(/\*/g, "").length, component });
  }
  return entries;
}

/** Component of a path per R7: longest literal prefix, first line on a tie, else first segment. */
export function resolveComponent(path: string, manifestText: string): string {
  const entries = parseComponents(manifestText);
  if (!Array.isArray(entries)) throw new Error(`malformed manifest line: ${entries.malformed}`);
  let best: { literal: number; name: string } | undefined;
  for (const e of entries) {
    const m = e.re.exec(path);
    if (m === null) continue;
    if (best !== undefined && e.literal <= best.literal) continue;
    best = { literal: e.literal, name: e.component.replace("*", m[1] ?? "") };
  }
  return best?.name ?? (path.split("/")[0] as string);
}

/** Shared-contract entries hit by `tokens`, as the matched tokens (sorted, unique). */
function sharedHits(tokens: readonly string[], entries: readonly string[]): string[] {
  const hits = new Set<string>();
  const globs = entries.map((e) => ({
    entry: e,
    re: new RegExp(
      `^${escapeRe(e)
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, ".*")}$`,
    ),
  }));
  for (const t of tokens) {
    for (const { entry, re } of globs) {
      if (
        t === entry ||
        (entry.endsWith("/") && t.startsWith(entry)) ||
        re.test(t) ||
        (t.endsWith("/") && entry.startsWith(t))
      ) {
        hits.add(t);
      }
    }
  }
  return [...hits].sort();
}

function section(text: string, heading: RegExp, level: "## " | "### "): string | undefined {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith(level) || (level === "### " && l.startsWith("## "))) break;
    body.push(l);
  }
  return body.join("\n");
}

function tierOf(spec: string): string | undefined {
  const m = /^---\n([\s\S]*?)\n---/.exec(spec.replace(/^﻿/, "").replace(/\r\n?/g, "\n"));
  if (m === null) return undefined;
  const line = /^complexity:\s*["']?([^"'\s#]+)["']?\s*(#.*)?$/m.exec(m[1] as string);
  return line?.[1];
}

const liveManifest = (name: string): string =>
  fileURLToPath(new URL(`../../../.crewrig/${name}`, import.meta.url));

function answer(decision: Decision, reasons: string[]): PlanReviewOutcome {
  const lines = [`plan-review: ${decision}`, ...reasons.map((r) => `reason: ${r}`)];
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

const failClosed = (cause: string): PlanReviewOutcome =>
  answer("required", [`fail-closed: ${cause}`]);
const usage = (msg: string): PlanReviewOutcome => ({ code: 2, stdout: "", stderr: msg });

export function runPlanReview(argv: readonly string[], io: PlanReviewIo = {}): PlanReviewOutcome {
  const flags = argv.filter((a) => a.startsWith("--"));
  const pos = argv.filter((a) => !a.startsWith("--") || a === "-");
  const bad = flags.find((f) => f !== "--prior-review");
  if (bad !== undefined) return usage(`unknown option: ${bad}`);
  if (pos.length < 1 || pos.length > 2) {
    return usage("usage: check-plan-review.ts <spec-path> [<plan-path>|-] [--prior-review]");
  }
  const specPath = pos[0] as string;
  const planPath = pos[1];
  let spec: string;
  let plan: string;
  try {
    spec = readFileSync(specPath, "utf8");
  } catch {
    return usage(`unreadable spec: ${specPath}`);
  }
  try {
    plan =
      planPath === undefined || planPath === "-"
        ? (io.stdin ?? (() => readFileSync(0, "utf8")))()
        : readFileSync(planPath, "utf8");
  } catch {
    return usage(`unreadable plan: ${planPath ?? "-"}`);
  }

  const tier = tierOf(spec);
  if (tier === undefined || !["trivial", "small", "standard", "large"].includes(tier)) {
    return failClosed("unknown-tier");
  }
  if (tier === "large") return answer("required", ["tier=large (always reviewed)"]);
  if (tier !== "standard") return answer("not-applicable", [`tier=${tier} (not applicable)`]);
  if (flags.includes("--prior-review")) {
    return answer("required", ["prior-review (review stays mandatory)"]);
  }

  let compText: string;
  let sharedText: string;
  try {
    compText = readFileSync(io.componentsManifest ?? liveManifest("plan-components.txt"), "utf8");
    sharedText = readFileSync(
      io.sharedManifest ?? liveManifest("shared-contract-paths.txt"),
      "utf8",
    );
  } catch {
    return failClosed("manifest-missing");
  }
  if (manifestLines(compText).length === 0 || manifestLines(sharedText).length === 0) {
    return failClosed("manifest-empty");
  }
  if (!Array.isArray(parseComponents(compText))) return failClosed("manifest-malformed");

  const blast = section(plan, /^###\s+Blast radius\s*$/i, "### ");
  const compLine = blast === undefined ? null : /^\s*[-*]\s+Components:[ \t]*(.*)$/m.exec(blast);
  if (compLine === null) return failClosed("missing-components-line");
  const declared = new Set(
    (compLine[1] as string)
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== ""),
  );
  if (declared.size === 0) return failClosed("empty-components-list");
  const steps = section(plan, /^###\s+Steps\s*$/i, "### ");
  if (steps === undefined) return failClosed("missing-steps");
  const stepPaths = extractPathTokens(steps);
  if (stepPaths.length === 0) return failClosed("no-paths-in-steps");

  const derived = new Set(stepPaths.map((p) => resolveComponent(p, compText)));
  const union = new Set([...declared, ...derived]);
  const reqText = section(spec, /^##\s+Requirements\s*$/i, "## ") ?? "";
  const all = [...new Set([...stepPaths, ...extractPathTokens(reqText)])];
  const hits = sharedHits(all, manifestLines(sharedText));

  const reasons = [
    "tier=standard",
    `components declared=${declared.size} derived=${derived.size} union=${union.size} threshold=${COMPONENT_THRESHOLD}`,
    `shared-contract=${hits.length === 0 ? "none" : hits.join(",")}`,
  ];
  const skip = union.size <= COMPONENT_THRESHOLD && hits.length === 0;
  return answer(skip ? "skipped" : "required", reasons);
}
