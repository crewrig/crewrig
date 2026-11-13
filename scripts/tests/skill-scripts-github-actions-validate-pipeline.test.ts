// skill-scripts-github-actions-validate-pipeline.test.ts — black-box test of
// github-actions/scripts/validate-pipeline.ts (spec 0300 R11 as amended by delta-01, R21).
// The six checks run from the same directory; a skipped check is never reported as ran.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  type Envelope,
  checkStates,
  run,
  runJson,
  SKILL_DIR,
  stubTool,
  tempDir,
  WF_CLEAN,
  writeTree,
} from "./lib/skill-scripts-github-actions-cli.ts";

const tmp = tempDir("gha-validate-pipeline-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CHECKS = [
  "lint-workflow",
  "check-pinned-actions",
  "check-permissions",
  "check-pull-request-target",
  "check-expression-injection",
  "check-secrets-exposure",
] as const;
const NO_TOOL_CHECKS = CHECKS.filter((c) => c !== "lint-workflow");

const BAD_PERMISSIONS = `name: t\non: push\njobs:\n  b:\n    runs-on: x\n    steps:\n      - run: echo hi\n`;

let n = 0;
function dir(files: Record<string, string>): string {
  const d = path.join(tmp, `case-${n++}`);
  fs.mkdirSync(d, { recursive: true });
  writeTree(d, files);
  return d;
}
/** A private copy of the skill's scripts/ whose files a test may replace. */
function skillCopy(): string {
  const d = path.join(tmp, `skill-${n++}`);
  fs.cpSync(SKILL_DIR, d, { recursive: true });
  return d;
}
const state = (env: Envelope, check: string): string | undefined => checkStates(env).get(check);
const actionlint = (bin: string, code: number): void => stubTool(bin, "actionlint", `exit ${code}`);

describe("validate-pipeline: the report", () => {
  test("a compliant workflow without actionlint: lint skipped, the other five ran, exit 0", () => {
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(env.ok, true);
    assert.equal(state(env, "lint-workflow"), "skipped", JSON.stringify(env.data));
    for (const c of NO_TOOL_CHECKS) assert.equal(state(env, c), "ran", c);
  });
  test("with an actionlint stub on PATH the lint check runs", () => {
    const bin = path.join(tmp, `bin-${n++}`);
    actionlint(bin, 0);
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, bin: [bin] });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const c of CHECKS) assert.equal(state(env, c), "ran", c);
  });
  test("a failing actionlint is a ran check with an error: exit 1", () => {
    const bin = path.join(tmp, `bin-${n++}`);
    actionlint(bin, 1);
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, bin: [bin] });
    assert.equal(r.status, 1);
    assert.equal(env.ok, false);
    assert.equal(state(env, "lint-workflow"), "ran");
  });
  test("a finding of a check that ran: exit 1 and the finding is carried in the report", () => {
    const d = dir({ "ci.yml": BAD_PERMISSIONS });
    const { r, env } = runJson("validate-pipeline", [path.join(d, "ci.yml")], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.equal(state(env, "check-permissions"), "ran");
    assert.match(JSON.stringify(env), /permissions-missing/);
  });
  test("a warning-only result exits 0", () => {
    const wfFile = path.join(
      dir({ "ci.yml": WF_CLEAN.replace("contents: read", "contents: write") }),
      "ci.yml",
    );
    assert.equal(run("validate-pipeline", [wfFile], { cwd: tmp }).status, 0);
  });
  test("the plain report names every check and its state", () => {
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const r = run("validate-pipeline", [wfFile], { cwd: tmp });
    for (const c of CHECKS) assert.match(r.stdout, new RegExp(c));
    assert.match(r.stdout, /skipped/);
    assert.match(r.stdout, /ran/);
  });
});

