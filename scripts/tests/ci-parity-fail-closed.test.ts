// Replaces scripts/tests/test-check-ci-parity.sh (fail-closed group S3-S12, R4d/R4t/R4r, C1).
// Every case exits 1 and names the offending capability and platform. A step index is
// asserted before it is edited (stale-index guard); steps are read by name or `uses`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
import {
  ReferenceNotFoundError,
  ReferenceReadError,
  docOf,
  readCapabilities,
  readReference,
} from "../lib/ci-parity/reference-read.ts";
import { editReference } from "./lib/ci-reference-fixtures.ts";

const buildYml = (fx: string) => path.join(fx, ".github", "workflows", "build.yml");

function job(doc: YMap, name: string): YMap {
  return map(map(doc["jobs"], "jobs")[name], `job ${name}`);
}
function steps(doc: YMap, name: string): unknown[] {
  return list(job(doc, name)["steps"], `steps of ${name}`);
}
function ghEdit(edit: (doc: YMap) => void): string {
  const fx = makeFixture();
  editYaml(buildYml(fx), edit);
  return fx;
}
function refEdit(edit: (doc: YMap) => void, gitlab = true): string {
  const fx = makeFixture();
  if (!gitlab) fs.rmSync(path.join(fx, ".gitlab-ci.yml"), { force: true });
  editReference(fx, edit);
  return fx;
}
function fails(fx: string, label: string, needles: readonly string[]): void {
  const r = runCheck(fx);
  assert.equal(r.status, 1, `${label}: ${r.stdout}${r.stderr}`);
  for (const n of needles)
    assert.ok(r.stderr.includes(n), `${label}: stderr lacks '${n}'\n${r.stderr}`);
}

test("S3: drifted GHA business step", () => {
  const fx = ghEdit((doc) => {
    const s = map(steps(doc, "build")[3]);
    assert.match(String(s["run"]), /^npm run build/, "precondition: index 3 is the business step");
    s["run"] = "npm run bogus";
  });
  fails(fx, "S3", ["capability 'build' (github-actions)"]);
});

test("S4: drifted .gitlab-ci.yml names gitlab and the composed build-ci.ts --check", () => {
  const fx = makeFixture();
  fs.appendFileSync(path.join(fx, ".gitlab-ci.yml"), "\n# hand-edited drift\n");
  fails(fx, "S4", ["(gitlab)", "build-ci.ts --check"]);
});

test("S5: an engine omits a portable capability (R6)", () => {
  const fx = ghEdit((doc) => {
    delete map(doc["jobs"])["check-agents-size"];
  });
  fails(fx, "S5", ["check-agents-size", "github-actions", "R6"]);
});

test("S6: untraceable job", () => {
  const fx = ghEdit((doc) => {
    map(doc["jobs"])["mystery"] = { "runs-on": "ubuntu-latest", steps: [{ run: "echo hi" }] };
  });
  fails(fx, "S6", ["untraceable job 'mystery'", "github-actions"]);
});

test("S7: specific capability with empty evidence", () => {
  const fx = refEdit((doc) => {
    map(capOf(doc, "pages-deploy")["exception"])["evidence"] = "";
  });
  fails(fx, "S7", ["pages-deploy", "evidence"]);
});

test("S10a: unknown trigger kind (validity rule 2)", () => {
  const fx = refEdit((doc) => {
    map(list(capOf(doc, "build")["trigger"])[0])["on"] = "bogus";
  });
  fails(fx, "S10a", ["build", "validity rule 2"]);
});

test("S10b: duplicate id (validity rule 4)", () => {
  const fx = refEdit((doc) => {
    capOf(doc, "lint-specs")["id"] = "build";
  });
  fails(fx, "S10b", ["duplicate", "validity rule 4"]);
});

test("S10c: portable capability without command (validity rule 5)", () => {
  const fx = refEdit((doc) => {
    delete capOf(doc, "build")["command"];
  });
  fails(fx, "S10c", ["build", "validity rule 5"]);
});

