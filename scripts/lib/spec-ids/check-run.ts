// check-run.ts — candidate discovery, reservation lookup and reporting of
// check-spec-id-reserved (spec 0262).
//
// Usage: checkMain(argv, env)
// Exit codes: 0 clean, reported or unreadable namespace; 1 blocking finding; 2 wiring fault.
// Finding-line format: `  - <spec> — <message>` on stderr.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { runGit } from "../governance/git-run.ts";
import { ExitSignal, fileLines, note, out, SPACE } from "./exit.ts";
import { assertRepository, determineOrigin, inCiContext, resolveBase } from "./check-origin.ts";

const CARRIER_PRIMARY = "refs/spec-ids/";
const CARRIER_TAGS = "refs/tags/spec-id/";
const S = `[${SPACE.replace("\n", "\\n").replace("\t", "\\t").replace("\v", "\\v").replace("\f", "\\f").replace("\r", "\\r")}]`;

function git(repoDir: string, args: string[]): { status: number; stdout: string } {
  const res = runGit(["-C", repoDir, ...args], { cwd: process.cwd() });
  return { status: res.status, stdout: res.stdout.toString("utf8") };
}

function excludedPrefixes(manifest: string): string[] {
  const prefixes = ["specs/org/"];
  if (!existsSync(manifest) || !statSync(manifest).isFile()) return prefixes;
  for (let line of fileLines(readFileSync(manifest, "utf8"))) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "" || line.startsWith("#")) continue;
    const match = new RegExp(`^([^${SPACE}]*)(.*)$`, "s").exec(line);
    const mpath = match?.[1] ?? "";
    const rest = (match?.[2] ?? "").replace(new RegExp(`^${S}*`), "");
    const policy = rest.replace(new RegExp(`${S}.*$`, "s"), "") || "strict";
    if (policy === "excluded" && mpath.startsWith("specs/")) prefixes.push(`${mpath}/`);
  }
  return prefixes;
}

function frontmatter(file: string): string[] {
  const lines = fileLines(readFileSync(file, "utf8"));
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  return end === -1 ? lines.slice(1) : lines.slice(1, end);
}

function relatedIssueOf(file: string): string {
  const re = new RegExp(`^related-issue:${S}*[0-9]+${S}*$`);
  for (const line of frontmatter(file))
    if (re.test(line))
      return line.replace(new RegExp(`^related-issue:${S}*`), "").replace(new RegExp(S, "g"), "");
  return "";
}

function unsecuredMarkOf(file: string): string {
  for (const line of frontmatter(file))
    if (line.startsWith("unsecured-id:"))
      return line
        .replace(/^unsecured-id:[ \t\n\v\f\r]*/, "")
        .replace(new RegExp(S, "g"), "")
        .replace(/[A-Z]/g, (c) => c.toLowerCase());
  return "";
}

function oidAt(listing: string, want: string): string {
  for (const line of listing.split("\n")) {
    const fields = line.split("\t");
    if (fields[1] === want) return fields[0] ?? "";
  }
  return "";
}

function recordedIssue(repoDir: string, remote: string, ref: string): string {
  const probe = "refs/spec-id-check/current";
  if (
    git(repoDir, ["fetch", "--no-tags", "--quiet", "--force", remote, `+${ref}:${probe}`])
      .status !== 0
  )
    return "";
  const log = git(repoDir, ["log", "-1", "--format=%s", probe]);
  const msg = (log.status === 0 ? log.stdout : "").replace(/\n+$/, "");
  git(repoDir, ["update-ref", "-d", probe]);
  const at = msg.lastIndexOf("issue #");
  return at === -1 ? "" : msg.slice(at + "issue #".length);
}

function prefixed(items: string[]): void {
  for (const item of items)
    for (const line of item.split("\n")) process.stderr.write(`  - ${line}\n`);
}

