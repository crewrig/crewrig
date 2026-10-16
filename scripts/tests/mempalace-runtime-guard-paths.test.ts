// mempalace-runtime-guard-paths.test.ts — the remaining paths of the launch-time
// version guard in scripts/lib/mempalace-http-wrapper.py (spec 0108, issue #623):
// Phase B disagreement, the stdlib fallback comparator, R2 (no out-of-process
// source decides), sys.path neutrality and the structural scans (G8-G13 of spec
// 0263). The wrapper runs for real under Python; see lib/mempalace-guard-fixture.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  assertRefusalFields,
  BELOW_FLOOR,
  buildFixture,
  cleanupScratch,
  fieldLine,
  hasLine,
  interpreterAvailable,
  PIN,
  PYTHON_BIN,
  pythonAbsolute,
  runGuard,
  SENTINEL,
  WRAPPER,
} from "./lib/mempalace-guard-fixture.ts";

before(() => {
  assert.ok(interpreterAvailable(), `interpreter not found: ${PYTHON_BIN}`);
});
after(cleanupScratch);

describe("G9 in-range disagreement is not a refusal", () => {
  test("post-release dist-info vs the plain attribute still serves", () => {
    const run = runGuard(
      buildFixture({ name: "post-release", dist: `${PIN.min}.post1`, attr: PIN.min }),
    );
    assert.equal(run.rc, 0, run.stderr);
    assert.equal(run.stdout.trimEnd(), SENTINEL);
  });
  test("an absent attribute makes Phase B a no-op", () => {
    const run = runGuard(buildFixture({ name: "absent-attr", dist: PIN.min, attr: null }));
    assert.equal(run.rc, 0, run.stderr);
  });
});

describe("G10 packaging shielded out: the fallback comparator carries the guard", () => {
  test("fallback below-floor refuses via stdlib-whitelist", () => {
    const run = runGuard(
      buildFixture({ name: "fb-below", dist: BELOW_FLOOR, attr: PIN.min, shield: true }),
    );
    assert.notEqual(run.rc, 0);
    assertRefusalFields(run, BELOW_FLOOR, "importlib.metadata", "stdlib-whitelist");
  });
  test("fallback in-range serves with exactly the sentinel", () => {
    const run = runGuard(
      buildFixture({ name: "fb-in", dist: PIN.min, attr: PIN.min, shield: true }),
    );
    assert.equal(run.rc, 0, run.stderr);
    assert.equal(run.stdout.trimEnd(), SENTINEL);
  });
  test("fallback refuses a non-canonical in-range-looking string", () => {
    const dist = `${PIN.min}-git`;
    const run = runGuard(buildFixture({ name: "fb-noncanon", dist, attr: PIN.min, shield: true }));
    assert.notEqual(run.rc, 0, "the fallback was more permissive than packaging");
    assertRefusalFields(run, dist, "importlib.metadata", "stdlib-whitelist");
  });
});

describe("G11 R2: no out-of-process source decides", () => {
  test(
    "liars on a replaced PATH cannot rescue a below-floor in-process version",
    { skip: process.platform === "win32" ? "needs #!/bin/sh stubs and symlinks (POSIX)" : false },
    () => {
      const root = buildFixture({ name: "liars", dist: BELOW_FLOOR, attr: PIN.min });
      const bin = path.join(root, "liarbin");
      fs.mkdirSync(bin);
      for (const liar of ["mempalace", "mempalace-mcp", "pipx", "uv", "pip"]) {
        fs.writeFileSync(path.join(bin, liar), `#!/bin/sh\necho "mempalace ${PIN.min}"\nexit 0\n`, {
          mode: 0o755,
        });
      }
      for (const tool of ["sh", "env"]) {
        const found = ["/bin", "/usr/bin"]
          .map((d) => path.join(d, tool))
          .find((p) => fs.existsSync(p));
        if (found) fs.symlinkSync(found, path.join(bin, tool));
      }
      const run = runGuard(root, { env: { PATH: bin }, python: pythonAbsolute() });
      assert.notEqual(run.rc, 0, "a forbidden source decided the verdict");
      const want = fieldLine(
        "MemPalace version found:",
        `${BELOW_FLOOR}  (source: importlib.metadata)`,
      );
      assert.ok(hasLine(run.stderr, want), run.stderr);
    },
  );
});

describe("G12 the guard leaves sys.path as it found it", () => {
  test("under -P the guard's own entry does not outlive its import", () => {
    const probe = spawnSync(PYTHON_BIN, ["-P", "-c", "pass"], { stdio: "ignore" });
    assert.equal(
      probe.status,
      0,
      "this interpreter does not support -P (needs CPython >= 3.11, which CI pins)",
    );
    const run = runGuard(
      buildFixture({ name: "syspath-neutral", dist: PIN.min, attr: PIN.min, probe: true }),
      {
        flags: ["-P"],
      },
    );
    assert.equal(run.rc, 0, run.stderr);
    assert.equal(
      run.stdout.trimEnd(),
      SENTINEL,
      "LIB_DIR_STILL_ON_SYS_PATH means scripts/lib/ leaked",
    );
  });
  test("without -P the interpreter's own script-directory entry is untouched", () => {
    const run = runGuard(
      buildFixture({ name: "syspath-default", dist: PIN.min, attr: PIN.min, probe: true }),
    );
    assert.equal(run.rc, 0, run.stderr);
    assert.equal(run.stdout.trimEnd(), "LIB_DIR_STILL_ON_SYS_PATH");
  });
});

describe("G13 structural assertions on the wrapper", () => {
  const lines = fs.readFileSync(WRAPPER, "utf8").split("\n");
  const lineOf = (re: RegExp): number => lines.findIndex((l) => re.test(l)) + 1;

  test("R5: no copy of either pin bound, searched as a bare substring", () => {
    const text = lines.join("\n");
    for (const bound of [PIN.min, PIN.max]) {
      assert.ok(!text.includes(bound), `bound literal '${bound}' present in the wrapper`);
    }
  });
  test("Phase A precedes `import chromadb`", () => {
    const a = lineOf(/^ {4}import mempalace_pin/);
    const chroma = lineOf(/^import chromadb as _chromadb/);
    assert.ok(a > 0 && chroma > 0 && a < chroma, `A=${String(a)} chromadb=${String(chroma)}`);
  });
  test("Phase B follows the mempalace import", () => {
    const b = lineOf(/^_MP_ATTR = getattr/);
    const handoff = lineOf(/^from mempalace\.mcp_server import main/);
    assert.ok(b > 0 && handoff > 0 && b > handoff, `B=${String(b)} import=${String(handoff)}`);
  });
  test("_refuse is defined before the sibling import", () => {
    const def = lineOf(/^def _refuse/);
    const a = lineOf(/^ {4}import mempalace_pin/);
    assert.ok(def > 0 && a > 0 && def < a, `def=${String(def)} import=${String(a)}`);
  });
});
