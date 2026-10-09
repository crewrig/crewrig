// build-components-cleanup.test.ts — temporary roots through the entry (spec 0250 R8, R16;
// spec Scenarios 13, 18; plan step 21): the `--check` staging root and the merge root the model
// library derives are removed on every exit path, a caller's `MAPPING_MERGE_DIR` root is left.
// Also the property Bash case M10 protected (R26): a derived root is removed, a caller's is not.
//
// An isolated `TMPDIR` per test makes "no stray `crewrig-*` entry" an exact assertion. The
// signal cases kill a long `--check` build (hundreds of tiers) once both roots exist; the
// build yields between tiers, so the handler runs at the next tier boundary. A process killed
// by a signal reports it as `signal` (the shell reports 128 + n for the same death).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { FixtureTree } from "./lib/build-fixture-tree.ts";
import {
  agent,
  cleanEnv,
  CONFIG,
  orgMapping,
  scratch,
  seedMappings,
  skill,
  strays,
} from "./fixtures/build-components/entry-kit.ts";

const PROFILE = ["metadata:", "  model:", "    intelligence: high"];
const POSIX = process.platform === "win32" ? "skipped: POSIX signals" : undefined;

/** A tree whose `claude` mapping has an organisation channel and whose agent has a profile. */
function orgTree(): FixtureTree {
  const tree = createFixtureTree();
  tree.config(CONFIG);
  seedMappings(tree);
  tree.mapping("claude.org.yml", orgMapping("claude"));
  tree.artifact("core/agents/ag/AGENT.md", agent("ag", "Body.\n", PROFILE));
  return tree;
}

const mergesOf = (dir: string): string[] =>
  fs.existsSync(path.join(dir, ".merges"))
    ? fs.readFileSync(path.join(dir, ".merges"), "utf8").split("\n").filter(Boolean)
    : [];

describe("a derived merge root is removed, a caller's is left (R8, R20; M10)", () => {
  test("the setup merges: a caller's root holds the counter and survives the run", () => {
    const tree = orgTree();
    const mergeDir = scratch("caller-");
    const tmp = scratch("tmp-");
    const res = tree.run(["--target", "claude"], {
      env: { MAPPING_MERGE_DIR: mergeDir, TMPDIR: tmp },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(
      mergesOf(mergeDir),
      ["claude"],
      "one merge, so the derived-root cases below are not vacuous",
    );
    assert.equal(fs.existsSync(mergeDir), true);
    assert.deepEqual(strays(tmp), []);
  });

  test("without MAPPING_MERGE_DIR the derived root under TMPDIR is gone after a build", () => {
    const tree = orgTree();
    const tmp = scratch("tmp-");
    const res = tree.run(["--target", "claude"], { env: { TMPDIR: tmp } });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /^mapping-merge/m, "a merge was made");
    assert.deepEqual(strays(tmp), []);
  });

  test("--resolve removes the derived root and exits 0", () => {
    const tree = orgTree();
    const tmp = scratch("tmp-");
    const res = tree.run(
      ["--resolve", tree.resolve("artifacts/core/agents/ag/AGENT.md"), "claude"],
      {
        env: { TMPDIR: tmp },
      },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^offering: /m);
    assert.deepEqual(strays(tmp), []);
  });

  test("--resolve leaves a caller's root intact", () => {
    const tree = orgTree();
    const mergeDir = scratch("caller-");
    const res = tree.run(
      ["--resolve", tree.resolve("artifacts/core/agents/ag/AGENT.md"), "claude"],
      {
        env: { MAPPING_MERGE_DIR: mergeDir },
      },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(mergesOf(mergeDir), ["claude"]);
  });
});

describe("the staging root is removed on every exit path (R8, R16; Scenario 13)", () => {
  test("on success, --check with an overlay tier", () => {
    const tree = orgTree();
    tree.artifact("community/skills/c/SKILL.md", skill("c"));
    assert.equal(tree.run([]).status, 0);
    tree.remove("dist");
    const tmp = scratch("tmp-");
    const res = tree.run(["--check"], { env: { TMPDIR: tmp } });
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /output root: .*crewrig-check-staging-[A-Za-z0-9]{6}/);
    assert.deepEqual(strays(tmp), []);
    assert.equal(tree.exists("dist"), false);
  });

  test("on a collision refusal, after the root was created (--check) and before any file is written", () => {
    const tree = orgTree();
    tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
    tree.artifact("core/commands/probe.md", `---\nname: probe\ndescription: d\n---\nB\n`);
    const tmp = scratch("tmp-");
    const res = tree.run(["--check", "--tier", "library"], { env: { TMPDIR: tmp } });
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /FAILED: two components would be installed under one name into one landing zone\./,
    );
    assert.deepEqual(strays(tmp), []);
    assert.equal(tree.exists(".claude"), false, "nothing written");
  });

  test("on a drift verdict (exit 1)", () => {
    const tree = orgTree();
    const tmp = scratch("tmp-");
    const res = tree.run(["--check"], { env: { TMPDIR: tmp } });
    assert.equal(res.status, 1);
    assert.match(res.stdout, /DRIFT:/);
    assert.deepEqual(strays(tmp), []);
  });

  test("on a thrown error in the middle of a run: both roots removed, the caller's left", () => {
    const tree = orgTree();
    const tmp = scratch("tmp-");
    const bad = path.join(scratch("none-"), "missing", "diag.log");
    const res = tree.run(["--check", "--diagnostics", bad], { env: { TMPDIR: tmp } });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /\nError: ENOENT/, "the error surfaces as an Error: line");
    assert.deepEqual(
      strays(tmp),
      [],
      "the derived merge root existed when the diagnostic was written",
    );
    const mergeDir = scratch("caller-");
    const again = tree.run(["--check", "--diagnostics", bad], {
      env: { TMPDIR: tmp, MAPPING_MERGE_DIR: mergeDir },
    });
    assert.equal(again.status, 1);
    assert.deepEqual(mergesOf(mergeDir), ["claude"]);
    assert.deepEqual(strays(tmp), []);
  });
});

