// Replaces scripts/tests/test-check-ci-parity.sh (stray-scan wiring SC1-SC3, spec 0170 delta-01 R16).
// The parity unwrap strips only the generated cache layer, never the `--stray-scan` wrapper.
// Selectors (P3): `release-notes` / `monorepo-release-notes-real-engine` (bare, release-notes.yml)
// and `chroma-mcp` / `chroma-wrapper-source` (layered, build.yml).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  capOf,
  editYaml,
  list,
  makeFixture,
  map,
  runCheck,
  type YMap,
} from "./lib/ci-parity-fixture.ts";
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

test("SC1: scanned steps, bare (release-notes) and inside a cache layer (chroma-mcp), pass", () => {
  const fx = makeFixture();
  const wantBare = lastCommand(fx, "release-notes");
  const wantLayered = lastCommand(fx, "chroma-mcp");
  const gotBare = String(
    stepOf(load(NOTES_YML(fx)), "release-notes", /monorepo-release-notes-real-engine/)["run"],
  );
  const gotLayered = String(
    stepOf(load(BUILD_YML(fx)), "chroma-mcp", /chroma-wrapper-source/)["run"],
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
