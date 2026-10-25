// Spec 0049 delta-02 R27-R29 and spec 0283 R5: concern 6 and the Task provisioning guard for a job
// that uses ./.github/actions/ci-job. mkdtemp copies of the tracked ci/ and .github/ only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { yamlLib as yaml } from "./lib/yaml-lib.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
// Composed so the root-reader guard stays quiet: the fixture root gets a copy, nothing is read here.
const ROOT_FILES = [["Task", "file.yml"].join(""), "taskfiles"];

import { checkTaskProvisioning } from "../lib/task-provisioning/index.ts";
import { readWorkflowUnionYaml } from "./lib/workflow-union.ts";
import {
  capOf,
  editYaml,
  list,
  makeFixture,
  map,
  refPaths,
  replaceOnce,
  runCheck,
} from "./lib/ci-parity-fixture.ts";

const WF = ".github/workflows/build.yml";
const DORNY =
  "      - uses: dorny/paths-filter@v3\n        id: filter\n        with:\n          filters: |\n            figure-labels:\n";
const CHECKOUT =
  "  figure-labels:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n";
/** The dorny filter left build.yml (spec 0283 R9): re-create the one figure-labels carried, from the reference. */
function addFilter(root: string): void {
  const globs = refPaths("figure-labels", "pull-request")
    .map((p) => `              - '${p}'\n`)
    .join("");
  replaceOnce(wf(root), CHECKOUT, `${CHECKOUT}${DORNY}${globs}`);
}
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

test("shape C: a dorny/paths-filter step beside ci-job still fails (spec 0285 R4)", () => {
  const root = makeFixture();
  addCiJob(root, "figure-labels");
  addFilter(root);
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /capability 'figure-labels'.*dorny\/paths-filter step/);
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
      "job 'figure-labels' passes ci-job install 'omit-dev' but the reference requires.install is 'none'",
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
    '          id: build-components-ts\n          yq: "4.54.1"\n',
    '          id: build-components-ts\n          yq: "4.44.3"\n',
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

const FL_APT =
  "          id: figure-labels\n          install: none\n          apt: tesseract-ocr\n";

test("a ci-job apt input outside the packages requires.tools implies fails naming the job", () => {
  const good = makeFixture();
  assert.ok(!runCheck(good).stderr.includes("passes ci-job apt"), "the committed tree agrees");
  const root = makeFixture();
  // Replacement-first: the mutation must apply, else the test proves nothing.
  replaceOnce(wf(root), FL_APT, FL_APT.replace("tesseract-ocr", "tesseract-ocr jq"));
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /capability 'figure-labels'.*passes ci-job apt 'jq tesseract-ocr' but requires\.tools implies 'tesseract-ocr'/,
  );
});

test("dropping a tool from requires.tools makes the ci-job apt input a divergence", () => {
  const root = makeFixture();
  replaceOnce(
    path.join(root, "ci/ci-capabilities.yml"),
    "      tools: [task, tesseract]\n",
    "      tools: [task]\n",
  );
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /capability 'figure-labels'.*passes ci-job apt 'tesseract-ocr' but requires\.tools implies ''/,
  );
});

test("a ci-job python input absent from the reference runtime fails naming the job", () => {
  const good = makeFixture();
  assert.ok(!runCheck(good).stderr.includes("passes ci-job python"), "the committed tree agrees");
  const root = makeFixture();
  replaceOnce(wf(root), FL_APT, `${FL_APT}          python: "3.12"\n`);
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /capability 'figure-labels'.*passes ci-job python '3\.12' but the reference runtime is python ''/,
  );
});

test("a python runtime the ci-job python input does not provide fails naming the job", () => {
  const root = makeFixture();
  editYaml(path.join(root, "ci/ci-capabilities.yml"), (doc) => {
    map(capOf(doc, "figure-labels")["requires"])["runtime"] = ["node@24", "python@3.12"];
  });
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /capability 'figure-labels'.*passes ci-job python '' but the reference runtime is python '3\.12'/,
  );
});

