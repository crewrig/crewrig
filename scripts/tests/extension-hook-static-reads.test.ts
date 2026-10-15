// extension-hook-static-reads.test.ts — the two Bash suites that read the file names of the
// extension hooks accept exactly the state {ts} per hook, and fail on {} (the entry is missing) and
// on {sh} or {sh,ts} (the retired shell spelling is back) (spec 0258 R17, R30, R35).
//
// `realHelloWorld()` and the scaffolder copy whatever the checkout tracks, so the suites name the
// `.ts` files only; the vacuity guards keep that check from passing on a tree that has lost an entry.
// The helpers live inside the Bash suites (a new `.sh` file is refused by the ratchet); this test
// extracts the marked blocks and drives them through `bash -c` on trees synthesised in a temp dir.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CONFORMANCE = path.join(REPO, "scripts", "tests", "test-extension-render-conformance.sh");
const BUILD = path.join(REPO, "scripts", "tests", "test-build-extension.sh");

/** The text between `# BEGIN <marker>` and `# END <marker>` of a Bash suite. */
function block(file: string, marker: string): string {
  const text = fs.readFileSync(file, "utf8");
  const begin = text.indexOf(`# BEGIN ${marker}\n`);
  const end = text.indexOf(`# END ${marker}\n`);
  assert.ok(begin >= 0 && end > begin, `${path.basename(file)} has no ${marker} block`);
  return text.slice(begin, end);
}

/** The lines of the `read -r -d '' <name> <<'EOF'` heredoc of the conformance suite. */
function expectedList(name: string): string[] {
  const text = fs.readFileSync(CONFORMANCE, "utf8");
  const head = `read -r -d '' ${name} <<'EOF' || true\n`;
  const start = text.indexOf(head);
  assert.ok(start >= 0, `no ${name} heredoc`);
  const body = text.slice(start + head.length);
  return body.slice(0, body.indexOf("\nEOF\n")).split("\n");
}

function bash(script: string, ...args: string[]): { status: number | null; stdout: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  delete env["NODE_TEST_CONTEXT"];
  const run = spawnSync("bash", ["-c", script, "bash", ...args], { encoding: "utf8", env });
  return { status: run.status, stdout: run.stdout };
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

describe("conformance suite: hook_file_sets_match", () => {
  const helpers = block(CONFORMANCE, "hook-file-states");
  // The same listing pipeline assert_file_set uses.
  const script = `${helpers}
actual="$(cd "$1" && find . -type f | sed 's#^\\./##' | sort)"
expected="$(printf '%s\\n' "$2" | sort)"
hook_file_sets_match "$actual" "$expected" prompt-logger shell-logger`;

  for (const list of ["EXPECTED_CLAUDE", "EXPECTED_COPILOT", "EXPECTED_ANTIGRAVITY"]) {
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
          const result = bash(script, root, expected.join("\n"));
          assert.equal(result.status, accepted ? 0 : 2);
        });
      }
    }
  }

  test("a stray file still fails the comparison", () => {
    const expected = expectedList("EXPECTED_CLAUDE");
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "ts" });
    fs.writeFileSync(path.join(root, "hooks", "stray.ts"), "x\n");
    assert.equal(bash(script, root, expected.join("\n")).status, 1);
  });

  test("a missing non-hook file still fails the comparison", () => {
    const expected = expectedList("EXPECTED_CLAUDE");
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "ts" });
    fs.rmSync(path.join(root, "hooks", "hooks.json"));
    assert.equal(bash(script, root, expected.join("\n")).status, 1);
  });

  test("an expected list that names the old .sh spelling is a mismatch, never a match", () => {
    const expected = [...expectedList("EXPECTED_CLAUDE"), "hooks/other.sh"];
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "ts" });
    assert.equal(bash(script, root, expected.join("\n")).status, 1);
  });
});

describe("scaffolder suite: hook_file_present", () => {
  const helpers = block(BUILD, "hook-file-twin");
  const script = `${helpers}\nhook_file_present "$1" "$2"`;
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
      assert.equal(bash(script, scaffold(state), "hooks/logger.ts").status, expected);
    });
  }

  test("a probe that names the retired hooks/logger.sh never passes", () => {
    for (const state of STATES) {
      assert.notEqual(bash(script, scaffold(state), "hooks/logger.sh").status, 0, state);
    }
  });

  test("a non-hook probe is the plain existence check", () => {
    const root = path.join(work, `scaffold-${counter++}`);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "index.ts"), "x\n");
    assert.equal(bash(script, root, "src/index.sh").status, 1);
    assert.equal(bash(script, root, "src/index.ts").status, 0);
  });
});

// The test names HOOKS so a rename of the example hooks fails here, not silently.
test("the conformance expected lists name the example hooks", () => {
  for (const list of ["EXPECTED_CLAUDE", "EXPECTED_COPILOT", "EXPECTED_ANTIGRAVITY"]) {
    for (const name of HOOKS) assert.ok(expectedList(list).includes(`hooks/${name}.ts`));
  }
});
