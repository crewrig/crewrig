// The R6 wiring test (spec 0309 delta-02 R6 and R7; ADR-0021 amendments): every capability with a
// `push` trigger on main or release/** runs with no path filter on a push, on both engines, except
// the capabilities of ci/push-main-exemptions.txt. The fixtures exercise each case (a) to (h) of the
// spec on both engines and show the fixed fixture passing. The real tree is read offline from
// committed files only. The #2009 regression (R7) detects after the merge, as a red run of main,
// not before it: a filter gap on a pull request is left to merge by design.
//
// The real-tree assertion of case (b), the workflow files, is added with the removal of the
// standalone push filters (R12(f)); until then only that case is asserted on fixtures.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readReference } from "../lib/ci-parity/reference-read.ts";
import { evalJobIf, pushContext } from "../lib/ci-push/gha-if.ts";
import { readPush } from "../lib/ci-push/branches.ts";
import { formatExemptions, parseExemptions } from "../lib/ci-push/exemptions.ts";
import {
  checkCacheInvariance,
  checkCacheNoTriggerFallback,
  checkExemptionList,
  checkGate,
  checkGitlab,
  checkJobConditions,
  checkPullRequestControl,
  checkReference,
  checkSkillBudgets,
  checkWorkflowFilters,
  show,
} from "../lib/ci-push/evaluate.ts";
import type { Finding, PushInputs } from "../lib/ci-push/evaluate.ts";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";
import { load } from "js-yaml";

// js-yaml cannot read GitLab's `!reference [a, b]` tag: it is read as a plain sequence.
const parseYaml = (text: string): unknown => load(text.replace(/!reference\s*\[/g, "["));

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL_TEST = "scripts/tests/skill-size-budgets.test.ts";

// ---------------------------------------------------------------------------------- fixtures

const CAP = (
  id: string,
  extra: string,
  trig: string,
  cmd = "task ci:alpha",
): string => `  - id: ${id}
    name: "${id}"
    trigger:
${trig}
    portability: portable
    requires:
      runtime: node@24
${extra}
    command:
      - ${cmd}
`;
const PR = `      - on: pull-request
        branches: [main]
        paths:
          - "src/**"`;
const PUSH = `      - on: push
        branches: [main, "release/**"]`;
const PUSH_FILTERED = `${PUSH}
        paths:
          - "src/**"`;
const PAGES = `  - id: pages-deploy
    name: "pages"
    trigger:
      - on: push
        branches: [main]
        paths:
          - "site/**"
    portability: specific
    exception:
      engine: github-actions
      evidence: "Publishes through .github/workflows/pages.yml to github-pages."
`;
const REF = (alpha = `${PR}\n${PUSH}`, beta = PR, pages = PAGES): string =>
  `capabilities:\n${CAP("alpha", "", alpha)}${CAP("beta", "", beta, "task ci:beta")}${pages}`;

const EXEMPT = `no-push\tbeta\tPull-request-only fixture.\nside-effect\tpages-deploy\tPublishes the site outside the repository.\n`;

const BUILD = (jobs: string, push = `    branches: [main, "release/**"]`): string => `name: b
on:
  pull_request:
    branches: [main]
  push:
${push}
jobs:
${jobs}`;
const JOB = (key: string, id: string, extra = ""): string => `  ${key}:
${extra}    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/ci-job
        with:
          id: ${id}
`;
const JOBS =
  JOB("alpha", "alpha") + JOB("beta", "beta", "    if: github.event_name == 'pull_request'\n");
const PAGES_WF = (push: string): string => `name: pages
on:
  push:
${push}
jobs:
  deploy: # ci-capability: pages-deploy
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
`;
const PAGES_PUSH = `    branches: [main]\n    paths:\n      - "site/**"`;

const GITLAB = (
  alpha = `    - if: '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH =~ /^(main|release\\/.*)$/'`,
): string => `workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'
alpha:
  script: [echo]
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes: ["src/**"]
${alpha}
beta:
  script: [echo]
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes: ["src/**"]
`;

function tempTree(tasks: string): ReturnType<typeof loadTaskfileTree> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-push-"));
  fs.writeFileSync(path.join(dir, "Taskfile.yml"), `version: '3'\ntasks:\n${tasks}`);
  return loadTaskfileTree(dir);
}
const TASKS = `  ci:alpha:\n    cmds:\n      - echo alpha\n  ci:beta:\n    cmds:\n      - echo beta\n  ci:budget:\n    cmds:\n      - node --test {{.REPO_DIR}}/${SKILL_TEST}\n`;