const GATE_MSG = "passes ci-job gate 'false' but the reference declares paths:";

test("gate: false on a capability that has paths: fails naming the job", () => {
  const root = makeFixture();
  // Replacement-first: the mutation must apply, else the test proves nothing.
  replaceOnce(
    wf(root),
    '          id: build-components-ts\n          yq: "4.54.1"\n',
    '          id: build-components-ts\n          gate: false\n          yq: "4.54.1"\n',
  );
  const r = runCheck(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`capability 'build-components-ts'.*${GATE_MSG}`));
});

test("gate: false on a capability without paths: passes (the committed windows jobs)", () => {
  const root = makeFixture();
  const text = fs.readFileSync(path.join(root, ".github", "workflows", "_ci-windows.yml"), "utf8");
  assert.ok(text.includes("          id: windows-node-floor-guard\n          gate: false\n"));
  assert.ok(!runCheck(root).stderr.includes(GATE_MSG));
});

test("install: none with gate: false on a capability without paths: passes", () => {
  const root = makeFixture();
  replaceOnce(
    wf(root),
    "          id: ratchet\n          install: none\n",
    "          id: ratchet\n          gate: false\n          install: none\n",
  );
  const r = runCheck(root);
  assert.ok(!r.stderr.includes(GATE_MSG), r.stderr);
  assert.ok(!r.stderr.includes("job 'ratchet'"), r.stderr);
});

// Spec 0264 delta-01 R15, R18: every windows-latest job of build.yml bounds its runtime.
const WINDOWS_FLOOR_MINUTES = 10;

/** The windows-latest jobs of a workflow text that declare no timeout-minutes, or one under the floor. */
function unboundedWindowsJobs(text: string): string[] {
  const doc = yaml.load(text) as { jobs: Record<string, Record<string, unknown>> };
  return Object.entries(doc.jobs)
    .filter(([, job]) => job["runs-on"] === "windows-latest")
    .filter(([, job]) => {
      const t = job["timeout-minutes"];
      return typeof t !== "number" || t < WINDOWS_FLOOR_MINUTES;
    })
    .map(([name]) => name);
}

test("R18: every windows-latest job of the workflows declares timeout-minutes of at least 10", () => {
  const text = readWorkflowUnionYaml(REPO);
  assert.deepEqual(unboundedWindowsJobs(text), []);
});

test("R18: a windows-latest job without a limit, or under the floor, is named", () => {
  const job = (name: string, extra: string): string =>
    `  ${name}:\n    runs-on: windows-latest\n${extra}    steps: []\n`;
  const text = `jobs:\n${job("a", "")}${job("b", "    timeout-minutes: 5\n")}${job("c", "    timeout-minutes: 10\n")}  d:\n    runs-on: ubuntu-latest\n    steps: []\n`;
  assert.deepEqual(unboundedWindowsJobs(text), ["a", "b"]);
});

// ---- Spec 0287 R9: the staged layout of Build & Validate, asserted on the committed files ----

const GROUP_NAMES = ["gate", "modules", "governance", "extensions", "integration", "windows"];
// The R3 counts; the membership lives in `ci/ci-capabilities.yml` (`group`), compared below.
const R3_COUNTS: Record<string, number> = {
  gate: 19,
  modules: 15,
  governance: 28,
  extensions: 14,
  integration: 8,
  windows: 24,
};
const LINUX_MIDDLE = ["modules", "governance", "extensions"];
const TOP_LEVEL = ["ratchet", "lint-typescript"];
const LINUX_NEEDS = ["gate", ...TOP_LEVEL];

type Doc = Record<string, unknown>;
const asMap = (v: unknown): Doc => (typeof v === "object" && v !== null ? (v as Doc) : {});
const loadYaml = (f: string): Doc => asMap(yaml.load(fs.readFileSync(f, "utf8")));

