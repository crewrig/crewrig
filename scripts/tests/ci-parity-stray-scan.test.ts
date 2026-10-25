// Replaces scripts/tests/test-check-ci-parity.sh (stray-scan wiring SC1-SC3, spec 0170 delta-01 R16).
// The parity unwrap strips only the generated cache layer, never the `--stray-scan` wrapper.
// Selectors (P3): `release-notes` / `monorepo-release-notes-real-engine` (bare, release-notes.yml)
// and `chroma-mcp` / `chroma-wrapper-source` (layered, build.yml). No real job keeps the layered
// inline shape since the `task ci:<id>` migration, so `inlineChroma` rebuilds it from the real
// task body inside the mkdtemp fixture copy (the real tree is never touched).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { readWorkflowUnion } from "./lib/workflow-union.ts";
import {
  capOf,
  editYaml,
  list,
  makeFixture,
  map,
  runCheck,
  type YMap,
} from "./lib/ci-parity-fixture.ts";
import { ciTaskCommands } from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const SCAN_PREFIX =
  "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --stray-scan -- ";
const NODE_TEST = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test";
const NOTES_YML = (fx: string) => path.join(fx, ".github", "workflows", "release-notes.yml");
const BUILD_YML = (fx: string) => path.join(fx, ".github", "workflows", "build.yml");

function lastCommand(fx: string, id: string): string {
  const doc = map(
    yamlLib.load(fs.readFileSync(path.join(fx, "ci", "ci-capabilities.yml"), "utf8")),
  );
  const cmds = list(capOf(doc, id)["command"], `command of ${id}`);
  return String(cmds[cmds.length - 1]);
}
/** The `run` step of `jobName` whose text matches `re`. */
function stepOf(doc: YMap, jobName: string, re: RegExp): YMap {
  const jobs = map(doc["jobs"], "jobs");
  const found = list(map(jobs[jobName], jobName)["steps"])
    .map((s) => map(s))
    .find((s) => re.test(String(s["run"] ?? "")));
  assert.ok(found, `no step of '${jobName}' matches ${re}`);
  return found;
}
function load(file: string): YMap {
  return map(yamlLib.load(fs.readFileSync(file, "utf8")), file);
}

/**
 * Rewrites `chroma-mcp` in the fixture to its pre-migration inline shape: the capability declares the
 * scanned suites command itself (taken from the real `ci:chroma-mcp` task body) and the GitHub job
 * provisions by hand and wraps that command in the generated cache layer. The GitLab file is dropped
 * because it was generated from the migrated capability.
 */
function inlineChroma(fx: string): void {
  const body = ciTaskCommands("chroma-mcp");
  const last = String(body[body.length - 1]);
  const marker = "--stray-scan -- ";
  const tests = last.slice(last.indexOf(marker) + marker.length);
  const declared = `${SCAN_PREFIX}${tests}`;
  let files: string[] = [];
  const capFile = path.join(fx, "ci", "ci-capabilities.yml");
  editYaml(capFile, (doc) => {
    const c = capOf(doc, "chroma-mcp");
    c["command"] = [declared];
    const req = map(c["requires"]);
    delete req["install"];
    req["tools"] = list(req["tools"]).filter((x) => x !== "task");
    files = list(map(c["cache"])["files"]).map(String);
    // No dorny filter any more (spec 0285 R4): the hand-written job has no GitHub-side list, so drop the reference one.
    delete c["paths"];
    for (const t of list(c["trigger"]).map((x) => map(x))) delete t["paths"];
  });
  fs.rmSync(path.join(fx, ".gitlab-ci.yml"), { force: true });
  editYaml(BUILD_YML(fx), (doc) => {
    const job = map(map(doc["jobs"])["chroma-mcp"]);
    const kept = list(job["steps"]).filter(
      (s) => !String(map(s)["uses"] ?? "").endsWith("/ci-job"),
    );
    const key = `\${{ hashFiles(${files.map((f) => `'${f}'`).join(", ")}) }}`;
    const guard =
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --cache-dir .ci-cache " +
      `--key-files "${files.join(",")}" --key-env "" -- ${declared}`;
    job["steps"] = [
      ...kept,
      { uses: "actions/setup-python@v5", with: { "python-version": "3.12" } },
      { uses: "actions/setup-node@v4", with: { "node-version": 24 } },
      {
        name: "Install yq",
        run: "sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.54.1/yq_linux_amd64",
      },
      { uses: "actions/cache@v4", with: { path: ".ci-cache", key } },
      { name: "Test Chroma", run: guard },
    ];
  });
}

test("SC1: scanned steps, bare (release-notes) and inside a cache layer (chroma-mcp), pass", () => {
  const fx = makeFixture();
  inlineChroma(fx);
  const wantBare = lastCommand(fx, "release-notes");
  const wantLayered = lastCommand(fx, "chroma-mcp");
  const gotBare = String(
    stepOf(load(NOTES_YML(fx)), "release-notes", /monorepo-release-notes-real-engine/)["run"],
  );
  const gotLayered = String(
    stepOf({ jobs: readWorkflowUnion(fx) }, "chroma-mcp", /chroma-wrapper-source/)["run"],
  );
  // Preconditions: the reference declares the scanned form.
  assert.ok(
    wantBare.startsWith(SCAN_PREFIX),
    `release-notes command is not scanned: '${wantBare}'`,
  );
  assert.ok(
    wantLayered.startsWith(SCAN_PREFIX),
    `chroma-mcp command is not scanned: '${wantLayered}'`,
  );
  assert.equal(gotBare, wantBare, "the release-notes step is the declared scanned command, bare");
  assert.ok(
    gotLayered.startsWith(
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --cache-dir ",
    ) && gotLayered.endsWith(` -- ${wantLayered}`),
    `chroma-mcp step is not a cache layer around the declared command (got '${gotLayered}')`,
  );
  const r = runCheck(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes("capability 'release-notes' (github-actions)"), r.stderr);
  assert.ok(!r.stderr.includes("capability 'chroma-mcp' (github-actions)"), r.stderr);
});

test("SC2: a bare step missing the scan fails closed", () => {
  const fx = makeFixture();
  const bare = `${NODE_TEST} scripts/tests/monorepo-release-notes-real-engine.test.ts`;
  editYaml(NOTES_YML(fx), (doc) => {
    stepOf(doc, "release-notes", /stray-scan/)["run"] = bare;
  });
  const r = runCheck(fx);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes("capability 'release-notes' (github-actions)"), r.stderr);
  assert.ok(r.stderr.includes(`unexpected step: '${bare}'`), r.stderr);
});

test("SC3: a layered step missing the scan fails closed", () => {
  const fx = makeFixture();
  inlineChroma(fx);
  editYaml(BUILD_YML(fx), (doc) => {
    const s = stepOf(doc, "chroma-mcp", /stray-scan/);
    const inner =
      " -- node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --stray-scan -- ";
    const run = String(s["run"]);
    assert.ok(run.includes(inner), "precondition: the layered step carries the scan");
    s["run"] = run.replace(inner, " -- ");
  });
  const r = runCheck(fx);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes("capability 'chroma-mcp' (github-actions)"), r.stderr);
  assert.ok(
    r.stderr.includes(
      `unexpected step: '${lastCommand(fx, "chroma-mcp").slice(SCAN_PREFIX.length)}'`,
    ),
    r.stderr,
  );
});