function fixture(over: Partial<PushInputs> = {}): PushInputs {
  return {
    reference: REF(),
    workflows: {
      ".github/workflows/build.yml": BUILD(JOBS),
      ".github/workflows/pages.yml": PAGES_WF(PAGES_PUSH),
    },
    gitlab: GITLAB(),
    exemptions: EXEMPT,
    tree: tempTree(TASKS),
    parseYaml,
    ...over,
  };
}
const has = (fs_: Finding[], re: RegExp): boolean => fs_.some((x) => re.test(show(x)));
const wf = (name: string, text: string, base = fixture()): PushInputs =>
  fixture({ workflows: { ...base.workflows, [`.github/workflows/${name}`]: text } });

// ------------------------------------------------------------------------------- evaluators

describe("the closed evaluators", () => {
  const main = pushContext("main");
  const rel = pushContext("release/1.0");
  it("accepts the closed job-if forms and evaluates them for main and a release ref", () => {
    assert.equal(evalJobIf(undefined, main), true);
    assert.equal(evalJobIf("always()", main), true);
    assert.equal(evalJobIf("${{ success() }}", main), true);
    assert.equal(evalJobIf("github.event_name == 'pull_request'", main), false);
    assert.equal(evalJobIf("github.event_name != 'pull_request'", main), true);
    assert.equal(evalJobIf("github.repository == 'crewrig/crewrig'", main), true);
    assert.equal(evalJobIf("github.repository == 'someone/else'", main), false);
    assert.equal(evalJobIf("github.ref == 'refs/heads/main'", main), true);
    assert.equal(evalJobIf("github.ref == 'refs/heads/main'", rel), false);
    assert.equal(
      evalJobIf("!(github.ref_name == 'x') && (always() || github.event_name == 'y')", main),
      true,
    );
  });
  it("fails closed outside the grammar", () => {
    for (const e of [
      "github.actor == 'x'",
      "contains(github.ref, 'main')",
      "needs.a.result == 'success'",
      "vars.X == '1'",
      "github.ref",
      "true",
    ])
      assert.throws(
        () => evalJobIf(e, main),
        /outside|string|non-string|unexpected|unsupported/,
        e,
      );
  });
  it("reads the push trigger: tags-only never counts, branches-ignore is evaluated, a pattern outside the matcher fails closed", () => {
    assert.equal(readPush({ push: { tags: ["v*"] } })?.counts, false);
    assert.equal(readPush({ push: { branches: ["main"], "tags-ignore": ["**"] } })?.counts, true);
    assert.deepEqual(readPush({ push: { "branches-ignore": ["main"] } })?.refs, ["release/1.0"]);
    assert.equal(readPush({ push: null })?.counts, true);
    assert.equal(readPush({ pull_request: null }), null);
    assert.throws(() => readPush({ push: { branches: ["rel?ase"] } }), /closed matcher/);
  });
});

// ---------------------------------------------------------------------------- the R6 fixtures

describe("R6 fixtures: the passing base", () => {
  it("passes every case", async () => {
    const i = fixture();
    assert.deepEqual(checkReference(i).map(show), []);
    assert.deepEqual(checkWorkflowFilters(i).map(show), []);
    assert.deepEqual(checkJobConditions(i).map(show), []);
    assert.deepEqual((await checkGate(i)).map(show), []);
    assert.deepEqual(checkGitlab(i).map(show), []);
    assert.deepEqual(checkExemptionList(i).map(show), []);
    assert.deepEqual((await checkPullRequestControl(i)).map(show), []);
    assert.deepEqual(checkCacheInvariance(i.reference, i.reference).map(show), []);
    assert.deepEqual(checkCacheNoTriggerFallback(i.reference).map(show), []);
  });
});