export function checkMain(argv: readonly string[], env: NodeJS.ProcessEnv): void {
  const repoDir = env.CREWRIG_REPO_DIR || path.resolve(import.meta.dirname, "..", "..", "..");
  assertRepository(repoDir);
  const inCi = inCiContext(env);
  const origin = determineOrigin(env, inCi);
  const blocking = origin !== "fork";
  const baseRef = resolveBase(argv[0] ?? "", env, repoDir, inCi);
  const remote = baseRef.slice(0, baseRef.includes("/") ? baseRef.indexOf("/") : undefined);
  const excluded = excludedPrefixes(`${repoDir}/.crewrig/core-paths.txt`);

  const candidates: string[] = [];
  let skippedDelta = 0;
  let skippedOrg = 0;
  const diff = git(repoDir, [
    "diff",
    "--name-status",
    "--diff-filter=AR",
    baseRef,
    "--",
    "specs/*.md",
  ]);
  for (const line of (diff.status === 0 ? diff.stdout : "").split("\n")) {
    if (line === "") continue;
    const file = line.slice(line.lastIndexOf("\t") + 1);
    if (!file.startsWith("specs/") || !file.endsWith(".md")) continue;
    const base = file.slice(file.lastIndexOf("/") + 1);
    if (base === "_template.md" || base === "README.md") continue;
    if (base.includes(".delta-")) {
      skippedDelta += 1;
      continue;
    }
    if (excluded.some((prefix) => file.startsWith(prefix))) {
      skippedOrg += 1;
      continue;
    }
    candidates.push(file);
  }
  note(`Base ref: ${baseRef} | remote: ${remote} | origin: ${origin} (blocking: ${blocking})`);
  note(
    `Specs added or renamed by this change: ${candidates.length} (delta-specs exempt: ${skippedDelta}; org-owned exempt: ${skippedOrg})`,
  );
  if (candidates.length === 0) {
    out("OK: this change adds or renames no non-delta upstream spec, so no id needs securing.");
    throw new ExitSignal(0);
  }
  const lsPrimary = git(repoDir, ["ls-remote", remote, "refs/spec-ids/*"]);
  if (lsPrimary.status !== 0) {
    note("");
    note(`[REPORT] The reservation namespace on '${remote}' could not be read, so no id`);
    note("         could be verified. This is a credential or connectivity gap, not a");
    note("         finding: an unreadable namespace is indistinguishable from an empty");
    note("         one, so failing here would accuse every id of being unsecured.");
    note("         Not failing the pipeline (spec 0112 PLAN step 10).");
    throw new ExitSignal(0);
  }
  const lsTagsRes = git(repoDir, ["ls-remote", remote, "refs/tags/spec-id/*"]);
  const lsTags = lsTagsRes.status === 0 ? lsTagsRes.stdout : "";
  const findings: string[] = [];
  const reports: string[] = [];
  for (const spec of candidates) {
    const base = spec.slice(spec.lastIndexOf("/") + 1);
    const id = base.includes("-") ? base.slice(0, base.indexOf("-")) : base;
    if (!/^[0-9]{4}$/.test(id)) {
      findings.push(
        `${spec} — filename does not begin with a four-digit id, so no reservation can be resolved for it. Rename it to specs/<NNNN>-<slug>.md (docs/spec-format.md → Naming convention).`,
      );
      continue;
    }
    let ticket = "";
    let mark = "";
    const abs = `${repoDir}/${spec}`;
    if (existsSync(abs) && statSync(abs).isFile()) {
      ticket = relatedIssueOf(abs);
      mark = unsecuredMarkOf(abs);
    }
    if (ticket === "") {
      findings.push(
        `${spec} — no integer 'related-issue' in the frontmatter, so the reservation cannot be attributed to a ticket. 'related-issue' is mandatory (docs/spec-format.md → Frontmatter schema).`,
      );
      continue;
    }
    const refPrimary = `${CARRIER_PRIMARY}${id}`;
    const refTags = `${CARRIER_TAGS}${id}`;
    const oidPrimary = oidAt(lsPrimary.stdout, refPrimary);
    const oidTags = oidAt(lsTags, refTags);
    if (oidPrimary === "" && oidTags === "") {
      const lead =
        mark === "true"
          ? `${spec} — id '${id}' was never secured (neither ${refPrimary} nor ${refTags} exists on '${remote}'), and the spec correctly declares 'unsecured-id: true'. Requirement 10: a maintainer secures the id and REMOVES the mark in the same act:`
          : `${spec} — id '${id}' was never secured (neither ${refPrimary} nor ${refTags} exists on '${remote}'). Secure it with:`;
      findings.push(`${lead}\n      bash scripts/reserve-spec-id.sh --id ${id} --issue ${ticket}`);
      continue;
    }
    let holderPrimary = "";
    let holderTags = "";
    let unresolved = false;
    if (oidPrimary !== "") {
      holderPrimary = recordedIssue(repoDir, remote, refPrimary);
      if (holderPrimary === "") unresolved = true;
    }
    if (oidTags !== "") {
      holderTags = recordedIssue(repoDir, remote, refTags);
      if (holderTags === "") unresolved = true;
    }
    if (holderPrimary !== "" && holderTags !== "" && holderPrimary !== holderTags) {
      findings.push(
        `${spec} — id '${id}' is recorded in BOTH upstream carriers for two different tickets: ${refPrimary} holds it for issue #${holderPrimary} and ${refTags} holds it for issue #${holderTags}. Two tickets cannot hold one id; this guard does not pick a winner. Resolve the attribution between #${holderPrimary} and #${holderTags}, then re-run.`,
      );
      continue;
    }
    if (unresolved) {
      reports.push(
        `${spec} — id '${id}' has a reservation ref on '${remote}', but no ticket could be resolved from it. Three conditions produce this and the check cannot tell them apart: the object could not be fetched (transport or credentials), the ref does not point at a commit, or the commit subject names no issue. Not treated as a finding: an unresolvable record is not an unsecured id, and failing open on a malformed or unreachable third-party reservation beats blocking a conformant change.`,
      );
      continue;
    }
    const heldAt = holderPrimary !== "" ? refPrimary : refTags;
    const holder = holderPrimary !== "" ? holderPrimary : holderTags;
    if (holder !== ticket) {
      findings.push(
        `${spec} — id '${id}' is secured for issue #${holder} (at ${heldAt}) but this spec declares 'related-issue: ${ticket}'. The id belongs to #${holder}; #${ticket} must allocate its own with:\n      bash scripts/reserve-spec-id.sh --issue ${ticket}`,
      );
      continue;
    }
    if (mark === "true") {
      findings.push(
        `${spec} — id '${id}' IS secured for its own ticket #${ticket} (at ${heldAt}), but the spec still carries a stale 'unsecured-id: true'. docs/spec-format.md → Frontmatter schema states that a merged spec never carries the mark, and requirement 10 removes it in the same act that secures the id. The field is machine-readable, so a false 'true' misinforms every consumer. Delete the 'unsecured-id' line from the frontmatter.`,
      );
      continue;
    }
    note(`  OK ${spec} — id '${id}' secured for issue #${ticket} at ${heldAt} (no stale mark)`);
  }
  if (reports.length > 0) {
    note("");
    note(`[REPORT] ${reports.length} condition(s) reported without failing:`);
    prefixed(reports);
  }
  if (findings.length === 0) {
    out(
      `OK: every spec added or renamed by this change (${candidates.length}) carries an id secured for its own ticket.`,
    );
    throw new ExitSignal(0);
  }
  note("");
  note(
    blocking
      ? `FAILED: ${findings.length} spec-id reservation finding(s):`
      : `REPORTED (not blocking — this pull request comes from a fork): ${findings.length} finding(s):`,
  );
  prefixed(findings);
  if (blocking) {
    note("");
    note("An id is secured before the spec file is written (spec 0112 requirement 2),");
    note("so that the branch name, the filename and the frontmatter 'id' agree from the");
    note("first commit. See docs/spec-pr-workflow.md → Reserving the spec id.");
    throw new ExitSignal(1);
  }
  note("");
  note("A fork's author cannot write to the reference repository, so this is reported");
  note("rather than blocked (spec 0112 requirement 10). A maintainer SHALL secure the");
  note("id before merging and remove the 'unsecured-id: true' mark in the same act.");
  throw new ExitSignal(0);
}
