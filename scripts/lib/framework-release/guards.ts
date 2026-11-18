// guards.ts — the guards of the framework release jobs (spec 0310 R1, R6, R7, R12; spec 0288 R26).
// A guard writes nothing to the forge. It fetches the refs it depends on from `origin` itself, and a
// ref that cannot be fetched or resolved fails the guard that needs it, never passes it.

import fs from "node:fs";

import { git } from "./git.ts";
import { declaredVersion, isCoreVersion, parseTag } from "./version.ts";

export interface GuardInput {
  readonly repo: string;
  readonly commit: string;
  readonly releaseBranch: string;
  readonly mainBranch: string;
}

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail });
const fail = (name: string, detail: string): Check => ({ name, ok: false, detail });

/** Fetch `refs/heads/<branch>` into `refs/remotes/origin/<branch>`; the resolved sha or an error text. */
function fetchBranch(repo: string, branch: string): { sha?: string; error?: string } {
  const spec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
  const res = git(repo, ["fetch", "--no-tags", "origin", spec]);
  if (res.status !== 0) return { error: `cannot fetch origin/${branch}: ${res.stderr.trim()}` };
  const sha = git(repo, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${branch}^{commit}`,
  ]);
  return sha.status === 0
    ? { sha: sha.stdout.trim() }
    : { error: `cannot resolve origin/${branch}` };
}

function resolveCommit(repo: string, commit: string): string | undefined {
  const res = git(repo, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  return res.status === 0 ? res.stdout.trim() : undefined;
}

function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  return git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

function versionCheck(repo: string, commit: string, core: string): Check {
  try {
    const declared = declaredVersion(repo, commit);
    return declared === core
      ? pass("version", `tag ${core} equals the declared version`)
      : fail("version", `tag version ${core} differs from the declared version ${declared}`);
  } catch (error) {
    return fail("version", error instanceof Error ? error.message : String(error));
  }
}

/** Guards 1 to 3 of spec 0288 R26 and the version check of spec 0310 R1. */
export function prereleaseGuards(tag: string, input: GuardInput): Check[] {
  const parsed = parseTag(tag, "prerelease");
  if (parsed === undefined) {
    return [fail("form", `'${tag}' is not of the form crewrig-v<X.Y.Z>-next.<N>`)];
  }
  const checks = [pass("form", tag)];
  const commit = resolveCommit(input.repo, input.commit);
  if (commit === undefined) {
    return [...checks, fail("commit", `cannot resolve the tagged commit '${input.commit}'`)];
  }
  checks.push(versionCheck(input.repo, commit, parsed.core));
  const release = fetchBranch(input.repo, input.releaseBranch);
  checks.push(
    release.sha === undefined
      ? fail("release-branch", release.error ?? "unresolvable")
      : isAncestor(input.repo, commit, release.sha)
        ? pass("release-branch", `${commit} is on origin/${input.releaseBranch}`)
        : fail("release-branch", `${commit} is not an ancestor of origin/${input.releaseBranch}`),
  );
  const main = fetchBranch(input.repo, input.mainBranch);
  checks.push(
    main.sha === undefined
      ? fail("not-on-main", main.error ?? "unresolvable")
      : isAncestor(input.repo, commit, main.sha)
        ? fail("not-on-main", `${commit} is an ancestor of origin/${input.mainBranch}`)
        : pass("not-on-main", `${commit} is not on origin/${input.mainBranch}`),
  );
  return checks;
}

export interface StableInput extends GuardInput {
  /** The `GITHUB_REF` of the run. */
  readonly ref: string;
  /** The version typed into the dispatch. */
  readonly version: string;
  /** JSON file of the releases of the repository; published releases only are read. */
  readonly releasesJson: string;
}

/** Published releases named `tag` in the file; a draft does not count (its fate is the publisher's, R5). */
function publishedReleases(file: string, tag: string): number | string {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return `cannot read the releases file: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!Array.isArray(data)) return "the releases file is not a JSON array";
  // `gh api --paginate --slurp` yields one array per page.
  const flat = data.flat() as Array<{ tag_name?: unknown; draft?: unknown } | null>;
  return flat.filter((r) => r?.tag_name === tag && r.draft !== true).length;
}

/** The guards of spec 0310 R7: ref, head of main, version, no tag and no published release. */
export function stableGuards(input: StableInput): Check[] {
  const checks: Check[] = [];
  if (!isCoreVersion(input.version)) {
    return [fail("form", `'${input.version}' is not a SemVer core version X.Y.Z`)];
  }
  const tag = `crewrig-v${input.version}`;
  checks.push(
    input.ref === `refs/heads/${input.mainBranch}`
      ? pass("ref", input.ref)
      : fail("ref", `the ref is '${input.ref}', not refs/heads/${input.mainBranch}`),
  );
  const commit = resolveCommit(input.repo, input.commit);
  const main = fetchBranch(input.repo, input.mainBranch);
  if (commit === undefined) {
    checks.push(fail("head-of-main", `cannot resolve the commit '${input.commit}'`));
  } else if (main.sha === undefined) {
    checks.push(fail("head-of-main", main.error ?? "unresolvable"));
  } else {
    checks.push(
      commit === main.sha
        ? pass("head-of-main", commit)
        : fail(
            "head-of-main",
            `${commit} is not the head of origin/${input.mainBranch} (${main.sha})`,
          ),
    );
    checks.push(versionCheck(input.repo, commit, input.version));
  }
  const remote = git(input.repo, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  checks.push(
    remote.status !== 0
      ? fail("no-tag", `cannot list the tags of origin: ${remote.stderr.trim()}`)
      : remote.stdout.trim() === ""
        ? pass("no-tag", `${tag} does not exist`)
        : fail("no-tag", `the tag ${tag} already exists`),
  );
  const found = publishedReleases(input.releasesJson, tag);
  checks.push(
    typeof found === "string"
      ? fail("no-release", found)
      : found === 0
        ? pass("no-release", `no published release of ${tag}`)
        : fail("no-release", `a published release of ${tag} exists`),
  );
  return checks;
}
