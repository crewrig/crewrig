// path-ownership.ts — pure core of scripts/check-path-ownership.ts
// (spec 0147 delta-01 R12-R18). No I/O, no git, no base ref: the entry point
// feeds it the tracked-file list, the parsed capability reference and the
// exemption lists, and prints what formatReport returns.

import { UnsupportedGlobError, globToRegExp } from "./glob-engine.ts";

/** Rule ids of a finding line: `path-ownership: <rule>: <path-or-entry>[:<line>]: <message>`. */
export type Rule = "unowned" | "empty-reason" | "stale-entry";

/** A reference that cannot be read as a capability list: the entry point maps it to exit 2. */
export class OwnershipInputError extends Error {}

/** One `<glob><TAB><reason>` line of an exemption list. */
export interface Exemption {
  glob: string;
  reason: string;
  source: string;
  line: number;
  /** True when the line carried a TAB; a line without one has no reason by definition. */
  hasTab: boolean;
  /** Compiled glob, or null for a line without a TAB (its text is not a glob). */
  re: RegExp | null;
}

export interface Finding {
  rule: Rule;
  /** A tracked path, or `<list-file>:<line>` for an exemption entry. */
  subject: string;
  message: string;
}

export interface Report {
  evaluated: number;
  owned: number;
  exempt: number;
  /** Blocking findings: unowned files first (sorted), then list hygiene in list order. */
  findings: Finding[];
  /** Redundant exemption entries: reported, never failing. */
  notes: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Ownership globs: the `paths:` of every `pull-request` trigger entry of every
 * capability, unique, in first-seen order. A `push`-only `paths:` and a trigger
 * entry with no `paths:` confer nothing (delta-01 vocabulary).
 */
export function ownershipGlobs(capabilities: unknown): string[] {
  if (!Array.isArray(capabilities)) throw new OwnershipInputError("'capabilities' is not a list");
  const globs = new Set<string>();
  for (const cap of capabilities) {
    if (!isRecord(cap)) throw new OwnershipInputError("a capability entry is not a mapping");
    const id = typeof cap.id === "string" ? cap.id : "?";
    const triggers = cap.trigger;
    if (triggers === undefined) continue;
    if (!Array.isArray(triggers))
      throw new OwnershipInputError(`capability '${id}': 'trigger' is not a list`);
    for (const t of triggers) {
      if (!isRecord(t) || t.on !== "pull-request" || t.paths === undefined) continue;
      if (!Array.isArray(t.paths) || t.paths.some((p) => typeof p !== "string"))
        throw new OwnershipInputError(`capability '${id}': 'paths' is not a list of strings`);
      for (const p of t.paths as string[]) {
        try {
          globToRegExp(p); // fail closed now, with the owning capability named
        } catch (err) {
          if (err instanceof UnsupportedGlobError)
            throw new UnsupportedGlobError(p, err.why, `capability '${id}' paths`);
          throw err;
        }
        globs.add(p);
      }
    }
  }
  return [...globs];
}

/**
 * Parse an exemption list (LF text; the caller normalises CRLF). `#` lines and
 * blank lines are ignored. An entry's glob is compiled here, so an unsupported
 * glob fails with its `<source>:<line>`; a line without a TAB is kept (it is
 * an `empty-reason` finding) but not compiled.
 */
export function parseExemptions(text: string, source: string): Exemption[] {
  const entries: Exemption[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const tab = raw.indexOf("\t");
    const hasTab = tab >= 0;
    const glob = (hasTab ? raw.slice(0, tab) : raw).trim();
    const reason = hasTab ? raw.slice(tab + 1).trim() : "";
    let re: RegExp | null = null;
    if (hasTab) {
      try {
        re = globToRegExp(glob);
      } catch (err) {
        if (err instanceof UnsupportedGlobError)
          throw new UnsupportedGlobError(glob, err.why, `${source}:${line}`);
        throw err;
      }
    }
    entries.push({ glob, reason, source, line, hasTab, re });
  });
  return entries;
}

