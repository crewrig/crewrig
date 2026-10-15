// skill-scripts-cases-github-sim.ts — the case tables of github-actions/lint-workflow and
// simulate-job (spec 0258 R28, plan step 8). The external tools (`actionlint`,
// `act`, `docker`) are stubs written into the sandbox `bin/`; a tool is absent when it has no stub.
//
// `find` lists a directory in directory order, which no golden can pin (deviation (b)): a lint case
// that scans a directory therefore holds exactly ONE workflow file.

import type { SkillCase } from "./skill-scripts-observe.ts";

export const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;
export const WF = lines(
  "name: ci",
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: x",
  "    steps: []",
);
export const TERM = "kill -TERM $$\n";

// --- lint-workflow -------------------------------------------------------------------------

const LINT = "github-actions/lint-workflow";
const AL_OK = "echo 'actionlint: nothing to report'\necho 'actionlint: a note' >&2\nexit 0\n";
const AL_FAIL = 'echo "$2:3:5: error: bad expression"\necho "actionlint: 1 error" >&2\nexit 1\n';
const OK = { actionlint: AL_OK };
const FAIL = { actionlint: AL_FAIL };

function lint(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: LINT, ...c };
}
const lintFile = (name: string, stubs: Record<string, string>, body = WF): SkillCase =>
  lint(name, { args: ["wf.yml"], files: { "wf.yml": body }, stubs });

export const LINT_WORKFLOW: readonly SkillCase[] = [
  // arguments (the count check precedes the actionlint check)
  lint("no-argument", {}),
  lint("no-argument-with-actionlint", { stubs: OK }),
  lint("two-arguments", { args: ["a.yml", "b.yml"], stubs: OK }),
  lint("two-arguments-without-actionlint", { args: ["a.yml", "b.yml"] }),

  // actionlint absent: the skip comes BEFORE the target check
  lintFile("skip-without-actionlint", {}),
  lint("skip-without-actionlint-missing-target", { args: ["missing.yml"] }),
  lint("skip-without-actionlint-empty-argument", { args: [""] }),
  lint("skip-without-actionlint-directory", { args: ["repo"], files: { "repo/a.yml": WF } }),
  lint("skip-without-actionlint-empty-directory", { args: ["empty"], dirs: ["empty"] }),

  // targets, with a passing stub
  lint("missing-target", { args: ["missing.yml"], stubs: OK }),
  lint("empty-argument", { args: [""], stubs: OK }),
  lint("empty-directory", { args: ["empty"], dirs: ["empty"], stubs: OK }),
  lint("empty-workflows-directory", {
    args: ["repo"],
    dirs: ["repo/.github/workflows"],
    stubs: OK,
  }),
  lint("directory-without-yaml", {
    args: ["repo"],
    files: { "repo/.github/workflows/readme.md": "x\n", "repo/other.txt": "x\n" },
    stubs: OK,
  }),
  lint("absolute-path", { args: ["{WORK}/wf.yml"], files: { "wf.yml": WF }, stubs: OK }),
  lint("spaces-in-path", { args: ["my wf.yml"], files: { "my wf.yml": WF }, stubs: OK }),
  lint("file-uppercase-name", { args: ["CI.YML"], files: { "CI.YML": WF }, stubs: OK }),
  lint("file-in-subdirectory", { args: ["a/b/wf.yaml"], files: { "a/b/wf.yaml": WF }, stubs: OK }),

  // a single file
  lintFile("file-passes", OK),
  lintFile("file-fails", FAIL),
  lintFile("file-empty", OK, ""),
  lintFile("file-passthrough-streams", {
    actionlint: "echo out-line\necho err-line >&2\necho out-line-2\nexit 0\n",
  }),
  lintFile("file-fails-passthrough-streams", {
    actionlint: "echo out-line\necho err-line >&2\nexit 1\n",
  }),
  lintFile("file-fails-with-status-2", { actionlint: "echo problem >&2\nexit 2\n" }),
  lintFile("file-fails-with-status-127", { actionlint: "exit 127\n" }),
  lintFile("file-silent-pass", { actionlint: "exit 0\n" }),
  lintFile("file-actionlint-killed", { actionlint: TERM, deviation: "(o)" }), // bash prints `Terminated` on stderr; the entry prints none
  lint("symlink-as-target", {
    args: ["link.yml"],
    files: { "real.yml": WF },
    links: { "link.yml": "real.yml" },
    stubs: OK,
  }),

  // a directory, always with one workflow file
  lint("dir-passes", {
    args: ["repo"],
    files: { "repo/.github/workflows/ci.yml": WF },
    stubs: OK,
  }),
  lint("dir-fails", {
    args: ["repo"],
    files: { "repo/.github/workflows/ci.yml": WF },
    stubs: FAIL,
  }),
  lint("dir-ignores-yaml-outside-workflows", {
    args: ["repo"],
    files: { "repo/.github/workflows/ci.yaml": WF, "repo/other/x.yml": WF },
    stubs: OK,
  }),
  lint("dir-without-workflows-falls-back", {
    args: ["repo"],
    files: { "repo/a.yml": WF, "repo/notes.txt": "x\n" },
    stubs: OK,
  }),
  lint("dir-fallback-includes-github-dir", {
    args: ["repo"],
    files: { "repo/.github/x.yml": WF },
    stubs: OK,
  }),
  lint("dir-nested-workflow", {
    args: ["repo"],
    files: { "repo/.github/workflows/sub/deep.yml": WF },
    stubs: OK,
  }),
  lint("dir-trailing-slash", {
    args: ["repo/"],
    files: { "repo/.github/workflows/ci.yml": WF },
    stubs: OK,
  }),
  lint("dir-trailing-slash-fallback", { args: ["repo/"], files: { "repo/a.yml": WF }, stubs: OK }),
  lint("dir-uppercase-extension", {
    args: ["repo"],
    files: { "repo/.github/workflows/CI.YML": WF },
    stubs: OK,
  }),
  lint("dir-symlink-ignored", {
    args: ["repo"],
    files: { "outside.yml": WF },
    links: { "repo/.github/workflows/link.yml": "../../../outside.yml" },
    stubs: OK,
  }),
];

