// e2e-taskfile-surface.test.ts — the e2e entries of the Taskfile tree (spec 0261 R19). Migrated from
// test-e2e-taskfile.sh, test-e2e-runner-taskfile.sh and test-e2e-auth-taskfile.sh. The static
// reads run everywhere; the `task --list` checks skip when the go-task binary is absent.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { loadTaskfileTree, taskCmds } from "../lib/taskfile-tree.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const TREE = loadTaskfileTree(REPO);

/** Whether the tree defines a task with this effective name (`e2e:build:base`). */
const declared = (entry: string): boolean => TREE.byName.has(entry);
/** The raw definition of a task, serialised so a substring check stays structural (no YAML text). */
const defText = (name: string): string => JSON.stringify(TREE.byName.get(name)?.definition ?? null);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `task --list` output, or null when go-task is not installed. */
const taskList = (): string | null => {
  const r = spawnSync("task", ["--list", "--color=false"], { cwd: REPO, encoding: "utf8" });
  if (r.error !== undefined) return null;
  return `${r.stdout}${r.stderr}`;
};
const NO_TASK = "go-task binary not on PATH";

describe("e2e build and lock entries (issue #76)", () => {
  const ENTRIES = [
    "e2e:build",
    "e2e:build:base",
    "e2e:build:claude",
    "e2e:build:gemini",
    "e2e:build:copilot",
    "e2e:build:mempalace",
    "e2e:lock",
  ];
  for (const e of ENTRIES) {
    it(`declares ${e}`, () => {
      assert.ok(declared(e), e);
    });
  }
  it("per-CLI build targets reference E2E_IMG_PREFIX and E2E_DOCKER_DIR", () => {
    const text = ENTRIES.filter((e) => e !== "e2e:build")
      .map(defText)
      .join("\n");
    assert.ok(text.includes("{{.E2E_IMG_PREFIX}}"));
    assert.ok(text.includes("{{.E2E_DOCKER_DIR}}"));
  });
  it("task --list enumerates every entry", (t) => {
    const out = taskList();
    if (out === null) return t.skip(NO_TASK);
    for (const e of ENTRIES)
      assert.match(out, new RegExp(`(^|\\s)\\* ${esc(e)}:|(^|\\s)${esc(e)}:`), e);
  });
});

describe("e2e runner entries (issue #78)", () => {
  const NAMES = ["e2e:test", "e2e:test:scenario", "e2e:test:cli"];
  for (const n of NAMES) {
    it(`declares ${n}`, () => {
      assert.ok(declared(n), n);
    });
  }
  it("task --list shows each with a non-empty description", (t) => {
    const out = taskList();
    if (out === null) return t.skip(NO_TASK);
    for (const n of NAMES) assert.match(out, new RegExp(`^\\* ${esc(n)}:\\s+\\S`, "m"), n);
  });
  it("references {{.CLI_ARGS}}", () => {
    assert.ok(TREE.tasks.some((t) => JSON.stringify(t.definition).includes("{{.CLI_ARGS}}")));
  });
  it("e2e:test invokes tests/e2e/run.sh or run.ts", () => {
    assert.ok(declared("e2e:test"));
    const text = taskCmds(TREE, "e2e:test").join("\n");
    assert.match(text, /(bash .*tests\/e2e\/run\.sh|node .*tests\/e2e\/run\.ts)/);
  });
});

describe("e2e auth entries", () => {
  const NAMES = ["e2e:auth:claude", "e2e:auth:gemini", "e2e:auth:copilot"];
  for (const n of NAMES) {
    it(`declares ${n}`, () => {
      assert.ok(declared(n), n);
    });
  }
  it("task --list enumerates each with a non-empty desc", (t) => {
    const out = taskList();
    if (out === null) return t.skip(NO_TASK);
    for (const n of NAMES) {
      const line = out.split(/\r?\n/).find((l) => new RegExp(`^[*\\s]*${esc(n)}:`).test(l));
      assert.ok(line !== undefined, `'${n}' not listed in: ${out}`);
      const desc = line.slice(line.indexOf(": ") + 2).trim();
      assert.notEqual(desc, "", `'${n}' desc empty`);
    }
  });
  for (const cli of ["claude", "gemini"]) {
    it(`e2e:auth:${cli} references an image precondition`, () => {
      const text = defText(`e2e:auth:${cli}`);
      assert.match(text, new RegExp(`docker image inspect|e2e:build:${cli}`));
    });
  }
});
