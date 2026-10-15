// windows-skill-cases.ts — the cases of the cross-system proof of the eleven skill entries (spec 0258
// R27, parent R17), run once per leg by windows-skill-scripts.test.ts. Each case runs an entry through
// the leg's interpreter (see windows-skill-proof.ts) and asserts observable outcomes only: exit status,
// stdout, stderr and the calls the stub wrapped tools recorded. Paths are relative to the sandbox
// `work` directory with forward slashes, so the printed paths are the same on every system.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { land } from "./windows-packaging-driver.ts";
import { attempt, calls, childDirs, exec, findable } from "./windows-skill-proof.ts";
import type { Ctx, Exec } from "./windows-skill-proof.ts";
import { expectStatus, why } from "./windows-proof-support.ts";
import type { Run } from "./windows-proof-support.ts";

const SKILLS = path.resolve(import.meta.dirname, "..", "..", "..", "artifacts", "core", "skills");
export const entry = (skill: string, name: string): string =>
  path.join(SKILLS, skill, "scripts", `${name}.ts`);
const GHA = (name: string): string => entry("github-actions", name);
const GLC = (name: string): string => entry("gitlab-ci", name);
const PRR = (name: string): string => entry("pr-reviewer", name);

const SHA = "a".repeat(40);
const WORKFLOW = (uses: string): string =>
  `name: ci\r\non: push\r\njobs:\r\n  b:\r\n    runs-on: x\r\n    steps:\r\n      - name: c\r\n        uses: ${uses}\r\n`;