describe("R6 (a) the reference", () => {
  it("fails a push trigger with a path filter and no side-effect entry, naming the capability", () => {
    const r = checkReference(fixture({ reference: REF(`${PR}\n${PUSH_FILTERED}`) }));
    assert.match(show(r[0]!), /\(a\) \[reference\] alpha:/);
  });
  it("passes a push-trigger filter with a side-effect entry (pages-deploy)", () => {
    assert.deepEqual(checkReference(fixture()), []);
  });
  it("a capability-level paths: is not inherited by its push trigger", () => {
    const cap = CAP(
      "alpha",
      `    paths:\n      - "src/**"`,
      `      - on: pull-request\n        branches: [main]\n${PUSH}`,
    );
    const i = fixture({
      reference: `capabilities:\n${cap}${CAP("beta", "", PR, "task ci:beta")}${PAGES}`,
    });
    assert.deepEqual(checkReference(i), []);
  });
});

describe("R6 (b) the GitHub workflow files", () => {
  const filtered = BUILD(
    JOB("alpha", "alpha"),
    `    branches: [main, "release/**"]\n    paths:\n      - "src/**"`,
  );
  it("fails a standalone workflow that keeps its push filter, naming the file", () => {
    const r = checkWorkflowFilters(wf("ticket.yml", filtered));
    assert.match(show(r[0]!), /\(b\) \[github\] \.github\/workflows\/ticket\.yml: .*paths:/);
  });
  it("fails paths-ignore, and passes the fixed workflow", () => {
    const ign = BUILD(
      JOB("alpha", "alpha"),
      `    branches: [main]\n    paths-ignore:\n      - "docs/**"`,
    );
    assert.match(show(checkWorkflowFilters(wf("x.yml", ign))[0]!), /paths-ignore/);
    assert.deepEqual(checkWorkflowFilters(wf("x.yml", BUILD(JOBS))), []);
  });
  it("passes pages-deploy through its side-effect entry and fails it once the entry goes", () => {
    assert.deepEqual(checkWorkflowFilters(fixture()), []);
    const r = checkWorkflowFilters(fixture({ exemptions: EXEMPT.replace(/side-effect.*\n/, "") }));
    assert.match(show(r[0]!), /pages\.yml/);
  });
  it("skips a tags-only push and fails closed on a pattern or file it cannot resolve", () => {
    const tags = BUILD(JOB("alpha", "alpha"), `    tags: ["v*"]\n    paths:\n      - "src/**"`);
    assert.deepEqual(checkWorkflowFilters(wf("t.yml", tags)), []);
    assert.match(
      show(checkWorkflowFilters(wf("p.yml", BUILD(JOBS, `    branches: ["re?ease"]`)))[0]!),
      /fail closed/,
    );
    assert.match(show(checkWorkflowFilters(wf("q.yml", "on: [\n"))[0]!), /fail closed/);
  });
  it("fails build.yml when its push lacks release/**", () => {
    const r = checkWorkflowFilters(
      fixture({
        workflows: { ".github/workflows/build.yml": BUILD(JOBS, "    branches: [main]") },
      }),
    );
    assert.match(show(r[0]!), /build\.yml: the push trigger lacks main or release/);
  });
});

