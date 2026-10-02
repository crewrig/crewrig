// check-stray-scan-wiring.ts — stray-scan wiring check (spec 0170 delta-01 R16-R17).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-stray-scan-wiring.ts
//
// Two static assertions over the CI definition, run by the `path-ownership` capability:
//
//   R17a  Every registered suite command engages the stray scan. A command whose program
//         is `bash scripts/tests/test-*.sh` is a finding, in the capability reference
//         (`command:` entries of ci/ci-capabilities.yml) and in the hand-authored GitHub
//         Actions jobs (`run:` of every step under .github/workflows). The accepted form is
//         `bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/<suite>`. Before
//         the program is read, a command is split on newlines, its whitespace normalised, and
//         at most ONE generated cache-guard layer
//         (`bash scripts/ci-cache-guard.sh --cache-dir ... [--key-files ...] [--key-env ...] -- `)
//         removed, so a suite wrapped only in the cache guard is still bare.
//
//   R17b  Every tracked suite that has an owner is triggered by a change to itself. Owners
//         are taken from the reference only: the capabilities whose `command` mentions
//         `scripts/tests/<suite>`. At least one owner must have a `pull-request` trigger with
//         no `paths:` filter, or a `paths:` entry that matches the suite (decided by
//         scripts/lib/glob-engine.ts, which rejects every syntax outside the forms it
//         implements). A suite with no owner passes: spec 0076 and
//         ci/test-wiring-exemptions.txt decide whether it needs one.
//
// It reads the working tree and one `git ls-files -z`; no base ref, no execution of any
// suite. `CREWRIG_REPO_DIR` overrides the repository root like the sibling checks.
//
// Known limits (spec 0170 delta-01 R14 — what this check cannot see):
//   - Only the first program of a line is read. A suite run inside a loop
//     (`for s in ...; do bash "$s"; done`), behind `bash -c '...'`, after `&&`, `;` or `|`,
//     or on a continuation line of a `\`-joined command is not recognised, bare or not.
//   - Only the form `[VAR=value ...] bash [./]scripts/tests/test-*.sh` is a suite command. A
//     suite started as `./scripts/tests/test-x.sh`, `sh scripts/tests/...` or through a
//     variable is not recognised.
//   - Suites outside the registered population are not covered: scripts/test-build-components.sh
//     and artifacts/library/skills/harness-curator/scripts/test.sh do not live in
//     scripts/tests/test-*.sh.
//   - Only `.github/workflows/*.yml|yaml` jobs are read; the GitLab pipeline is derived from the
//     reference by scripts/build-ci.sh and verified by scripts/check-ci-parity.sh, not here.
//   - A trigger entry written once for the pull request is judged by its own `paths:` only;
//     branch filters and GitLab `changes:` equivalence are out of scope.
//
// Exit: 0 clean, 1 findings, 2 wiring fault (unreadable or malformed reference or workflow,
// unsupported glob, no git).
// Finding lines: `stray-scan-wiring: <R17a|R17b>: <capability | file#job | suite>: <message>`.

import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { UnsupportedGlobError, globToRegExp } from "./lib/glob-engine.ts";
import { readTextLf } from "./lib/line-endings.ts";
import { WiringError, repoRoot, trackedFiles } from "./lib/ts-scope.ts";

const REFERENCE = "ci/ci-capabilities.yml";
const WORKFLOWS_DIR = ".github/workflows";
const PREFIX = "stray-scan-wiring";

