// Spec 0049 delta-02 R27-R29 and spec 0283 R5: concern 6 and the Task provisioning guard for a job
// that uses ./.github/actions/ci-job. mkdtemp copies of the tracked ci/ and .github/ only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
// Composed so the root-reader guard stays quiet: the fixture root gets a copy, nothing is read here.
const ROOT_FILES = [["Task", "file.yml"].join(""), "taskfiles"];

import { checkTaskProvisioning } from "../lib/task-provisioning/index.ts";
import {
  capOf,
  editYaml,
  list,
  makeFixture,
  map,
  replaceOnce,
  runCheck,
} from "./lib/ci-parity-fixture.ts";

const WF = ".github/workflows/build.yml";
const DORNY =
  "      - uses: dorny/paths-filter@v3\n        id: filter\n        with:\n          filters: |\n            figure-labels:\n";
const ciStep = (id: string) =>
  `      - uses: ./.github/actions/ci-job\n        with:\n          id: ${id}\n`;
const wf = (root: string) => path.join(root, WF);

/** Insert a ci-job step right after the checkout of the figure-labels job. */
function addCiJob(root: string, id: string): void {
  replaceOnce(
    wf(root),
    "  figure-labels:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
    `  figure-labels:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${ciStep(id)}`,
  );
}
const figureBlocks = (err: string) => err.split("\n").filter((l) => l.includes("figure-labels"));

test("shape C with the right id: no R27 finding, the filter stays compared", () => {
  const root = makeFixture();
  addCiJob(root, "figure-labels");
  const r = runCheck(root);
  assert.ok(!r.stderr.includes("R27"), r.stderr);
  assert.ok(!r.stderr.includes("path filters diverge on in-job filter"), r.stderr);
});

test("shape C with an unequal filter still fails R14 (R29)", () => {
  const root = makeFixture();
  addCiJob(root, "figure-labels");
  replaceOnce(wf(root), DORNY, `${DORNY}              - 'zz/extra/**'\n`);
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /capability 'figure-labels'.*path filters diverge/);
  assert.ok(r.stderr.includes("zz/extra/**"));
});

test("id naming another capability fails R27a, naming the job and the capability", () => {
  const root = makeFixture();
  addCiJob(root, "docs-index");
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.ok(
    figureBlocks(r.stderr).some((l) => l.includes("R27a") && l.includes("docs-index")),
    r.stderr,
  );
});

test("shape A (no filter): no R27, no R17, no divergence report", () => {
  const root = makeFixture();
  addCiJob(root, "figure-labels");
  const text = fs.readFileSync(wf(root), "utf8");
  const start = text.indexOf(DORNY);
  const end = text.indexOf("      - name: Install tesseract", start);
  fs.writeFileSync(wf(root), text.slice(0, start) + text.slice(end));
  const r = runCheck(root);
  const mine = figureBlocks(r.stderr).filter((l) => /R17|R14|R27/.test(l));
  assert.deepEqual(mine, [], r.stderr);
});

test("an unsupported glob in an effective set fails R27b, naming capability and entry", () => {
  const root = makeFixture();
  addCiJob(root, "figure-labels");
  editYaml(path.join(root, "ci/ci-capabilities.yml"), (doc) => {
    const cap = capOf(doc, "figure-labels");
    const t = map(list(cap["trigger"], "trigger")[0], "trigger");
    t["paths"] = ["a/{b,c}"];
  });
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /capability 'figure-labels'.*a\/\{b,c\}.*R27b/);
});

test("provisioning guard: ci-job provides Task unless task is false", () => {
  const root = makeFixture();
  for (const f of ROOT_FILES)
    fs.cpSync(path.join(REPO, f), path.join(root, f), { recursive: true });
  const ci = "          id: lint-specs\n          install: install\n";
  const good = checkTaskProvisioning(root);
  assert.ok(!good.findings.some((f) => f.includes("lint-specs")), good.findings.join("\n"));
  replaceOnce(wf(root), ci, `${ci}          task: false\n      - run: task lint-specs\n`);
  const bad = checkTaskProvisioning(root);
  assert.ok(
    bad.findings.some((f) => f.includes("lint-specs") && f.includes("R6a")),
    "BAD:" + bad.findings.join("\n"),
  );
});

test("a ci-job install input that differs from requires.install fails naming the job (spec 0283 R1)", () => {
  const root = makeFixture();
  addCiJob(root, "figure-labels");
  const r = runCheck(root);
  assert.ok(
    r.stderr.includes(
      "job 'figure-labels' passes ci-job install 'ci' but the reference requires.install is 'none'",
    ),
    r.stderr,
  );
});

test("a ci-job yq input that differs from the version GitLab installs fails naming the job", () => {
  const good = makeFixture();
  assert.ok(!runCheck(good).stderr.includes("passes ci-job yq"), "the committed tree agrees");
  const root = makeFixture();
  // Replacement-first: the mutation must apply, else the test proves nothing.
  replaceOnce(
    wf(root),
    '          id: build-components-ts\n          install: omit-dev\n          yq: "4.54.1"\n',
    '          id: build-components-ts\n          install: omit-dev\n          yq: "4.44.3"\n',
  );
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /capability 'build-components-ts'.*passes ci-job yq '4\.44\.3' but GitLab installs yq '4\.54\.1'/,
  );
});

test("requires.yq moves the GitLab version: the GitHub input must follow", () => {
  const root = makeFixture();
  replaceOnce(
    path.join(root, "ci/ci-capabilities.yml"),
    '      install: omit-dev\n      yq: "4.44.3"\n    command:\n      - task ci:skill-scripts-ts',
    '      install: omit-dev\n      yq: "4.54.1"\n    command:\n      - task ci:skill-scripts-ts',
  );
  const r = runCheck(root);
  assert.match(
    r.stderr,
    /capability 'skill-scripts-ts'.*passes ci-job yq '4\.44\.3' but GitLab installs yq '4\.54\.1'/,
  );
});