describe("R6 (c) job conditions and the gate", () => {
  it("fails a job skipped by a job-level if, naming the job, unless its capability is exempt", () => {
    const skipped = BUILD(
      JOBS + JOB("gamma", "alpha", "    if: github.event_name == 'pull_request'\n"),
    );
    const r = checkJobConditions(wf("build.yml", skipped));
    assert.equal(r.length, 2, "main and the release ref");
    assert.match(
      show(r[0]!),
      /\(c\) \[github\] \.github\/workflows\/build\.yml job 'gamma': does not run on a push to main/,
    );
  });
  it("fails closed on a condition outside the closed grammar, naming the job", () => {
    const r = checkJobConditions(
      wf("build.yml", BUILD(JOB("alpha", "alpha", "    if: contains(github.ref, 'x')\n"))),
    );
    assert.match(show(r[0]!), /job 'alpha': condition outside the closed grammar \(fail closed\)/);
  });
  it("passes the fork guard and evaluates a ref guard for the release ref too", () => {
    const guard = BUILD(JOB("alpha", "alpha", "    if: github.repository == 'crewrig/crewrig'\n"));
    assert.deepEqual(checkJobConditions(wf("build.yml", guard)), []);
    const ref = BUILD(JOB("alpha", "alpha", "    if: github.ref == 'refs/heads/main'\n"));
    assert.match(show(checkJobConditions(wf("build.yml", ref))[0]!), /push to release\/1\.0/);
  });
  it("fails a job whose needs names a skipped job", () => {
    const needs = BUILD(
      JOB("alpha", "alpha", "    needs: [beta]\n") +
        JOB("beta", "alpha", "    if: github.event_name == 'pull_request'\n"),
    );
    assert.match(
      checkJobConditions(wf("build.yml", needs)).map(show).join("\n"),
      /job 'alpha': does not run .* needed job is skipped/,
    );
  });
  it("fails the gate for a capability whose push filter matches nothing, passes the unfiltered one", async () => {
    const bad = fixture({ reference: REF(`${PR}\n${PUSH_FILTERED}`) });
    assert.match(
      show((await checkGate(bad))[0]!),
      /\(c\) \[github\] alpha: the gate decides not to run it/,
    );
    assert.deepEqual(await checkGate(fixture()), []);
  });
});

describe("R6 (d) and (e) GitLab", () => {
  const rule = (extra: string): string =>
    GITLAB(`    - if: '$CI_PIPELINE_SOURCE == "push"'\n${extra}`);
  it("passes an unfiltered push rule", () => assert.deepEqual(checkGitlab(fixture()), []));
  it("fails a push rule that keeps changes:, naming the job", () => {
    const r = checkGitlab(fixture({ gitlab: rule(`      changes: ["src/**"]`) }));
    assert.match(
      show(r[0]!),
      /\(d\) \[gitlab\] alpha: .*push to main: the first true rule carries changes:/,
    );
  });
  it("does not count when: manual, delayed or never, counts always and on_success", () => {
    for (const w of ["manual", "delayed", "never"])
      assert.match(
        show(checkGitlab(fixture({ gitlab: rule(`      when: ${w}`) }))[0]!),
        new RegExp(`when: ${w}`),
      );
    for (const w of ["always", "on_success"])
      assert.deepEqual(checkGitlab(fixture({ gitlab: rule(`      when: ${w}`) })), []);
  });
  it("fails when the workflow rules create no pipeline for a push", () => {
    const g = GITLAB().replace("    - if: '$CI_COMMIT_BRANCH'\n", "");
    assert.match(
      show(checkGitlab(fixture({ gitlab: g }))[0]!),
      /\(d\) \[gitlab\] workflow:rules: no pipeline/,
    );
  });
  it("fails closed on only, except, extends and an unresolvable condition", () => {
    for (const k of ["only: [main]", "except: [tags]", "extends: .tpl"])
      assert.match(
        show(
          checkGitlab(
            fixture({
              gitlab: GITLAB().replace(
                '  script: [echo]\n  rules:\n    - if: \'$CI_PIPELINE_SOURCE == "merge_request_event"\'\n      changes: ["src/**"]\n    - if',
                `  script: [echo]\n  ${k}\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'\n      changes: ["src/**"]\n    - if`,
              ),
            }),
          )[0]!,
        ),
        /\(e\) \[gitlab\] alpha: .*fail closed/,
      );
    const weird = GITLAB(`    - if: '$CI_COMMIT_BRANCH ~~ main'`);
    assert.match(show(checkGitlab(fixture({ gitlab: weird }))[0]!), /\(e\) \[gitlab\] alpha/);
  });
  it("a tags-only job does not run on a branch push", () => {
    const tags = GITLAB(`    - if: '$CI_COMMIT_TAG'`);
    assert.match(
      show(checkGitlab(fixture({ gitlab: tags }))[0]!),
      /\(d\) \[gitlab\] alpha: .*no rule is true/,
    );
  });
});