/** The generated cache layer: `--cache-dir` is mandatory, so the scan form is never unwrapped. */
const CACHE_LAYER =
  /^bash scripts\/ci-cache-guard\.sh((?: --(?:cache-dir|key-files|key-env)(?: "[^"]*"| '[^']*'| \S+))+) -- (.+)$/;
/** A bare registered-suite command, optionally behind leading `VAR=value` assignments. */
const BARE_SUITE =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=\S* )*bash (?:\.\/)?(scripts\/tests\/test-[A-Za-z0-9._-]+\.sh)(?: |$)/;
/** A suite mention anywhere in a reference command (the ownership relation). */
const SUITE_MENTION = /scripts\/tests\/test-[A-Za-z0-9._-]+\.sh/g;
/** A tracked registered suite. */
const SUITE_PATH = /^scripts\/tests\/test-[^/]+\.sh$/;

type Rule = "R17a" | "R17b";

interface Finding {
  rule: Rule;
  subject: string;
  message: string;
}

/** One pull-request trigger entry: `null` paths means no filter. */
interface PullRequestTrigger {
  paths: RegExp[] | null;
}

interface Capability {
  id: string;
  commands: string[];
  pullRequest: PullRequestTrigger[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scanned(suite: string): string {
  return `bash scripts/ci-cache-guard.sh --stray-scan -- bash ${suite}`;
}

/** Split a command into candidate lines: newline-split, whitespace-normalised, blanks dropped. */
function commandLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter((l) => l !== "");
}

/** The suite path when `line` is a bare suite command after removing one cache-guard layer. */
function bareSuite(line: string): string | null {
  const layer = CACHE_LAYER.exec(line);
  const inner = layer === null ? line : (layer[2] ?? line);
  const m = BARE_SUITE.exec(inner);
  return m === null ? null : (m[1] ?? null);
}

function readYaml(rel: string): unknown {
  const abs = path.join(repoRoot(), rel);
  let text: string;
  try {
    text = readTextLf(abs);
  } catch (err) {
    throw new WiringError(`cannot read ${rel}: ${(err as Error).message}`);
  }
  try {
    return load(text);
  } catch (err) {
    throw new WiringError(`${rel} is not valid YAML: ${(err as Error).message}`);
  }
}

/** Compile the `pull-request` triggers of a capability; unsupported globs name the capability. */
function pullRequestTriggers(id: string, trigger: unknown): PullRequestTrigger[] {
  if (trigger === undefined) return [];
  if (!Array.isArray(trigger)) throw new WiringError(`capability '${id}': 'trigger' is not a list`);
  const out: PullRequestTrigger[] = [];
  for (const t of trigger as unknown[]) {
    if (!isRecord(t) || t.on !== "pull-request") continue;
    if (t.paths === undefined) {
      out.push({ paths: null });
      continue;
    }
    if (!Array.isArray(t.paths) || t.paths.some((p) => typeof p !== "string"))
      throw new WiringError(`capability '${id}': 'paths' is not a list of strings`);
    const res = (t.paths as string[]).map((p) => {
      try {
        return globToRegExp(p);
      } catch (err) {
        if (err instanceof UnsupportedGlobError)
          throw new UnsupportedGlobError(p, err.why, `capability '${id}' paths`);
        throw err;
      }
    });
    out.push({ paths: res });
  }
  return out;
}

function readCapabilities(): Capability[] {
  const doc = readYaml(REFERENCE);
  const caps = isRecord(doc) ? doc.capabilities : undefined;
  if (caps === undefined) throw new WiringError(`${REFERENCE} has no 'capabilities' list`);
  if (!Array.isArray(caps)) throw new WiringError(`${REFERENCE}: 'capabilities' is not a list`);
  return (caps as unknown[]).map((cap) => {
    if (!isRecord(cap)) throw new WiringError(`${REFERENCE}: a capability entry is not a mapping`);
    const id = typeof cap.id === "string" ? cap.id : "?";
    let commands: string[] = [];
    if (cap.command !== undefined) {
      if (!Array.isArray(cap.command) || cap.command.some((c) => typeof c !== "string"))
        throw new WiringError(`capability '${id}': 'command' is not a list of strings`);
      commands = cap.command as string[];
    }
    return { id, commands, pullRequest: pullRequestTriggers(id, cap.trigger) };
  });
}

/** Every `run:` text of every job step under .github/workflows, tagged `<file>#<job>`. */
function workflowRuns(): Array<{ subject: string; run: string }> {
  const dir = path.join(repoRoot(), WORKFLOWS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new WiringError(`cannot read ${WORKFLOWS_DIR}: ${(err as Error).message}`);
  }
  const runs: Array<{ subject: string; run: string }> = [];
  for (const name of names.filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const rel = `${WORKFLOWS_DIR}/${name}`;
    const doc = readYaml(rel);
    const jobs = isRecord(doc) ? doc.jobs : undefined;
    if (!isRecord(jobs)) continue;
    for (const [jobId, job] of Object.entries(jobs)) {
      const steps = isRecord(job) ? job.steps : undefined;
      if (!Array.isArray(steps)) continue;
      for (const step of steps as unknown[]) {
        if (isRecord(step) && typeof step.run === "string")
          runs.push({ subject: `${rel}#${jobId}`, run: step.run });
      }
    }
  }
  return runs;
}

function bareFinding(subject: string, suite: string, line: string): Finding {
  return {
    rule: "R17a",
    subject,
    message: `suite command does not engage the stray scan; write '${scanned(suite)}' (found '${line}')`,
  };
}

interface Report {
  commands: number;
  suites: number;
  owned: number;
  findings: Finding[];
}

/** Suite owners from the reference: suite path -> ids of the capabilities mentioning it. */
function ownersBySuite(caps: readonly Capability[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const cap of caps) {
    const mentioned = new Set(cap.commands.flatMap((c) => c.match(SUITE_MENTION) ?? []));
    for (const suite of mentioned) owners.set(suite, [...(owners.get(suite) ?? []), cap.id]);
  }
  return owners;
}

function covers(cap: Capability, suite: string): boolean {
  return cap.pullRequest.some((t) => t.paths === null || t.paths.some((re) => re.test(suite)));
}

function evaluate(
  caps: readonly Capability[],
  runs: ReadonlyArray<{ subject: string; run: string }>,
  files: readonly string[],
): Report {
  const findings: Finding[] = [];
  let commands = 0;
  for (const cap of caps) {
    for (const entry of cap.commands) {
      for (const line of commandLines(entry)) {
        commands += 1;
        const suite = bareSuite(line);
        if (suite !== null) findings.push(bareFinding(cap.id, suite, line));
      }
    }
  }
  for (const { subject, run } of runs) {
    for (const line of commandLines(run)) {
      commands += 1;
      const suite = bareSuite(line);
      if (suite !== null) findings.push(bareFinding(subject, suite, line));
    }
  }
  const owners = ownersBySuite(caps);
  const byId = new Map(caps.map((c) => [c.id, c] as const));
  const suites = files.filter((f) => SUITE_PATH.test(f)).sort();
  let owned = 0;
  for (const suite of suites) {
    const ids = owners.get(suite);
    if (ids === undefined) continue;
    owned += 1;
    const ownerCaps = ids.flatMap((id) => byId.get(id) ?? []);
    if (ownerCaps.some((cap) => covers(cap, suite))) continue;
    findings.push({
      rule: "R17b",
      subject: suite,
      message:
        `owned by ${ids.join(", ")} but no owner's pull-request \`paths:\` matches it, ` +
        "so a change to the suite would not run its owner; add the suite to the owner's `paths:` " +
        "(and the matching GitHub path filter) in ci/ci-capabilities.yml",
    });
  }
  return { commands, suites: suites.length, owned, findings };
}

function formatReport(report: Report): string[] {
  const lines = report.findings.map((f) => `${PREFIX}: ${f.rule}: ${f.subject}: ${f.message}`);
  if (report.findings.length === 0) {
    lines.push(
      `${PREFIX}: OK: ${report.commands} commands scanned, ${report.suites} suites, ${report.owned} owned`,
    );
    return lines;
  }
  lines.push(`${PREFIX}: ${report.findings.length} finding(s)`);
  return lines;
}

function main(): number {
  const caps = readCapabilities();
  const runs = workflowRuns();
  const report = evaluate(caps, runs, trackedFiles());
  for (const line of formatReport(report)) console.log(line);
  return report.findings.length > 0 ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  if (err instanceof WiringError || err instanceof UnsupportedGlobError) {
    console.error(`${PREFIX}: error: ${err.message}`);
  } else {
    console.error(
      `${PREFIX}: error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
  }
  process.exitCode = 2;
}
