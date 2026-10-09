// build-components-conformance-root.test.ts — the merge root of the shell/TypeScript
// conformance (spec 0250 R21, requirement 20). Linux only, spawning `bash` and `yq`; it
// retires with the shell library (row I2).
//
// R20: a root derived by the library (`<TMPDIR>/crewrig-mapping-<pid>`) is removed by
// `mappingMergeCleanup`, a caller's `MAPPING_MERGE_DIR` is never removed, and a root the
// current user does not own is not used: the core mapping is returned with a
// `merge-unavailable` note. Each implementation runs the same case; the outcomes, including
// the note and the handle, must agree.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { BUILDERS, casesOf, type Builder } from "./lib/mapping-fixtures.ts";
import {
  checkCase,
  parityGate,
  runShellResolve,
  runTwinResolve,
  type Outcome,
  type ResolveCase,
} from "./lib/shell-resolve-harness.ts";

const skip = parityGate();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-root-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const builder = BUILDERS.find((b) => b.name === "O2_replace") as Builder;
const mk = (name: string): string => (fs.mkdirSync(path.join(tmp, name)), path.join(tmp, name));

/** The first case of the O2 builder (an organisation file that merges), run by both sides. */
async function bothSides(extra: (side: "sh" | "ts") => Partial<ResolveCase>) {
  const base = casesOf(builder, tmp, builder.build(tmp))[0] as ResolveCase;
  const [shellCase, twinCase] = [
    { ...base, ...extra("sh") },
    { ...base, ...extra("ts") },
  ];
  const [shell] = await runShellResolve([shellCase]);
  const [twin] = runTwinResolve([twinCase]);
  return { shell: shell as Outcome, twin: twin as Outcome, shellCase, twinCase };
}

describe(
  "merge root: the shell library and its twin agree",
  skip === undefined ? {} : { skip },
  () => {
    test("a derived root is removed by the cleanup", async () => {
      const run = await bothSides((side) => ({ tmpDir: mk(`derived-${side}`), cleanup: true }));
      assert.deepEqual(checkCase(run.shellCase, run.shell, run.twin, []), []);
      for (const o of [run.shell, run.twin]) {
        assert.deepEqual([o.derivedBefore, o.derivedAfter], [1, 0], "created, then removed");
        assert.ok(o.handle.startsWith("<TMP>/crewrig-mapping-PID/"), o.handle);
      }
    });

    test("a caller's MAPPING_MERGE_DIR survives the cleanup", async () => {
      const run = await bothSides((side) => ({ mergeDir: mk(`kept-${side}`), cleanup: true }));
      assert.deepEqual(checkCase(run.shellCase, run.shell, run.twin, []), []);
      for (const side of ["sh", "ts"]) {
        assert.ok(fs.existsSync(path.join(tmp, `kept-${side}`, ".merges")), `${side} root removed`);
      }
    });

    // `/usr` is root-owned on Linux and macOS; as root the merge would write there, so skip.
    const foreign =
      process.getuid?.() !== 0 &&
      fs.existsSync("/usr") &&
      fs.statSync("/usr").uid !== process.getuid?.();
    test(
      "a root the current user does not own is not used",
      { skip: foreign ? false : "needs a foreign-owned directory and a non-root user" },
      async () => {
        const run = await bothSides(() => ({ mergeDir: "/usr" }));
        assert.deepEqual(checkCase(run.shellCase, run.shell, run.twin, []), []);
        const note = "mapping-merge-note\tclaude\tmerge-unavailable\troot=<MERGE>";
        for (const o of [run.shell, run.twin]) {
          assert.deepEqual(
            o.stderr,
            [note, note],
            "one per mapping lookup: the resolution, then the handle",
          );
          assert.ok(
            o.handle.endsWith("/model-mappings/claude.yml"),
            `core mapping expected: ${o.handle}`,
          );
        }
        assert.equal(fs.existsSync("/usr/.merges"), false);
      },
    );
  },
);