describe("validate-pipeline: one input", () => {
  test("two inputs, and - , are usage errors: exit 2", () => {
    const d = dir({ "a.yml": WF_CLEAN, "b.yml": WF_CLEAN });
    assert.equal(
      run("validate-pipeline", [path.join(d, "a.yml"), path.join(d, "b.yml")], { cwd: tmp }).status,
      2,
    );
    assert.equal(run("validate-pipeline", ["-"], { cwd: tmp, input: WF_CLEAN }).status, 2);
    assert.equal(run("validate-pipeline", [], { cwd: tmp }).status, 2);
    assert.equal(run("validate-pipeline", ["--bogus", d], { cwd: tmp }).status, 2);
  });
  test("a usage error names the rule usage under --json", () => {
    const { r, env } = runJson("validate-pipeline", [], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.equal(env.findings[0]?.rule, "usage");
  });
  test("a directory input: a repository root holding .github/workflows is walked from there", () => {
    const d = dir({
      ".github/workflows/ci.yml": WF_CLEAN,
      "unrelated/bad.yml": BAD_PERMISSIONS,
    });
    const { r, env } = runJson("validate-pipeline", [d], { cwd: tmp });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(env.ok, true);
  });
  test("a directory with no .github/workflows is walked from itself", () => {
    const d = dir({ "bad.yml": BAD_PERMISSIONS });
    assert.equal(run("validate-pipeline", [d], { cwd: tmp }).status, 1);
  });
  test("the walk is recursive: a workflow below .github/workflows/ is checked by every check", () => {
    const d = dir({
      ".github/workflows/ci.yml": WF_CLEAN,
      ".github/workflows/nested/deep/bad.yml": BAD_PERMISSIONS,
    });
    const { r, env } = runJson("validate-pipeline", [d], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.match(JSON.stringify(env), /permissions-missing/);
  });
  test("dir-nested-workflow: legacy and new checks see the same file (an unpinned action in the nested file is found too)", () => {
    const d = dir({
      ".github/workflows/ci.yml": WF_CLEAN,
      ".github/workflows/sub/x.yml": BAD_PERMISSIONS.replace(
        "- run: echo hi",
        "- uses: actions/checkout@v4",
      ),
    });
    const { r, env } = runJson("validate-pipeline", [d], { cwd: tmp });
    assert.equal(r.status, 1);
    const all = JSON.stringify(env);
    assert.match(all, /permissions-missing/);
    assert.match(all, /x\.yml/);
    assert.match(all, /sub/);
    assert.match(all, /unpinned|UNPINNED|pin/i);
  });
  test("a single file input", () => {
    const d = dir({ "one.yml": BAD_PERMISSIONS });
    assert.equal(run("validate-pipeline", [path.join(d, "one.yml")], { cwd: tmp }).status, 1);
  });
  test("a composite action file passes every check that ran", () => {
    const d = dir({
      "action.yml": "name: a\ndescription: d\nruns:\n  using: composite\n  steps: []\n",
    });
    assert.equal(run("validate-pipeline", [path.join(d, "action.yml")], { cwd: tmp }).status, 0);
  });
  test("an empty directory is exit 2 and an unreadable path is exit 3", () => {
    const e = dir({});
    const r = run("validate-pipeline", [e], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.match(r.stdout + r.stderr, /no workflow files found under/);
    assert.equal(run("validate-pipeline", [path.join(tmp, "nope.yml")], { cwd: tmp }).status, 3);
  });
});

describe("validate-pipeline: skipped and failed checks", () => {
  test("a check script absent from the directory is skipped with a reason, never ran", () => {
    const skill = skillCopy();
    fs.rmSync(path.join(skill, "scripts", "check-permissions.ts"));
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, skillDir: skill });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(state(env, "check-permissions"), "skipped");
    assert.equal(state(env, "check-pinned-actions"), "ran");
    assert.match(JSON.stringify(env.data), /absent|missing|not found|not present/i);
  });
  test("an absent check cannot hide a violation: the other checks still decide the exit", () => {
    const skill = skillCopy();
    fs.rmSync(path.join(skill, "scripts", "check-expression-injection.ts"));
    const d = dir({ "ci.yml": BAD_PERMISSIONS });
    const { r, env } = runJson("validate-pipeline", [path.join(d, "ci.yml")], {
      cwd: tmp,
      skillDir: skill,
    });
    assert.equal(r.status, 1);
    assert.equal(state(env, "check-expression-injection"), "skipped");
  });
  test("a check that exits 3 is failed, not ran, and the pipeline exits 3", () => {
    const skill = skillCopy();
    fs.writeFileSync(
      path.join(skill, "scripts", "check-permissions.ts"),
      "process.stderr.write('boom\\n');\nprocess.exit(3);\n",
    );
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, skillDir: skill });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.equal(state(env, "check-permissions"), "failed");
    assert.equal(env.ok, false);
  });
  test("a check that exits 2 (a status outside 0 and 1) is failed too", () => {
    const skill = skillCopy();
    fs.writeFileSync(
      path.join(skill, "scripts", "check-pull-request-target.ts"),
      "process.exit(2);\n",
    );
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, skillDir: skill });
    assert.equal(r.status, 3);
    assert.equal(state(env, "check-pull-request-target"), "failed");
  });
  test("a check killed by a signal is failed", () => {
    const skill = skillCopy();
    fs.writeFileSync(
      path.join(skill, "scripts", "check-expression-injection.ts"),
      "process.kill(process.pid, 'SIGKILL');\n",
    );
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, skillDir: skill });
    assert.equal(r.status, 3);
    assert.equal(state(env, "check-expression-injection"), "failed");
  });
  test("an actionlint that cannot spawn makes lint-workflow failed (reserved tool-failed id), exit 3", () => {
    const bin = path.join(tmp, `bin-${n++}`);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "actionlint"), "#!/nonexistent/interpreter\n", { mode: 0o755 });
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, bin: [bin] });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.equal(state(env, "lint-workflow"), "failed");
    assert.equal(env.ok, false);
  });
});