// --- simulate-job --------------------------------------------------------------------------

const JOB = "github-actions/simulate-job";
const ACT_OK = "echo 'act: dry run done'\nexit 0\n";
export const DOCKER_OK = "echo 'docker: daemon info' \necho 'docker: warning' >&2\nexit 0\n";
const READY = { act: ACT_OK, docker: DOCKER_OK };

function job(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: JOB, files: { "wf.yml": WF }, ...c };
}

export const SIMULATE_JOB: readonly SkillCase[] = [
  // arguments
  job("no-argument", {}),
  job("one-argument", { args: ["wf.yml"] }),
  job("four-arguments", { args: ["wf.yml", "build", "push", "extra"], stubs: READY }),
  job("empty-arguments", { args: ["", ""], stubs: READY }),
  job("help-flag", { args: ["--help"] }),

  // the event default
  job("two-arguments-default-event", { args: ["wf.yml", "build"], stubs: READY }),
  job("three-arguments", { args: ["wf.yml", "build", "pull_request"], stubs: READY }),
  job("empty-event-defaults-to-push", { args: ["wf.yml", "build", ""], stubs: READY }),
  job("unknown-event", { args: ["wf.yml", "build", "no_such_event"], stubs: READY }),
  job("event-with-spaces", { args: ["wf.yml", "build", "a b"], stubs: READY }),
  job("empty-job-id", { args: ["wf.yml", ""], stubs: READY }),
  job("job-id-with-spaces", { args: ["wf.yml", "my job"], stubs: READY }),
  job("workflow-with-spaces", {
    args: ["my wf.yml", "build"],
    files: { "my wf.yml": WF },
    stubs: READY,
  }),
  job("absolute-workflow-path", { args: ["{WORK}/wf.yml", "build"], stubs: READY }),
  job("symlink-workflow", {
    args: ["link.yml", "build"],
    links: { "link.yml": "wf.yml" },
    stubs: READY,
  }),

  // the preconditions, in order
  job("workflow-missing", { args: ["missing.yml", "build"], stubs: READY }),
  job("workflow-missing-without-tools", { args: ["missing.yml", "build"] }),
  job("workflow-is-a-directory", { args: ["adir", "build"], dirs: ["adir"], stubs: READY }),
  job("act-absent", { args: ["wf.yml", "build"], stubs: { docker: DOCKER_OK } }),
  job("act-and-docker-absent", { args: ["wf.yml", "build"] }),
  job("docker-absent", { args: ["wf.yml", "build"], stubs: { act: ACT_OK } }),
  job("docker-info-fails", {
    args: ["wf.yml", "build"],
    stubs: { act: ACT_OK, docker: "echo daemon down >&2\nexit 1\n" },
  }),
  job("docker-info-fails-status-125", {
    args: ["wf.yml", "build"],
    stubs: { act: ACT_OK, docker: "exit 125\n" },
  }),

  // the act call
  job("act-succeeds", { args: ["wf.yml", "build"], stubs: READY }),
  job("act-succeeds-silently", {
    args: ["wf.yml", "build"],
    stubs: { act: "exit 0\n", docker: "exit 0\n" },
  }),
  job("act-exits-3", {
    args: ["wf.yml", "build"],
    stubs: { act: "echo act-out\necho act-err >&2\nexit 3\n", docker: DOCKER_OK },
  }),
  job("act-exits-1", {
    args: ["wf.yml", "build"],
    stubs: { act: "exit 1\n", docker: DOCKER_OK },
  }),
  job("act-exits-127", {
    args: ["wf.yml", "build"],
    stubs: { act: "exit 127\n", docker: DOCKER_OK },
  }),
  job("act-killed-by-term", {
    deviation: "(o)", // bash prints its own `Terminated` job message on stderr; the entry prints none
    args: ["wf.yml", "build"],
    stubs: { act: `echo before-kill\n${TERM}`, docker: DOCKER_OK },
  }),
  job("act-passthrough-streams", {
    args: ["wf.yml", "build", "push"],
    stubs: { act: "echo line-1\necho err-1 >&2\necho line-2\nexit 0\n", docker: DOCKER_OK },
  }),
];