/** Decide ownership of every file, then audit the exemption lists. */
export function evaluate(input: {
  files: readonly string[];
  ownershipGlobs: readonly string[];
  exemptions: readonly Exemption[];
}): Report {
  const owners = input.ownershipGlobs.map(globToRegExp);
  const findings: Finding[] = [];
  const unowned: string[] = [];
  const matched = new Map<Exemption, { total: number; ownedToo: number }>();
  for (const e of input.exemptions) matched.set(e, { total: 0, ownedToo: 0 });
  let owned = 0;
  let exempt = 0;
  for (const file of input.files) {
    const isOwned = owners.some((re) => re.test(file));
    let isExempt = false;
    for (const e of input.exemptions) {
      if (e.re === null || !e.re.test(file)) continue;
      isExempt = true;
      const m = matched.get(e);
      if (m === undefined) continue;
      m.total += 1;
      if (isOwned) m.ownedToo += 1;
    }
    if (isOwned) owned += 1;
    else if (isExempt) exempt += 1;
    else unowned.push(file);
  }
  for (const file of unowned.sort()) {
    findings.push({
      rule: "unowned",
      subject: file,
      message: "tracked file is neither owned by a capability's pull-request `paths:` nor exempt",
    });
  }
  const notes: string[] = [];
  for (const e of input.exemptions) {
    const where = `${e.source}:${e.line}`;
    if (e.reason === "") {
      findings.push({
        rule: "empty-reason",
        subject: where,
        message: e.hasTab
          ? `entry '${e.glob}' has an empty reason; write '<glob><TAB><reason>' naming why no check exercises the file`
          : `entry '${e.glob}' has no TAB-separated reason; write '<glob><TAB><reason>'`,
      });
    }
    const m = matched.get(e);
    if (e.re === null || m === undefined) continue;
    if (m.total === 0) {
      findings.push({
        rule: "stale-entry",
        subject: where,
        message: `entry '${e.glob}' matches no tracked file; delete it in the same change that removed the file`,
      });
    } else if (m.ownedToo === m.total) {
      notes.push(
        `path-ownership: note: ${where}: entry '${e.glob}' is redundant, every file it matches is already owned`,
      );
    }
  }
  return { evaluated: input.files.length, owned, exempt, findings, notes };
}

/** The remedy text printed after any `unowned` finding. */
function remedies(exemptionList: string, overlay: string): string[] {
  return [
    "path-ownership: every tracked file needs an owner or a reason; fix each unowned file one of two ways:",
    "path-ownership:   1. extend the `paths:` of the capability in ci/ci-capabilities.yml whose checks exercise the file, " +
      "and mirror the glob in that job's GitHub path filter (.github/workflows/build.yml); or",
    `path-ownership:   2. add '<glob><TAB><reason>' to ${exemptionList} (adopters: ${overlay}) ` +
      "when no check exercises the file, or a capability with no `paths:` filter does on every change.",
  ];
}

/** Output lines for a report; the caller prints them and exits 1 when `findings` is non-empty. */
export function formatReport(
  report: Report,
  lists: { exemptionList: string; overlay: string } = {
    exemptionList: "ci/path-ownership-exemptions.txt",
    overlay: "ci/org/path-ownership-exemptions.txt",
  },
): string[] {
  const lines = report.findings.map((f) => `path-ownership: ${f.rule}: ${f.subject}: ${f.message}`);
  lines.push(...report.notes);
  if (report.findings.length === 0) {
    lines.push(
      `path-ownership: OK: evaluated ${report.evaluated} tracked files, owned ${report.owned}, exempt ${report.exempt}`,
    );
    return lines;
  }
  if (report.findings.some((f) => f.rule === "unowned"))
    lines.push(...remedies(lists.exemptionList, lists.overlay));
  lines.push(`path-ownership: ${report.findings.length} finding(s)`);
  return lines;
}