/** A `--check` build long enough to kill in flight: `tiers` tiers, the agent in the first. */
function longTree(tiers = 500): FixtureTree {
  const tree = orgTree();
  tree.remove("artifacts/core/agents");
  tree.artifact("a0000/agents/ag/AGENT.md", agent("ag", "Body.\n", PROFILE));
  for (let i = 1; i < tiers; i += 1) {
    tree.artifact(`a${String(i).padStart(4, "0")}/skills/s${i}/SKILL.md`, skill(`s${i}`));
  }
  return tree;
}

/** Spawn the entry, send `signal` once both a staging and a merge root exist, return how it ended. */
function killWhenBothRootsExist(
  tree: FixtureTree,
  tmp: string,
  signal: NodeJS.Signals,
  env: Record<string, string> = {},
) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; seen: string[] }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [tree.resolve("scripts/build-components.ts"), "--check"],
        {
          env: cleanEnv({ TMPDIR: tmp, ...env }),
          stdio: "ignore",
        },
      );
      let seen: string[] = [];
      let sent = false;
      const deadline = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(`the build finished or stalled before both roots appeared: ${seen.join(", ")}`),
        );
      }, 60000);
      const poll = setInterval(() => {
        const now = strays(tmp);
        const staging = now.some((n) => n.startsWith("crewrig-check-staging-"));
        const merge =
          now.some((n) => n.startsWith("crewrig-mapping-")) ||
          env["MAPPING_MERGE_DIR"] !== undefined;
        if (!sent && staging && merge) {
          sent = true;
          seen = now;
          child.kill(signal);
        }
      }, 2);
      child.on("exit", (code, sig) => {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve({ code, signal: sig, seen });
      });
    },
  );
}

describe("a signal in flight removes both roots (R8)", { skip: POSIX }, () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test(`${signal}: the process dies by the signal, nothing is left under TMPDIR`, async () => {
      const tree = longTree();
      const tmp = scratch("tmp-");
      const res = await killWhenBothRootsExist(tree, tmp, signal);
      assert.equal(
        res.signal,
        signal,
        `it died by ${signal} (status ${res.code}); roots seen: ${res.seen.join(", ")}`,
      );
      assert.ok(res.seen.length >= 2, "both roots existed when the signal was sent");
      assert.deepEqual(strays(tmp), []);
    });
  }

  test("SIGTERM leaves a caller's MAPPING_MERGE_DIR intact", async () => {
    const tree = longTree();
    const tmp = scratch("tmp-");
    const mergeDir = scratch("caller-");
    const res = await killWhenBothRootsExist(tree, tmp, "SIGTERM", { MAPPING_MERGE_DIR: mergeDir });
    assert.equal(res.signal, "SIGTERM");
    assert.deepEqual(strays(tmp), []);
    assert.equal(fs.existsSync(mergeDir), true);
  });
});