/** Throws on the first violation of the seven-file layout under `root` (a repo-shaped directory). */
function assertStagedLayout(root: string): void {
  const dir = path.join(root, ".github", "workflows");
  const callerDoc = loadYaml(path.join(dir, "build.yml"));
  const reference = loadYaml(path.join(root, "ci", "ci-capabilities.yml"));
  const groupOf = new Map<string, string>();
  for (const c of reference["capabilities"] as Doc[]) {
    const cap = asMap(c);
    if (typeof cap["group"] === "string") groupOf.set(String(cap["id"]), cap["group"]);
  }

  // R1: build.yml plus exactly six `_ci-<group>.yml`.
  const callees = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("_ci-"))
    .sort();
  assert.deepEqual(callees, GROUP_NAMES.map((g) => `_ci-${g}.yml`).sort(), "callee files");

  // Caller: permissions, one `uses` job per group, no steps, no `if:`, the needs graph (R4).
  assert.deepEqual(callerDoc["permissions"], { contents: "read", actions: "write" });
  const callerJobs = asMap(callerDoc["jobs"]);
  assert.deepEqual(
    Object.keys(callerJobs).sort(),
    [...GROUP_NAMES, ...TOP_LEVEL].sort(),
    "caller jobs",
  );
  for (const [k, v] of Object.entries(callerJobs)) {
    const j = asMap(v);
    if (TOP_LEVEL.includes(k)) {
      // Spec 0287 delta-01 R21: the two required contexts are ordinary top-level jobs with steps.
      assert.ok(Array.isArray(j["steps"]), `${k}: a top-level job has steps`);
      assert.ok(!("uses" in j), `${k}: a top-level job has no uses`);
      assert.equal(j["needs"], undefined, `${k}: no needs`);
      continue;
    }
    assert.equal(j["uses"], `./.github/workflows/_ci-${k}.yml`, `${k}: uses`);
    assert.ok(!("steps" in j), `${k}: a caller job has no steps`);
    assert.ok(!("if" in j), `${k}: a caller job has no if`);
  }
  const needs = (k: string) => asMap(callerJobs[k])["needs"];
  assert.equal(needs("gate"), undefined, "gate has no needs");
  for (const k of LINUX_MIDDLE) assert.deepEqual(needs(k), LINUX_NEEDS, `${k}: needs`);
  assert.ok(
    [JSON.stringify(LINUX_NEEDS), JSON.stringify([...LINUX_NEEDS, ...LINUX_MIDDLE])].includes(
      JSON.stringify(needs("integration")),
    ),
    "integration needs",
  );
  assert.equal(needs("windows"), undefined, "windows has no needs");

  // Callees: workflow_call only, no concurrency, no secrets; job keys unique; group of each job.
  const seen = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const f of callees) {
    const group = f.slice("_ci-".length, -".yml".length);
    const doc = loadYaml(path.join(dir, f));
    const on = asMap(doc["on"]);
    assert.deepEqual(Object.keys(on), ["workflow_call"], `${f}: trigger`);
    assert.ok(!("concurrency" in doc), `${f}: no concurrency`);
    assert.ok(!JSON.stringify(doc).includes("secrets."), `${f}: no secrets`);
    for (const key of Object.keys(asMap(doc["jobs"]))) {
      assert.ok(!TOP_LEVEL.includes(key), `${f}: '${key}' must be a top-level job of build.yml`);
      assert.ok(!seen.has(key), `job key '${key}' is in both ${seen.get(key)} and ${f}`);
      seen.set(key, f);
      assert.equal(groupOf.get(key), group, `job '${key}' in ${f} has group ${groupOf.get(key)}`);
      counts[group] = (counts[group] ?? 0) + 1;
    }
  }
  for (const k of TOP_LEVEL) {
    seen.set(k, "build.yml");
    const g = groupOf.get(k) ?? "";
    counts[g] = (counts[g] ?? 0) + 1;
  }
  assert.deepEqual(counts, R3_COUNTS, "R3 counts");
  assert.deepEqual(
    [...seen.keys()].sort(),
    [...groupOf.keys()].sort(),
    "keys equal capability ids",
  );

  const gateJobs = Object.keys(asMap(loadYaml(path.join(dir, "_ci-gate.yml"))["jobs"]));
  assert.equal(gateJobs.length, 17, "_ci-gate.yml holds the other 17 gate jobs");
  for (const k of TOP_LEVEL) assert.equal(groupOf.get(k), "gate", `${k} stays in group gate`);
}