test("S10d: portable command needs an undeclared tool (validity rule 6)", () => {
  const fx = refEdit((doc) => {
    list(capOf(doc, "build")["command"]).push("jq .");
  });
  fails(fx, "S10d", ["jq", "validity rule 6"]);
});

test("S10e: env must be a key-value mapping", () => {
  const fx = refEdit((doc) => {
    capOf(doc, "build")["env"] = "invalid-string";
  });
  fails(fx, "S10e", ["build", "env must be a key-value mapping"]);
});

test("R4d: missing fetch-depth where history-depth: full is required", () => {
  const fx = ghEdit((doc) => {
    const s = map(steps(doc, "check-skill-versions")[0]);
    assert.match(String(s["uses"]), /^actions\/checkout@/, "precondition: step 0 is the checkout");
    delete s["with"];
  });
  fails(fx, "R4d", ["check-skill-versions", "fetch-depth"]);
});

test("R4t: missing tesseract install", () => {
  const fx = ghEdit((doc) => {
    const all = steps(doc, "figure-labels");
    const ci = all.find((s) => String(map(s)["uses"] ?? "").endsWith("/ci-job"));
    const w = map(map(ci)["with"]);
    assert.equal(w["apt"], "tesseract-ocr", "precondition: the ci-job step installs tesseract");
    delete w["apt"];
  });
  fails(fx, "R4t", ["figure-labels", "requires tool 'tesseract'"]);
});

test("R4r: wrong runtime version", () => {
  const fx = ghEdit((doc) => {
    const s = map(steps(doc, "build")[1]);
    assert.match(String(s["uses"]), /^actions\/setup-node@/, "precondition: step 1 is setup-node");
    map(s["with"])["node-version"] = 20;
  });
  fails(fx, "R4r", ["capability 'build' (github-actions)", "node"]);
});

test("S12: python3 required with no setup step still fails closed (GHA-only)", () => {
  const fx = refEdit((doc) => {
    list(map(capOf(doc, "figure-labels")["requires"])["tools"]).push("python3");
  }, false);
  fails(fx, "S12", ["figure-labels", "requires tool 'python3'"]);
});

test("S11: GHA env block divergence", () => {
  const fx = ghEdit((doc) => {
    const j = job(doc, "build");
    j["env"] = { ...(j["env"] === undefined ? {} : map(j["env"])), UNEXPECTED_VAR: "val" };
  });
  fails(fx, "S11", ["capability 'build' (github-actions)", "UNEXPECTED_VAR"]);
});

test("C1: cache key inputs diverge from the reference cache.files", () => {
  // mempalace is a `ci-job` job with `cache: true` (the action keys the cache from the capability,
  // so nothing can diverge there). The mutation turns the keying back into a hand-written
  // actions/cache step whose hashFiles key lists a file the reference does not.
  const fx = ghEdit((doc) => {
    const all = steps(doc, "mempalace").map((x) => map(x));
    const ciJob = all.find((x) => x["uses"] === "./.github/actions/ci-job");
    assert.ok(ciJob, "precondition: the mempalace job calls ci-job");
    const w = map(ciJob["with"]);
    assert.equal(w["cache"], true, "precondition: the mempalace job keys its cache through ci-job");
    delete w["cache"];
    steps(doc, "mempalace").push({
      uses: "actions/cache@v4",
      with: { path: ".ci-cache", key: "${{ hashFiles('zz/cache-key-drift.txt') }}" },
    });
  });
  fails(fx, "C1", ["capability 'mempalace' (github-actions)", "cache key inputs diverge"]);
});

test("S13 (spec 0287 R8): an untraceable job inside a callee fails, naming the callee file", () => {
  const fx = ghEdit((doc) => {
    map(doc["jobs"])["mystery"] = { "runs-on": "ubuntu-latest", steps: [{ run: "echo hi" }] };
  });
  fails(fx, "S13", ["untraceable job 'mystery'", "_ci-", "github-actions"]);
});