describe("R6 (f) the exemption list", () => {
  const msg = (e: string): string =>
    checkExemptionList(fixture({ exemptions: e }))
      .map(show)
      .join("\n");
  it("fails an unlisted capability, an empty reason, a missing capability and a stale entry", () => {
    assert.match(msg(EXEMPT.replace(/no-push.*\n/, "")), /capability 'beta': .*\(unlisted\)/);
    assert.match(msg(EXEMPT.replace("Pull-request-only fixture.", "")), /empty reason/);
    assert.match(msg(EXEMPT + "no-push\tgone\tx\n"), /'gone' \(no-push\): names no capability/);
    assert.match(msg(EXEMPT + "no-push\talpha\tx\n"), /'alpha' \(no-push\): stale/);
    assert.match(msg(EXEMPT + "side-effect\talpha\tx\n"), /'alpha' \(side-effect\): stale/);
  });
  it("fails a side-effect entry for a capability that runs a test, printing the reached file", () => {
    const deploy = CAP("deploy", "", `${PR}\n${PUSH_FILTERED}`, "task ci:budget");
    const reference = REF().replace(PAGES, deploy + PAGES);
    const m = checkExemptionList(
      fixture({ reference, exemptions: EXEMPT + "side-effect\tdeploy\tx\n" }),
    )
      .map(show)
      .join("\n");
    assert.match(
      m,
      /'deploy' \(side-effect\): runs a test .*scripts\/tests\/skill-size-budgets\.test\.ts/,
    );
  });
  it("parses and prints the list", () => {
    const p = parseExemptions(EXEMPT);
    assert.deepEqual(formatExemptions(p.entries), EXEMPT.trim().split("\n"));
    assert.match(parseExemptions("bogus\tx\ty\n").problems[0]!, /unknown kind/);
  });
});

describe("R6 (g) the pull-request control and (h) cache invariance", () => {
  it("fails when a pull-request filter is removed on either engine", async () => {
    const noFilter = REF(
      `      - on: pull-request\n        branches: [main]\n        paths:\n          - "**"\n${PUSH}`,
    );
    assert.match(
      show((await checkPullRequestControl(fixture({ reference: noFilter })))[0]!),
      /\(g\)/,
    );
    const gl = GITLAB().replace('      changes: ["src/**"]\n', "");
    assert.match(
      (await checkPullRequestControl(fixture({ gitlab: gl }))).map(show).join("\n"),
      /\(g\) \[gitlab\] alpha: no merge-request rule carries changes/,
    );
  });
  it("cache.files and cache.env are the same before and after the form, and a form that changes either fails", () => {
    const cap = (paths: string, trig: string, cache = "    cache:\n      env: []"): string =>
      `capabilities:\n${CAP("alpha", `${paths}\n${cache}`, trig)}`;
    const before = cap(
      `    paths:\n      - "src/**"`,
      `      - on: pull-request\n        branches: [main]\n${PUSH}`,
    );
    // The form: the push trigger inherits nothing; the capability-level paths stay, so the cache is unchanged.
    assert.deepEqual(checkCacheInvariance(before, before), []);
    // Paths moved from the capability level to the pull-request trigger: cache.files would change.
    const moved = cap(
      "",
      `      - on: pull-request\n        branches: [main]\n        paths:\n          - "src/**"\n${PUSH}`,
    );
    assert.match(
      show(checkCacheInvariance(before, moved)[0]!),
      /\(h\) \[reference\] alpha: the effective cache files changed/,
    );
    // Moved with an explicit cache.files: unchanged.
    const explicit = cap(
      "",
      `      - on: pull-request\n        branches: [main]\n        paths:\n          - "src/**"\n${PUSH}`,
      '    cache:\n      files:\n        - "src/**"\n      env: []',
    );
    assert.deepEqual(checkCacheInvariance(before, explicit), []);
    // A reader that fell back to the trigger paths is caught.
    assert.deepEqual(checkCacheNoTriggerFallback(moved), []);
  });
});

// ------------------------------------------------------------------------------ R7 regression