describe("validate-pipeline: secrets are read by exit code only", () => {
  const secretsStub = (code: number, noise: string): string =>
    `process.stdout.write(${JSON.stringify(noise)});process.stderr.write(${JSON.stringify(noise)});process.exit(${code});\n`;
  test("a secrets script exiting 1 with free text: ran with an error, exit 1", () => {
    const skill = skillCopy();
    fs.writeFileSync(
      path.join(skill, "scripts", "check-secrets-exposure.ts"),
      secretsStub(1, "not json at all\n"),
    );
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, skillDir: skill });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(state(env, "check-secrets-exposure"), "ran");
  });
  test("a secrets script exiting 0 whatever it prints (even [FAIL]) passes", () => {
    const skill = skillCopy();
    fs.writeFileSync(
      path.join(skill, "scripts", "check-secrets-exposure.ts"),
      secretsStub(0, "[FAIL] looks bad but exit 0\n"),
    );
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    const { r, env } = runJson("validate-pipeline", [wfFile], { cwd: tmp, skillDir: skill });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(state(env, "check-secrets-exposure"), "ran");
  });
  test("a secrets script with --json absent from its contract is never given --json", () => {
    // it must work with the shipped script, which has no --json: the real run is the proof
    const wfFile = path.join(dir({ "ci.yml": WF_CLEAN }), "ci.yml");
    assert.equal(
      state(runJson("validate-pipeline", [wfFile], { cwd: tmp }).env, "check-secrets-exposure"),
      "ran",
    );
  });
});

describe("validate-pipeline: contract", () => {
  test("it writes nothing: the input tree is unchanged", () => {
    const d = dir({ ".github/workflows/ci.yml": WF_CLEAN });
    const list = (): string[] => fs.readdirSync(d, { recursive: true, encoding: "utf8" }).sort();
    const before = list();
    run("validate-pipeline", [d], { cwd: tmp });
    assert.deepEqual(list(), before);
  });
  test("--json is one envelope {ok, data, findings}", () => {
    const d = dir({ "ci.yml": WF_CLEAN });
    const { r, env } = runJson("validate-pipeline", [path.join(d, "ci.yml")], { cwd: tmp });
    assert.deepEqual(Object.keys(env).sort(), ["data", "findings", "ok"]);
  });
  test("--help prints usage on stdout, exit 0, empty stderr", () => {
    const r = run("validate-pipeline", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
  });
});