test("S14 (spec 0287 R8): a stepless job without `uses` is untraceable, not a caller", () => {
  const fx = ghEdit((doc) => {
    map(doc["jobs"])["hollow"] = { "runs-on": "ubuntu-latest" };
  });
  fails(fx, "S14", ["untraceable job 'hollow'", "github-actions"]);
});

test("S15 (spec 0287 R11): a GitHub-engine capability without `group` fails", () => {
  const fx = refEdit((doc) => {
    delete capOf(doc, "lint-specs")["group"];
  });
  fails(fx, "S15", ["capability 'lint-specs'", "no 'group'", "R11"]);
});

test("S16 (spec 0287 R11): a group outside the six names fails", () => {
  const fx = refEdit((doc) => {
    capOf(doc, "lint-specs")["group"] = "bogus";
  });
  fails(fx, "S16", ["capability 'lint-specs'", "group 'bogus'", "R11"]);
});

test("S17 (spec 0287 R11): a callee file that does not match the group fails", () => {
  const fx = refEdit((doc) => {
    capOf(doc, "lint-specs")["group"] = "modules";
  });
  fails(fx, "S17", ["job 'lint-specs'", "_ci-gate.yml", "_ci-modules.yml", "R11"]);
});

// ---------------------------------------------------------------------------------------------
// The shared reader of the capability reference (spec 0309 R3, R13(0)): `readReference` and the
// parity guard that fronts it. Sandboxes hold only `ci/`; no workflow or pipeline arm runs.

const cap = (id: string, group?: string): string =>
  `  - id: ${id}\n${group === undefined ? "" : `    group: ${group}\n`}    name: "${id}"\n` +
  `    trigger:\n      - on: push\n        branches: [main]\n    portability: portable\n` +
  `    requires:\n      runtime: node@22\n    command:\n      - npm install\n`;
const refFile = (...caps: string[]): string => `capabilities:\n${caps.join("")}`;

function sandbox(files: Record<string, string>, legacy?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ref-reader-"));
  process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, "ci", "capabilities"), { recursive: true });
    fs.writeFileSync(path.join(root, "ci", "capabilities", name), text);
  }
  if (legacy !== undefined) {
    fs.mkdirSync(path.join(root, "ci"), { recursive: true });
    fs.writeFileSync(path.join(root, "ci", "ci-capabilities.yml"), legacy);
  }
  return root;
}

/** The reader failure of `root`: its violations, which the parity guard must print the same way. */
function readerFailure(root: string): { file: string; message: string }[] {
  let caught: unknown;
  try {
    readReference(root);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof ReferenceReadError, "readReference must fail closed");
  const r = runCheck(root);
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.ok(
    r.stderr.includes(
      `FAILED: ${caught.violations.length} reference-validity violation(s) in ${root}/ci/capabilities/:\n`,
    ),
    r.stderr,
  );
  for (const v of caught.violations)
    assert.ok(r.stderr.includes(`  - ${v.file}: ${v.message}\n`), `no bullet for ${v.file}`);
  return caught.violations;
}

test("R3: a file that is not valid reference content fails, naming the file", () => {
  const v = readerFailure(
    sandbox({ "gate.yml": refFile(cap("a", "gate")), "modules.yml": "capabilities: [unclosed\n" }),
  );
  assert.deepEqual(
    v.map((x) => x.file),
    ["ci/capabilities/modules.yml"],
  );
  assert.match(v[0]?.message ?? "", /not valid reference content/);
});

test("R3: an id defined in two files fails, naming both files", () => {
  const v = readerFailure(
    sandbox({
      "gate.yml": refFile(cap("dup", "gate")),
      "modules.yml": refFile(cap("dup", "modules")),
    }),
  );
  assert.equal(v.length, 1);
  assert.equal(v[0]?.file, "ci/capabilities/modules.yml");
  assert.match(v[0]?.message ?? "", /'dup' is also defined in ci\/capabilities\/gate\.yml/);
});

