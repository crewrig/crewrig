// Replaces scripts/tests/test-build-ci.sh (group S: synthetic cases G-L and the delta-02 24(h)
// hunk proof; M and N live in build-ci-synthetic-write.test.ts). Two-file roots, REPO_DIR pinned.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ENV_REFERENCE,
  newRoot,
  REPO,
  runBuildCi,
  SPECIFIC_REFERENCE,
  topLevelKeys,
  UNKNOWN_RUNTIME_REFERENCE,
  UNKNOWN_TOOL_REFERENCE,
  VALID_REFERENCE,
} from "./lib/ci-reference-fixtures.ts";
import { generate } from "../lib/build-ci/entry.ts";
import { parseTaskPin, secondaryRuntimeInstallLines } from "../lib/build-ci/tools.ts";
import { applyNormalDiff } from "./lib/normal-diff-apply.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const pipeline = (root: string): string => path.join(root, ".gitlab-ci.yml");

describe("build-ci synthetic (group S)", () => {
  it("G0, G: a drifted pipeline is rejected with exactly exit 1 (Scenario 2)", () => {
    const root = newRoot(VALID_REFERENCE);
    const gen = runBuildCi(root);
    assert.equal(gen.status, 0, "G0 synthetic generate succeeds");
    assert.equal(gen.stderr, "");
    fs.appendFileSync(pipeline(root), "\n# injected drift\n");
    const res = runBuildCi(root, ["--check"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^DRIFT: /);
    assert.match(
      res.stderr,
      /FAILED: run 'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts\/build-ci\.ts' to regenerate/,
    );
  });

  it("24(h): the printed normal-format hunks turn the committed file into the generated one", () => {
    const root = newRoot(VALID_REFERENCE);
    assert.equal(runBuildCi(root).status, 0);
    const generated = fs.readFileSync(pipeline(root), "utf8");
    const lines = generated.split("\n");
    lines.splice(3, 1, "# edited line", "# extra line");
    const committed = `${lines.join("\n")}\n# trailing drift\n`;
    fs.writeFileSync(pipeline(root), committed);
    const res = runBuildCi(root, ["--check"]);
    assert.equal(res.status, 1);
    const body = res.stderr.split("\n\n");
    assert.ok(body.length >= 3, "header, hunks, FAILED line");
    const hunks = `${body.slice(1, -1).join("\n\n")}\n`;
    assert.equal(applyNormalDiff(committed, hunks), generated);
  });

  it("H0-H3: a specific capability leaves no trace (Scenario 3, synthetic)", () => {
    const root = newRoot(SPECIFIC_REFERENCE);
    assert.equal(runBuildCi(root).status, 0, "H0 generate succeeds");
    const out = fs.readFileSync(pipeline(root), "utf8");
    assert.ok(out.includes("\nbuild:"), "H1 portable build job present");
    assert.equal(topLevelKeys(out).includes("pages-deploy"), false, "H2 no job");
    assert.equal(out.split("pages-deploy").length - 1, 0, "H3 no placeholder anywhere");
  });

  it("I: an unmappable tool requirement is rejected with exit 1 (delta-02 Scenario 2)", () => {
    assert.equal(runBuildCi(newRoot(UNKNOWN_TOOL_REFERENCE)).status, 1);
  });

  it("J: an unknown runtime is rejected with exit 1", () => {
    assert.equal(runBuildCi(newRoot(UNKNOWN_RUNTIME_REFERENCE)).status, 1);
  });

  it("K0, K1: the real reference generates parseable single-document YAML", () => {
    const root = newRoot(fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8"));
    const res = runBuildCi(root);
    assert.equal(res.status, 0, "K0 generate from the real reference succeeds");
    assert.equal(res.stderr, "");
    // The pipeline carries GitLab's `!reference` tag, unknown to js-yaml: read it as a sequence.
    const doc = yamlLib.load(
      fs.readFileSync(pipeline(root), "utf8").replaceAll("!reference [", "["),
    );
    assert.equal(typeof doc, "object", "K1 parses as one YAML document");
    assert.notEqual(doc, null);
  });

  it("L0, L1: capability env mapping emits the variables block", () => {
    const root = newRoot(ENV_REFERENCE);
    const res = runBuildCi(root);
    assert.equal(res.status, 0, "L0 generate with env mapping succeeds");
    assert.equal(res.stderr, "");
    assert.ok(
      fs
        .readFileSync(pipeline(root), "utf8")
        .includes('BASE_REF: "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"'),
    );
  });
});

describe("build-ci requires.install (spec 0283 R1)", () => {
  const INSTALL_PIN = parseTaskPin(
    JSON.stringify({ version: "3.54.0", sha256: { linux_amd64: "a".repeat(64) } }),
  );

  const installCap = (requires: string, command: string): string =>
    [
      "capabilities:",
      "  - id: alpha",
      '    name: "Alpha"',
      "    portability: portable",
      "    trigger:",
      "      - on: pull-request",
      "        branches: [main]",
      `${requires}    command:`,
      `${command}`,
      "",
    ].join("\n");

  const installJob = (text: string): string => text.slice(text.indexOf("\nalpha:"));
  const hiddenJob = (text: string): string =>
    text.slice(text.indexOf("\n.task-install:"), text.indexOf("\nalpha:"));

  it("a migrated capability generates image, pinned Task, npm ci and the task script", () => {
    const full = generate(
      installCap(
        "    requires:\n      runtime: node@24\n      tools: [task]\n      install: ci\n",
        "      - task ci:alpha",
      ),
      INSTALL_PIN,
    );
    const out = installJob(full);
    assert.match(out, /image: node:24/);
    assert.match(hiddenJob(full), /sha256sum -c -[\s\S]*task --version/);
    assert.equal(full.split("task_linux_amd64.tar.gz").length - 1, 1, "install emitted once");
    const lines = out.split("\n");
    const taskAt = lines.findIndex((l) => l.includes("!reference [.task-install, script]"));
    const ciAt = lines.findIndex((l) => l.trim() === "- npm ci");
    const scriptAt = lines.findIndex((l) => l.trim() === "script:");
    assert.ok(taskAt > 0 && ciAt > taskAt && scriptAt > ciAt, out);
    assert.match(out, /script:\n {4}- "?task ci:alpha"?\n/);
  });

  it("no hidden Task job is emitted when no capability requires task", () => {
    const out = generate(
      installCap("    requires:\n      runtime: node@24\n", "      - echo hi"),
      INSTALL_PIN,
    );
    assert.ok(!out.includes(".task-install"));
  });

  it("install values map to their provisioning line; none and omitted add nothing", () => {
    const lineFor = (v: string): string | undefined => {
      const req = `    requires:\n      runtime: node@24\n${v === "" ? "" : `      install: ${v}\n`}`;
      const out = generate(installCap(req, "      - task ci:alpha"), INSTALL_PIN);
      return out
        .split("\n")
        .find((l) => /^\s+- npm /.test(l))
        ?.trim();
    };
    assert.equal(lineFor("ci"), "- npm ci");
    assert.equal(lineFor("install"), "- npm install");
    assert.equal(lineFor("omit-dev"), "- npm ci --omit=dev --workspaces=false");
    assert.equal(lineFor("none"), undefined);
    assert.equal(lineFor(""), undefined);
  });

  it("an unknown install value is rejected", () => {
    assert.throws(
      () =>
        generate(
          installCap(
            "    requires:\n      runtime: node@24\n      install: yarn\n",
            "      - task ci:alpha",
          ),
          INSTALL_PIN,
        ),
      /requires\.install 'yarn'/,
    );
  });

  it("a capability that omits install generates exactly what it did before", () => {
    const out = installJob(
      generate(
        installCap(
          "    requires:\n      runtime: node@24\n",
          '      - "npm ci"\n      - "node x.ts"',
        ),
        INSTALL_PIN,
      ),
    );
    assert.ok(!out.includes("before_script"), out);
    assert.match(out, /- "?npm ci"?\n/);
  });
});

describe("build-ci GitLab secondary python (spec 0285 R5)", () => {
  it("accepts the Debian python version and rejects any other", () => {
    assert.equal(secondaryRuntimeInstallLines("python@3.11").length, 1);
    assert.throws(() => secondaryRuntimeInstallLines("python@3.12"), /Debian python 3\.11/);
    assert.throws(() => secondaryRuntimeInstallLines("python@3.110"), /Debian python 3\.11/);
  });
});
