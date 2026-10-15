// extension-hook-static-reads.test.ts — the two Bash suites that read the file names of the
// extension hooks accept exactly the states {sh}, {sh,ts} and {ts} per hook, and fail on {}
// (spec 0258 R30, R35; PLAN v2 steps 1-3).
//
// `realHelloWorld()` and the scaffolder copy whatever the checkout tracks, so once the example
// hooks gain a `.ts` twin and then lose the `.sh`, the suites must keep passing at every step.
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
    if (rel === "" || /^hooks\/[A-Za-z0-9_-]+\.sh$/.test(rel)) continue;
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
    assert.ok(expected.includes("hooks/prompt-logger.sh"), `${list} names the example hooks`);
    for (const first of STATES) {
      for (const second of STATES) {
        const accepted = first !== "none" && second !== "none";
        test(`${list}: prompt-logger ${first}, shell-logger ${second} -> ${accepted ? "match" : "vacuity guard"}`, () => {
          const root = pluginTree(expected, { "prompt-logger": first, "shell-logger": second });
          const result = bash(script, root, expected.join("\n"));
          assert.equal(result.status, accepted ? 0 : 2);
        });
      }
    }
  }

  test("a stray file still fails the comparison in every accepted state", () => {
    const expected = expectedList("EXPECTED_CLAUDE");
    for (const state of STATES.filter((s) => s !== "none")) {
      const root = pluginTree(expected, { "prompt-logger": state, "shell-logger": state });
      fs.writeFileSync(path.join(root, "hooks", "stray.ts"), "x\n");
      assert.equal(bash(script, root, expected.join("\n")).status, 1, state);
    }
  });

  test("a missing non-hook file still fails the comparison", () => {
    const expected = expectedList("EXPECTED_CLAUDE");
    const root = pluginTree(expected, { "prompt-logger": "ts", "shell-logger": "sh+ts" });
    fs.rmSync(path.join(root, "hooks", "hooks.json"));
    assert.equal(bash(script, root, expected.join("\n")).status, 1);
  });
});

describe("scaffolder suite: hook_file_present", () => {
  const helpers = block(BUILD, "hook-file-twin");
  const script = `${helpers}\nhook_file_present "$1" "$2"`;

  for (const state of STATES) {
    const accepted = state !== "none";
    test(`hooks/logger.sh probed with ${state} -> ${accepted ? "present" : "absent"}`, () => {
      const root = path.join(work, `scaffold-${counter++}`);
      fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
      for (const suffix of SPELLINGS[state]) {
        fs.writeFileSync(path.join(root, "hooks", `logger.${suffix}`), "x\n");
      }
      assert.equal(bash(script, root, "hooks/logger.sh").status, accepted ? 0 : 1);
    });
  }

  test("only a hooks/*.sh probe is widened to its .ts twin", () => {
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
    for (const name of HOOKS) assert.ok(expectedList(list).includes(`hooks/${name}.sh`));
  }
});
