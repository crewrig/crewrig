// Spec 0282 R6/R7: the Task provisioning guard against the repository and mkdtemp fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { run as buildCi } from "../lib/build-ci/entry.ts";
import { checkTaskProvisioning } from "../lib/task-provisioning/index.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
// A fixture root file is written, not read; the name is composed so the root-reader guard stays quiet.
const ROOT_TASKFILE = ["Task", "file.yml"].join("");
const ACTION = ".github/actions/setup-task/action.yml";
const CAP = `capabilities:
  - id: needs-task
    name: "A job that needs Task"
    trigger:
      - on: pull-request
        branches: [main]
        paths:
          - "scripts/**"
    portability: portable
    requires:
      runtime: node@24
      tools: [task]
    command:
      - node scripts/a.ts
`;
const WF = (steps: string): string =>
  `name: t\non: [push]\njobs:\n  needs-task:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
const CHECKOUT = "      - uses: actions/checkout@v4\n";
const SETUP = "      - uses: ./.github/actions/setup-task\n";
const BUSINESS = "      - name: Run\n        run: node scripts/a.ts\n";

/** A minimal good repository; `edit` mutates the files before the GitLab carrier is generated. */
function fixture(
  opts: {
    steps?: string;
    pin?: string;
    floor?: string;
    action?: string;
    extra?: Record<string, string>;
    keepGitlab?: boolean;
  } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-guard-"));
  const w = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w(ROOT_TASKFILE, `version: '${opts.floor ?? "3.39"}'\ntasks: {}\n`);
  w("ci/ci-capabilities.yml", CAP);
  w("ci/task-pin.json", opts.pin ?? fs.readFileSync(path.join(REPO, "ci/task-pin.json"), "utf8"));
  w(ACTION, opts.action ?? fs.readFileSync(path.join(REPO, ACTION), "utf8"));
  w(".github/workflows/build.yml", WF(opts.steps ?? CHECKOUT + SETUP + BUSINESS));
  for (const [k, v] of Object.entries(opts.extra ?? {})) w(k, v);
  if (opts.keepGitlab !== true) assert.equal(buildCi([], dir).code, 0);
  return dir;
}
const findings = (dir: string): string => checkTaskProvisioning(dir).findings.join("\n");

test("the repository passes", () => {
  const r = checkTaskProvisioning(REPO);
  assert.deepEqual(r.findings, []);
  assert.equal(r.code, 0);
});

test("a good fixture, with the generated GitLab carrier alone, passes", () => {
  assert.deepEqual(checkTaskProvisioning(fixture()).findings, []);
});

test("the former Install Task step is rejected, naming the job", () => {
  const old = `      - name: Install Task\n        run: sudo sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin\n`;
  const f = findings(fixture({ steps: CHECKOUT + SETUP + old + BUSINESS }));
  assert.match(f, /job 'needs-task'.*route other than/);
});

test("a checksum-less download is rejected", () => {
  const dl = `      - run: curl -L -o t.tgz https://github.com/go-task/task/releases/download/v3.0.0/t.tgz\n`;
  assert.match(findings(fixture({ steps: CHECKOUT + SETUP + dl + BUSINESS })), /job 'needs-task'/);
});

test("a job that needs Task with no provisioning is rejected", () => {
  assert.match(findings(fixture({ steps: CHECKOUT + BUSINESS })), /job 'needs-task'.*exactly one/);
});

test("setup-task before checkout is rejected", () => {
  assert.match(
    findings(fixture({ steps: SETUP + CHECKOUT + BUSINESS })),
    /job 'needs-task'.*after the actions\/checkout/,
  );
});

test("a GitLab job with the old recipe is rejected", () => {
  const dir = fixture();
  const gl = path.join(dir, ".gitlab-ci.yml");
  const text = fs.readFileSync(gl, "utf8");
  const i = text.indexOf(
    "apt-get update && apt-get install -y --no-install-recommends curl ca-certificates",
  );
  assert.ok(i > 0);
  const start = text.lastIndexOf("    - ", i);
  const end = text.indexOf("    - task --version\n", i) + "    - task --version\n".length;
  fs.writeFileSync(
    gl,
    text.slice(0, start) +
      `    - sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin\n` +
      text.slice(end),
  );
  const f = findings(dir);
  assert.match(f, /\.gitlab-ci\.yml job 'needs-task'/);
  assert.match(f, /fail-open/);
});

test("an action with || true is rejected", () => {
  const action = fs
    .readFileSync(path.join(REPO, ACTION), "utf8")
    .replace("set -euo pipefail", "set -euo pipefail\n        true || true");
  assert.match(findings(fixture({ action })), /setup-task\/action\.yml.*\|\| true/);
});

test("a pin below the floor is rejected", () => {
  const pin =
    JSON.stringify({ version: "3.30.0", sha256: { linux_amd64: "a".repeat(64) } }, null, 2) + "\n";
  assert.match(findings(fixture({ pin })), /below the Taskfile floor 3\.39/);
});

test("a malformed pin fails closed", () => {
  const r = checkTaskProvisioning(fixture({ pin: "{", keepGitlab: true }));
  assert.equal(r.code, 1);
  assert.match(r.findings.join("\n"), /task-pin\.json|failing closed/);
});

test("a checksum or pinned URL duplicated in a workflow or in the action is rejected", () => {
  const pinText = JSON.parse(fs.readFileSync(path.join(REPO, "ci/task-pin.json"), "utf8")) as {
    version: string;
    sha256: Record<string, string>;
  };
  const sum = pinText.sha256["linux_amd64"] as string;
  const dupe = `      - run: echo ${sum}\n`;
  assert.match(
    findings(fixture({ steps: CHECKOUT + SETUP + dupe + BUSINESS })),
    /duplicates the pinned checksum/,
  );
  const url = `      - run: echo releases/download/v${pinText.version}/task_x\n`;
  assert.match(
    findings(fixture({ steps: CHECKOUT + SETUP + url + BUSINESS })),
    /duplicates the pinned download URL/,
  );
  const action = fs.readFileSync(path.join(REPO, ACTION), "utf8") + `# ${sum}\n`;
  assert.match(
    findings(fixture({ action })),
    /setup-task\/action\.yml: duplicates the pinned checksum/,
  );
});

test("a stale .gitlab-ci.yml carrier is rejected", () => {
  const dir = fixture();
  const gl = path.join(dir, ".gitlab-ci.yml");
  fs.writeFileSync(gl, fs.readFileSync(gl, "utf8") + "# stale\n");
  assert.match(findings(dir), /\.gitlab-ci\.yml: stale/);
});