test("R3: a capability whose group is not its file's group fails, naming the file and capability", () => {
  const v = readerFailure(sandbox({ "modules.yml": refFile(cap("x", "governance")) }));
  assert.equal(v[0]?.file, "ci/capabilities/modules.yml");
  assert.match(
    v[0]?.message ?? "",
    /capability 'x' has group 'governance', but this file holds group 'modules'/,
  );
});

test("R3: a file name outside the six groups and standalone fails, naming the file", () => {
  const v = readerFailure(
    sandbox({
      "gate.yml": refFile(cap("a", "gate")),
      "misc.yml": refFile(cap("b")),
      "notes.txt": "x",
    }),
  );
  assert.deepEqual(v.map((x) => x.file).sort(), [
    "ci/capabilities/misc.yml",
    "ci/capabilities/notes.txt",
  ]);
});

test("R3: a directory with no file fails, naming the directory", () => {
  const root = sandbox({});
  fs.mkdirSync(path.join(root, "ci", "capabilities"), { recursive: true });
  const v = readerFailure(root);
  assert.deepEqual(v, [{ file: "ci/capabilities/", message: "holds no file" }]);
});

test("R3: the legacy file left beside the directory fails, naming it", () => {
  const v = readerFailure(
    sandbox({ "gate.yml": refFile(cap("a", "gate")) }, refFile(cap("a", "gate"))),
  );
  assert.equal(v[0]?.file, "ci/ci-capabilities.yml");
  assert.match(v[0]?.message ?? "", /still exists beside ci\/capabilities\//);
});

test("R3: a directory holding only ungrouped files is valid while no capability names a group", () => {
  const ok = sandbox({ "standalone.yml": refFile(cap("a"), cap("b")) });
  const ref = readReference(ok);
  assert.deepEqual(
    [...ref.fileOf],
    [
      ["a", "ci/capabilities/standalone.yml"],
      ["b", "ci/capabilities/standalone.yml"],
    ],
  );
  const r = runCheck(ok);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  // The same directory fails once an ungrouped file holds a grouped capability.
  const v = readerFailure(sandbox({ "standalone.yml": refFile(cap("a"), cap("b", "gate")) }));
  assert.match(
    v[0]?.message ?? "",
    /capability 'b' has group 'gate', but this file holds ungrouped/,
  );
});

test("R3: with no directory the legacy file is read, and its absence keeps the not-found error", () => {
  const legacy = sandbox({}, refFile(cap("a", "gate"), cap("b")));
  const ref = readReference(legacy);
  assert.deepEqual(ref.files, ["ci/ci-capabilities.yml"]);
  assert.equal(ref.text, refFile(cap("a", "gate"), cap("b")));
  assert.equal(runCheck(legacy).status, 0);
  const none = sandbox({});
  assert.throws(() => readReference(none), ReferenceNotFoundError);
  const r = runCheck(none);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes(`Error: CI reference not found: ${none}/ci/ci-capabilities.yml`));
});

test("R13(0): files in byte order of name, entries in file order within each file", () => {
  const root = sandbox({
    "windows.yml": refFile(cap("w2", "windows"), cap("w1", "windows")),
    "gate-b.yml": refFile(cap("g3", "gate")),
    "gate-a.yml": refFile(cap("g2", "gate"), cap("g1", "gate")),
    "standalone.yml": refFile(cap("s")),
  });
  const ref = readReference(root);
  assert.deepEqual(
    ref.files.map((f) => path.basename(f)),
    ["gate-a.yml", "gate-b.yml", "standalone.yml", "windows.yml"],
  );
  assert.deepEqual([...ref.fileOf.keys()], ["g2", "g1", "g3", "s", "w2", "w1"]);
  assert.deepEqual(
    readCapabilities(docOf(ref)).map((c) => c.id),
    ["g2", "g1", "g3", "s", "w2", "w1"],
  );
});
