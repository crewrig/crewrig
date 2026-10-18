// extension-hook-static-reads.test.ts — the TypeScript helpers that read the file names of the
// extension hooks accept exactly the state {ts} per hook, and fail on {} (the entry is missing) and
// on {sh} or {sh,ts} (the retired shell spelling is back) (spec 0258 R17, R30, R35).
//
// `realHelloWorld()` and the scaffolder copy whatever the checkout tracks, so the helpers name the
// `.ts` files only; the vacuity guards keep that check from passing on a tree that has lost an entry.
// The helpers are `hookFileSetsMatch` (lib/extension-render-conformance.ts, formerly the
// `hook-file-states` block of the conformance Bash suite) and `hookFilePresent`
// (lib/extension-sandbox.ts, formerly the `hook-file-twin` block of the build Bash suite); this test
// drives them on trees synthesised in a temp dir.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  EXPECTED_ANTIGRAVITY,
  EXPECTED_CLAUDE,
  EXPECTED_COPILOT,
  hookFileSetsMatch,
  listFiles,
  type HookSetResult,
} from "./lib/extension-render-conformance.ts";
import { hookFilePresent } from "./lib/extension-sandbox.ts";

const LISTS: Readonly<Record<string, readonly string[]>> = {
  EXPECTED_CLAUDE,
  EXPECTED_COPILOT,
  EXPECTED_ANTIGRAVITY,
};
const STATUS: Readonly<Record<HookSetResult, number>> = { match: 0, mismatch: 1, vacuity: 2 };

function expectedList(name: string): string[] {
  const list = LISTS[name];
  assert.ok(list !== undefined, `no ${name} list`);
  return [...list];
}

type State = "sh" | "sh+ts" | "ts" | "none";
const SPELLINGS: Readonly<Record<State, readonly string[]>> = {
  sh: ["sh"],
  "sh+ts": ["sh", "ts"],
  ts: ["ts"],
  none: [],
};
const STATES = Object.keys(SPELLINGS) as State[];
const HOOKS = ["prompt-logger", "shell-logger"] as const;

let work = "";
before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "hook-static-reads-"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

let counter = 0;
/** A plugin tree whose hooks carry the given spellings (other files come from `expected`). */
function pluginTree(expected: readonly string[], states: Readonly<Record<string, State>>): string {
  const root = path.join(work, `tree-${counter++}`);
  for (const rel of expected) {
    if (rel === "" || /^hooks\/[A-Za-z0-9_-]+\.(sh|ts)$/.test(rel)) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "x\n");
  }
  for (const [name, state] of Object.entries(states)) {
    for (const suffix of SPELLINGS[state]) {
      fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
      fs.writeFileSync(path.join(root, "hooks", `${name}.${suffix}`), "x\n");
    }
  }
  return root;
}

describe("conformance helper: hookFileSetsMatch", () => {
  const run = (root: string, expected: readonly string[]): { status: number } => ({
    status: STATUS[hookFileSetsMatch(listFiles(root), expected, HOOKS)],
  });

  for (const list of Object.keys(LISTS)) {
    const expected = expectedList(list);
    for (const name of HOOKS) {
      assert.ok(expected.includes(`hooks/${name}.ts`), `${list} names ${name}.ts`);
      assert.ok(!expected.includes(`hooks/${name}.sh`), `${list} no longer names ${name}.sh`);
    }
    for (const first of STATES) {
      for (const second of STATES) {
        const accepted = first === "ts" && second === "ts";
        test(`${list}: prompt-logger ${first}, shell-logger ${second} -> ${accepted ? "match" : "vacuity guard"}`, () => {
          const root = pluginTree(expected, { "prompt-logger": first, "shell-logger": second });
          const result = run(root, expected);
          assert.equal(result.status, accepted ? 0 : 2);
        });
      }
    }
  }

  test("a stray file still fails the comparison", () => {
    const expected = expectedList("EXPECTED_CLAUDE");
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "ts" });
    fs.writeFileSync(path.join(root, "hooks", "stray.ts"), "x\n");
    assert.equal(run(root, expected).status, 1);
  });

  test("a missing non-hook file still fails the comparison", () => {
    const expected = expectedList("EXPECTED_CLAUDE");
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "ts" });
    fs.rmSync(path.join(root, "hooks", "hooks.json"));
    assert.equal(run(root, expected).status, 1);
  });

  test("an expected list that names the old .sh spelling is a mismatch, never a match", () => {
    const expected = [...expectedList("EXPECTED_CLAUDE"), "hooks/other.sh"];
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "ts" });
    assert.equal(run(root, expected).status, 1);
  });
});

describe("scaffolder helper: hookFilePresent", () => {
  const probe = (root: string, file: string): { status: number } => ({
    status: hookFilePresent(root, file),
  });
  const scaffold = (state: State): string => {
    const root = path.join(work, `scaffold-${counter++}`);
    fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
    for (const suffix of SPELLINGS[state]) {
      fs.writeFileSync(path.join(root, "hooks", `logger.${suffix}`), "x\n");
    }
    return root;
  };

  for (const state of STATES) {
    const expected = state === "ts" ? 0 : state === "none" ? 1 : 2;
    test(`hooks/logger.ts probed with ${state} -> status ${expected}`, () => {
      assert.equal(probe(scaffold(state), "hooks/logger.ts").status, expected);
    });
  }

  test("a probe that names the retired hooks/logger.sh never passes", () => {
    for (const state of STATES) {
      assert.notEqual(probe(scaffold(state), "hooks/logger.sh").status, 0, state);
    }
  });

  test("a non-hook probe is the plain existence check", () => {
    const root = path.join(work, `scaffold-${counter++}`);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "index.ts"), "x\n");
    assert.equal(probe(root, "src/index.sh").status, 1);
    assert.equal(probe(root, "src/index.ts").status, 0);
  });
});

// The test names HOOKS so a rename of the example hooks fails here, not silently.
test("the conformance expected lists name the example hooks", () => {
  for (const list of Object.keys(LISTS)) {
    for (const name of HOOKS) assert.ok(expectedList(list).includes(`hooks/${name}.ts`));
  }
});
