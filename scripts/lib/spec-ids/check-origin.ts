// check-origin.ts — wiring faults, pull-request origin and base-ref resolution of
// check-spec-id-reserved (spec 0262).
//
// Usage: determineOrigin(env) / resolveBase(argv, env, repoDir, inCi)
// Exit codes: not applicable (library); a wiring fault throws ExitSignal(2).
// Finding-line format: `[ERROR] <message>` on stderr after a blank line.

import { defaultBaseRef, normalizeBaseRef, preferredRemote } from "../governance/base-ref.ts";
import { runGit } from "../governance/git-run.ts";
import { ExitSignal, note } from "./exit.ts";

export function wiringFault(message: string): never {
  note("");
  note(`[ERROR] ${message}`);
  throw new ExitSignal(2);
}

function verifies(repoDir: string, ref: string): boolean {
  return runGit(["-C", repoDir, "rev-parse", "--verify", ref], { cwd: process.cwd() }).status === 0;
}

export function assertRepository(repoDir: string): void {
  if (runGit(["-C", repoDir, "rev-parse", "--git-dir"], { cwd: process.cwd() }).status !== 0)
    wiringFault(`not a git repository: ${repoDir}. This guard reads the change under
        test from the repository, so it has no subject here.`);
}

export function inCiContext(env: NodeJS.ProcessEnv): boolean {
  return [env.GITHUB_ACTIONS, env.GITLAB_CI, env.CI].some((v) => v !== undefined && v !== "");
}

function pairOrigin(pair: string, left: string, right: string, declared: string): string {
  if (declared !== "") {
    note(`Notice: CREWRIG_SPEC_ID_ORIGIN='${declared}' IGNORED — the platform pair`);
    note(`        (${pair}) is present and wins.`);
  }
  return left === right ? "same" : "fork";
}

export function determineOrigin(env: NodeJS.ProcessEnv, inCi: boolean): string {
  const declared = env.CREWRIG_SPEC_ID_ORIGIN ?? "";
  if (declared !== "" && declared !== "same" && declared !== "fork")
    wiringFault(`CREWRIG_SPEC_ID_ORIGIN is '${declared}'; expected 'same' or 'fork'.`);
  const head = env.CREWRIG_PR_HEAD_REPO ?? "";
  const base = env.CREWRIG_PR_BASE_REPO ?? "";
  if (head !== "" && base !== "")
    return pairOrigin("CREWRIG_PR_HEAD_REPO / CREWRIG_PR_BASE_REPO", head, base, declared);
  const src = env.CI_MERGE_REQUEST_SOURCE_PROJECT_PATH ?? "";
  const proj = env.CI_PROJECT_PATH ?? "";
  if (src !== "" && proj !== "")
    return pairOrigin(
      "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH / CI_PROJECT_PATH",
      src,
      proj,
      declared,
    );
  if (inCi) {
    if (declared !== "") {
      note(`Notice: CREWRIG_SPEC_ID_ORIGIN='${declared}' IGNORED — a CI context was`);
      note("        detected, where only the platform pair may decide origin.");
    }
    wiringFault(`a CI context was detected (CI / GITHUB_ACTIONS / GITLAB_CI is set) but
        neither platform pair resolved, so pull-request origin is unknown — and
        requirement 10 makes the two outcomes different: a same-repository
        unsecured id FAILS, a fork's is only reported. This is a wiring defect,
        so fix the wiring rather than asserting the answer:
          - GitHub Actions: map github.event.pull_request.head.repo.full_name and
            github.repository into CREWRIG_PR_HEAD_REPO / CREWRIG_PR_BASE_REPO
            through the job's env: block — they are workflow CONTEXTS, not
            ambient environment;
          - GitLab CI: CI_MERGE_REQUEST_SOURCE_PROJECT_PATH and CI_PROJECT_PATH
            are ambient in a merge-request pipeline; a non-merge-request pipeline
            should not be running this check at all.
        CREWRIG_SPEC_ID_ORIGIN is deliberately NOT honoured inside CI: a guard an
        environment variable can switch off is not a guard.`);
  }
  if (declared === "same" || declared === "fork") return declared;
  return wiringFault(`cannot determine whether this pull request comes from the reference
        repository or from a fork, and requirement 10 makes the two outcomes
        different — a same-repository unsecured id FAILS, a fork's is only
        reported. Supply one of:
          - CREWRIG_PR_HEAD_REPO and CREWRIG_PR_BASE_REPO (GitHub Actions: map
            github.event.pull_request.head.repo.full_name and
            github.repository through an env: block — they are workflow
            contexts, not ambient environment);
          - CI_MERGE_REQUEST_SOURCE_PROJECT_PATH and CI_PROJECT_PATH (GitLab
            CI, already ambient in a merge-request pipeline);
          - CREWRIG_SPEC_ID_ORIGIN=same|fork, admissible OUTSIDE CI only, which
            is the case you are in now — one variable and the run proceeds.
        Refusing to guess: guessing 'fork' would disable this guard on every
        pull request.`);
}

/** The verified base ref (fetching once when needed); wiring faults otherwise. */
export function resolveBase(
  arg: string,
  env: NodeJS.ProcessEnv,
  repoDir: string,
  inCi: boolean,
): string {
  let baseRef = normalizeBaseRef(arg !== "" ? arg : (env.BASE_REF ?? ""));
  if (baseRef === "") {
    const remote = preferredRemote(repoDir);
    if (remote === "")
      wiringFault(`no git remote is configured, so no default base ref could be derived.
        Pass a resolvable ref as the first argument or via BASE_REF.`);
    if (inCi) {
      const target = env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? "";
      if (target === "")
        wiringFault(`a CI context was detected (CI / GITHUB_ACTIONS / GITLAB_CI is set) but the
        branch this change targets is unknown, and this guard will not assume
        'main'. Assuming it is what made a release/** merge request diff against
        main, report every spec merged to the release branch as newly added, and
        block a conformant merge request while attributing a third party's spec
        and issue number to it. Supply one of:
          - BASE_REF, or a positional argument, naming the target ref (GitHub
            Actions: map github.event.pull_request.base.ref through the job's
            env: block, as .github/workflows/build.yml does);
          - CI_MERGE_REQUEST_TARGET_BRANCH_NAME (GitLab CI: ambient in a
            merge-request pipeline; a non-merge-request pipeline should not be
            running this check at all).
        Outside CI the default '<remote>/main' still applies, so a maintainer
        running this by hand needs none of the above.`);
      baseRef = `${remote}/${target}`;
    } else {
      baseRef = defaultBaseRef(remote, process.cwd(), repoDir);
    }
  }
  if (!verifies(repoDir, baseRef)) {
    const slash = baseRef.indexOf("/");
    const remote = slash === -1 ? baseRef : baseRef.slice(0, slash);
    const branch = slash === -1 ? baseRef : baseRef.slice(slash + 1);
    runGit(["-C", repoDir, "fetch", "--depth=50", remote, branch], { cwd: process.cwd() });
    if (!verifies(repoDir, baseRef))
      wiringFault(`cannot resolve base ref '${baseRef}' and 'git fetch' did not recover
        it. On GitHub Actions this is usually a missing 'fetch-depth: 0' on
        actions/checkout; the capability declares 'history-depth: full' for
        exactly this reason.`);
  }
  return baseRef;
}