function write(c: Ctx, rel: string, text: string): string {
  const file = path.join(c.box.work, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return rel;
}

const run = (c: Ctx, script: string, args: string[], o: Exec = {}): Run => exec(c, script, args, o);
const stdoutIs = (r: Run, want: string): void => assert.equal(r.out, want, why(r, "stdout"));
/** The summary line on stderr; a shell leg may add its own host lines, so it is searched, not compared. */
const stderrIs = (r: Run, want: string): void =>
  assert.ok(r.err.includes(want), why(r, `stderr holds ${JSON.stringify(want)}`));
const ok = (r: Run): void => {
  expectStatus(r, 0);
  stdoutIs(r, "");
};

function textScans(c: Ctx): void {
  write(c, "gh-ok/.github/workflows/ci.yml", WORKFLOW(`actions/checkout@${SHA}`));
  write(c, "gh-bad/.github/workflows/ci.yml", WORKFLOW("actions/checkout@v4"));
  write(
    c,
    "gh-risk/.github/workflows/ci.yml",
    "jobs:\r\n  b:\r\n    steps:\r\n      - run: set -x\r\n",
  );
  write(c, "gl-ok/.gitlab-ci.yml", "image: alpine:3@sha256:" + "b".repeat(64) + "\n");
  write(c, "gl-bad/.gitlab-ci.yml", "image: alpine:3\r\nbuild:\r\n  script:\r\n    - set -x\r\n");
  attempt(c, "ws-check-pinned-actions", () => {
    const good = run(c, GHA("check-pinned-actions"), ["gh-ok"]);
    expectStatus(good, 0);
    stdoutIs(good, "[OK] all action references are pinned to a SHA\n");
    const bad = run(c, GHA("check-pinned-actions"), ["gh-bad"]);
    expectStatus(bad, 1);
    stdoutIs(bad, "[UNPINNED] gh-bad/.github/workflows/ci.yml:8: actions/checkout@v4\n");
    stderrIs(bad, "1 unpinned action reference(s) found\n");
  });
  attempt(c, "ws-check-secrets-exposure-github", () => {
    const good = run(c, GHA("check-secrets-exposure"), ["gh-ok"]);
    expectStatus(good, 0);
    stdoutIs(good, "[OK] no secret-exposure patterns detected\n");
    const bad = run(c, GHA("check-secrets-exposure"), ["gh-risk"]);
    expectStatus(bad, 1);
    stdoutIs(
      bad,
      "[RISK] gh-risk/.github/workflows/ci.yml:4: set -x / set +x\n       why: shell xtrace prints every expanded command, including secret env values\n",
    );
    stderrIs(bad, "1 risky pattern(s) found\n");
  });
  attempt(c, "ws-check-pinned-images", () => {
    const good = run(c, GLC("check-pinned-images"), ["gl-ok"]);
    expectStatus(good, 0);
    stdoutIs(good, "[OK] all image/service references are pinned to a @sha256: digest\n");
    const bad = run(c, GLC("check-pinned-images"), ["gl-bad"]);
    expectStatus(bad, 1);
    stdoutIs(bad, "[UNPINNED] gl-bad/.gitlab-ci.yml:1: alpine:3\n");
    stderrIs(bad, "1 unpinned image/service reference(s) found\n");
  });
  attempt(c, "ws-check-secrets-exposure-gitlab", () => {
    const good = run(c, GLC("check-secrets-exposure"), ["gl-ok"]);
    expectStatus(good, 0);
    stdoutIs(good, "[OK] no secret-exposure patterns detected\n");
    const bad = run(c, GLC("check-secrets-exposure"), ["gl-bad"]);
    expectStatus(bad, 1);
    stdoutIs(
      bad,
      "[RISK] gl-bad/.gitlab-ci.yml:4: set -x / set +x\n       why: shell xtrace prints every expanded command, including secret variable values\n",
    );
    stderrIs(bad, "1 risky pattern(s) found\n");
  });
  attempt(c, "ws-usage-refusals", () => {
    for (const script of [
      GHA("check-pinned-actions"),
      GHA("check-secrets-exposure"),
      GLC("check-pinned-images"),
      GLC("check-secrets-exposure"),
      GHA("lint-workflow"),
      GHA("simulate-job"),
      GHA("simulate-workflow"),
    ]) {
      const res = run(c, script, []);
      expectStatus(res, 2);
      assert.match(res.err, /^Usage: [a-z-]+\.ts /, why(res, "usage line"));
    }
  });
}

function wrapped(c: Ctx): void {
  const ci = write(c, "wf/.github/workflows/ci.yml", WORKFLOW(`actions/checkout@${SHA}`));
  write(c, "wf/.github/workflows/FAILME.yml", WORKFLOW("x@y"));
  const { box } = c;
  attempt(c, "ws-lint-workflow", () => {
    const res = run(c, GHA("lint-workflow"), ["wf"]);
    expectStatus(res, 1);
    stdoutIs(
      res,
      "actionlint-stub -no-color wf/.github/workflows/FAILME.yml\n[FAIL] wf/.github/workflows/FAILME.yml\n" +
        "actionlint-stub -no-color wf/.github/workflows/ci.yml\n[OK] wf/.github/workflows/ci.yml\n",
    );
    const one = run(c, GHA("lint-workflow"), [ci]);
    expectStatus(one, 0);
    assert.equal(calls(box).length, 3, "three actionlint calls");
    const gone = run(c, GHA("lint-workflow"), [ci], { dirs: [] });
    expectStatus(gone, 0);
    assert.match(gone.out, /^\[SKIP\] actionlint not found/, why(gone, "skip note"));
  });
  attempt(c, "ws-simulate-job", () => {
    const res = run(c, GHA("simulate-job"), [ci, "b", "pull_request"]);
    expectStatus(res, 0);
    const cmd = `pull_request --workflows ${ci} --job b --dryrun`;
    stdoutIs(res, `+ act ${cmd}\nact-stub ${cmd}\n`);
    const code = run(c, GHA("simulate-job"), [ci, "b"], { env: { STUB_ACT_EXIT: "3" } });
    expectStatus(code, 3);
    const down = run(c, GHA("simulate-job"), [ci, "b"], { env: { STUB_DOCKER: "down" } });
    expectStatus(down, 0);
    assert.match(down.out, /^\[SKIP\] Docker daemon not reachable/, why(down, "daemon note"));
    const noAct = run(c, GHA("simulate-job"), [ci, "b"], { dirs: [] });
    assert.match(noAct.out, /^\[SKIP\] act not found/, why(noAct, "act note"));
    const missing = run(c, GHA("simulate-job"), ["nope.yml", "b"]);
    expectStatus(missing, 1);
    stderrIs(missing, "[FAIL] workflow file not found: nope.yml\n");
  });
  attempt(c, "ws-simulate-workflow", () => {
    const res = run(c, GHA("simulate-workflow"), [ci]);
    expectStatus(res, 0);
    const m = /^\+ act push --workflows (\S+) --eventpath (\S+) --dryrun\nact-stub push /.exec(
      res.out,
    );
    assert.ok(m !== null, why(res, "command line"));
    const payload = m[2] as string;
    assert.match(path.basename(payload), /^act-payload\.[0-9a-f]{12}\.json$/, why(res, "name"));
    assert.equal(fs.existsSync(payload), false, `${payload} is removed on exit`);
    assert.deepEqual(
      fs.readdirSync(box.tmp).filter((n) => n.startsWith("act-payload.")),
      [],
    );
    const copy = path.join(box.stubs, "payload-copy.json");
    land(c.proof, copy);
    assert.equal(
      fs.readFileSync(copy, "latin1"),
      '{"ref":"refs/heads/main"}\n',
      "the default payload",
    );
    const given = write(c, "payload.json", '{"inputs":{}}\n');
    const own = run(c, GHA("simulate-workflow"), [ci, "workflow_dispatch", given]);
    expectStatus(own, 0);
    stdoutIs(
      own,
      `+ act workflow_dispatch --workflows ${ci} --eventpath ${given} --dryrun\nact-stub workflow_dispatch --workflows ${ci} --eventpath ${given} --dryrun\n`,
    );
    assert.equal(fs.existsSync(path.join(box.work, given)), true, "a given payload is kept");
    // A hosted Windows runner may ship a real `docker.exe` in System32: leave that directory out,
    // and prove on every host that no `docker` is resolvable from the directories left.
    const bare = { dirs: [box.binAct], system: false } as const;
    assert.deepEqual(findable("docker", childDirs(box, bare)), [], "no docker on the child PATH");
    const noDocker = run(c, GHA("simulate-workflow"), [ci], bare);
    assert.match(noDocker.out, /^\[SKIP\] docker CLI not found/, why(noDocker, "docker note"));
  });
  attempt(c, "ws-docker-exe-through-pathext", () => {
    // `docker` is a copy of the node binary: an `.exe` on Windows, found only through PATHEXT.
    const res = run(c, GHA("simulate-job"), [ci, "b"], { dirs: [box.binNode, box.binAct] });
    expectStatus(res, 0);
    assert.match(
      res.out,
      /^\[SKIP\] Docker daemon not reachable/,
      why(res, "found, spawned, refused"),
    );
  });
  write(c, "FAILME.md", "# t\n");
  write(c, "ok.md", "# t\n");
  attempt(c, "ws-lint-markdown", () => {
    ok(run(c, PRR("lint-markdown"), ["ok.md"]));
    const bad = run(c, PRR("lint-markdown"), ["ok.md", "FAILME.md"]);
    expectStatus(bad, 1);
    stdoutIs(bad, "FAILME.md:1: markdownlint stub finding\n");
    assert.deepEqual(calls(box).at(-1)?.args, ["ok.md", "FAILME.md"]);
    const none = run(c, PRR("lint-markdown"), []);
    stdoutIs(none, "lint-markdown.ts: no files supplied — nothing to check.\n");
    const gone = run(c, PRR("lint-markdown"), ["ok.md"], { dirs: [] });
    expectStatus(gone, 0);
    assert.match(gone.out, /^lint-markdown\.ts: markdownlint not found/, why(gone, "skip note"));
    assert.deepEqual(
      fs.readdirSync(box.tmp).filter((n) => n.startsWith("lint-markdown.")),
      [],
    );
  });
  write(c, "ok.py", "x = 1\n");
  write(c, "FAILME.py", "x = 1\n");
  write(c, "app.py", 'print("x")\r\n');
  attempt(c, "ws-lint-python", () => {
    const viaRuff = run(c, PRR("lint-python"), ["ok.py"], { dirs: [box.binRuff, box.bin] });
    ok(viaRuff);
    assert.deepEqual(calls(box), [{ tool: "ruff", args: ["check", "ok.py"] }]);
    const viaFlake8 = run(c, PRR("lint-python"), ["ok.py", "FAILME.py"]);
    expectStatus(viaFlake8, 1);
    stdoutIs(viaFlake8, "FAILME.py:1: flake8 stub finding\n");
    const bare = run(c, PRR("lint-python"), ["app.py"]);
    expectStatus(bare, 1);
    stdoutIs(bare, "app.py:1: bare print() in non-test file\n");
    const gone = run(c, PRR("lint-python"), ["ok.py"], { dirs: [] });
    expectStatus(gone, 0);
    assert.match(gone.out, /^lint-python\.ts: neither ruff nor flake8 found/, why(gone, "note"));
  });
}

function lintJson(c: Ctx): void {
  write(c, "good.json", '{"a":1}\r\n');
  write(c, "broken.json", '{"a":');
  write(c, "comma.json", '{"a":[{"b":1,}]}\r\n');
  attempt(c, "ws-lint-json", () => {
    ok(run(c, PRR("lint-json"), ["good.json"]));
    const broken = run(c, PRR("lint-json"), ["broken.json", "nope.json"]);
    expectStatus(broken, 1);
    assert.match(broken.out, /^broken\.json: invalid JSON — .+\nnope\.json: not a regular file\n$/);
    const comma = run(c, PRR("lint-json"), ["comma.json"]);
    expectStatus(comma, 1);
    assert.match(
      comma.out,
      /^comma\.json: invalid JSON — .+\ncomma\.json:1: trailing comma before \} or \]\n$/,
    );
  });
  attempt(c, "ws-lint-json-stdin", () => {
    ok(run(c, PRR("lint-json"), [], { stdin: '{"a":[1,2]}\n' }));
    const bad = run(c, PRR("lint-json"), [], { stdin: '{"a":[{"b":1,}]}\n' });
    expectStatus(bad, 1);
    assert.match(
      bad.out,
      /^<stdin>: invalid JSON — .+\n<stdin>:1: trailing comma before \} or \]\n$/,
    );
  });
}

export { lintJson, textScans, wrapped };