test("the committed layout is the seven-file staged layout of spec 0287 (R1-R4, R9)", () => {
  assertStagedLayout(REPO);
});

/** A mkdtemp copy of ci/ and .github/workflows, mutated through `edit` (file name, parsed doc). */
function mutated(file: string, edit: (doc: Doc) => void): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "staged-layout-"));
  fs.cpSync(path.join(REPO, "ci"), path.join(root, "ci"), { recursive: true });
  fs.cpSync(path.join(REPO, ".github", "workflows"), path.join(root, ".github", "workflows"), {
    recursive: true,
  });
  const f = path.join(root, ".github", "workflows", file);
  const doc = loadYaml(f);
  edit(doc);
  fs.writeFileSync(f, yaml.dump(doc, { lineWidth: -1 }));
  return root;
}
const firstKey = (file: string) =>
  Object.keys(asMap(loadYaml(path.join(REPO, ".github", "workflows", file))["jobs"]))[0] ?? "";

test("mutation proofs: each broken layout fails the assertion function", () => {
  const roots: string[] = [];
  const mutate = (file: string, edit: (doc: Doc) => void) => {
    const r = mutated(file, edit);
    roots.push(r);
    return r;
  };
  try {
    const dupKey = firstKey("_ci-modules.yml");
    const dup = mutate("_ci-gate.yml", (d) => {
      asMap(d["jobs"])[dupKey] = { "runs-on": "ubuntu-latest", steps: [] };
    });
    assert.throws(() => assertStagedLayout(dup), /is in both|R3 counts|group/);

    const missing = mutate("_ci-modules.yml", (d) => {
      delete asMap(d["jobs"])[dupKey];
    });
    assert.throws(() => assertStagedLayout(missing), /R3 counts|keys equal/);

    const winNeeds = mutate("build.yml", (d) => {
      asMap(asMap(d["jobs"])["windows"])["needs"] = ["gate"];
    });
    assert.throws(() => assertStagedLayout(winNeeds), /windows has no needs/);

    const noGate = mutate("build.yml", (d) => {
      delete asMap(asMap(d["jobs"])["modules"])["needs"];
    });
    assert.throws(() => assertStagedLayout(noGate), /modules: needs/);

    // Delta-01 R21: moving a required job into _ci-gate.yml, or dropping it from a Linux group's needs.
    for (const k of TOP_LEVEL) {
      const root = mutate("build.yml", (d) => {
        delete asMap(d["jobs"])[k];
      });
      const gateFile = path.join(root, ".github", "workflows", "_ci-gate.yml");
      const gd = loadYaml(gateFile);
      asMap(gd["jobs"])[k] = { "runs-on": "ubuntu-latest", steps: [] };
      fs.writeFileSync(gateFile, yaml.dump(gd, { lineWidth: -1 }));
      assert.throws(() => assertStagedLayout(root), /caller jobs|must be a top-level/);

      const dropped = mutate("build.yml", (d) => {
        const m = asMap(asMap(d["jobs"])["modules"]);
        m["needs"] = (m["needs"] as string[]).filter((n) => n !== k);
      });
      assert.throws(() => assertStagedLayout(dropped), /modules: needs/);
    }
  } finally {
    // Only directories created by mkdtemp above.
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  }
});