describe("R7: the job that runs skill-size-budgets.test.ts runs on every push to main on both engines", () => {
  const withBudget = (push: string, gl: string): PushInputs => {
    const ref = `capabilities:\n${CAP("budget", "", `${PR}\n${push}`, "task ci:budget")}`;
    return {
      reference: ref,
      workflows: { ".github/workflows/build.yml": BUILD(JOB("budget", "budget")) },
      gitlab: gl,
      exemptions: "",
      tree: tempTree(TASKS),
      parseYaml,
    };
  };
  const gl = (rule: string): string => `workflow:
  rules:
    - if: '$CI_COMMIT_BRANCH'
budget:
  script: [echo]
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes: ["src/**"]
${rule}
`;
  const OPEN = `    - if: '$CI_PIPELINE_SOURCE == "push"'`;
  it("passes the fixed fixture (an unfiltered push trigger on both engines)", () => {
    assert.deepEqual(checkSkillBudgets(withBudget(PUSH, gl(OPEN)), SKILL_TEST).map(show), []);
  });
  it("fails the #2009-shaped fixture on both engines, naming the job (it detects after the merge, not before)", () => {
    const i = withBudget(PUSH_FILTERED, gl(`${OPEN}\n      changes: ["scripts/**"]`));
    i.workflows[".github/workflows/build.yml"] = BUILD(
      JOB("budget", "budget"),
      `    branches: [main]\n    paths:\n      - "scripts/**"`,
    );
    const out = checkSkillBudgets(i, SKILL_TEST).map(show).join("\n");
    assert.match(
      out,
      /\(r7\) \[github\] \.github\/workflows\/build\.yml job 'budget' \(capability 'budget', runs skill-size-budgets\.test\.ts\)/,
    );
    assert.match(out, /\(r7\) \[gitlab\] budget: job 'budget' does not run unfiltered/);
  });
  it("fails closed when no command reaches the test", () => {
    const i = withBudget(PUSH, gl(OPEN));
    i.tree = tempTree("  ci:budget:\n    cmds:\n      - echo nothing\n");
    assert.match(
      show(checkSkillBudgets(i, SKILL_TEST)[0]!),
      /\(r7\) \[reference\] scripts\/tests\/skill-size-budgets\.test\.ts: no ci:<id> command reaches/,
    );
  });
});

// -------------------------------------------------------------------------------- real tree

function realInputs(): PushInputs {
  const workflows: Record<string, string> = {};
  for (const n of fs.readdirSync(path.join(repo, ".github/workflows")).sort())
    if (n.endsWith(".yml"))
      workflows[`.github/workflows/${n}`] = fs.readFileSync(
        path.join(repo, ".github/workflows", n),
        "utf8",
      );
  return {
    reference: readReference(repo).text,
    workflows,
    gitlab: fs.readFileSync(path.join(repo, ".gitlab-ci.yml"), "utf8"),
    exemptions: fs.readFileSync(path.join(repo, "ci/push-main-exemptions.txt"), "utf8"),
    tree: loadTaskfileTree(repo),
    parseYaml,
  };
}

describe("R6 real tree", () => {
  const real = realInputs();
  it("prints the exemption list", () => {
    const lines = formatExemptions(parseExemptions(real.exemptions).entries);
    console.log(`push-main exemptions (${lines.length}):\n${lines.join("\n")}`);
    assert.equal(lines.length, 12);
  });
  it("(a) the reference, (d) and (e) GitLab, (f) the exemption list, (h) cache invariance", () => {
    assert.deepEqual(checkReference(real).map(show), []);
    assert.deepEqual(checkGitlab(real).map(show), []);
    assert.deepEqual(checkExemptionList(real).map(show), []);
    assert.deepEqual(checkCacheNoTriggerFallback(real.reference).map(show), []);
  });
  it("(c) job conditions and the gate, (g) the pull-request control", async () => {
    assert.deepEqual(checkJobConditions(real).map(show), []);
    assert.deepEqual((await checkGate(real)).map(show), []);
    assert.deepEqual((await checkPullRequestControl(real)).map(show), []);
  });
  it("R7: the job that runs skill-size-budgets.test.ts runs on every push to main on both engines", () => {
    assert.deepEqual(checkSkillBudgets(real, SKILL_TEST).map(show), []);
  });
});
