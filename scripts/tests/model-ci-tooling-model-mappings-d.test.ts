// model-ci-tooling-model-mappings-d.test.ts — the deliberate deviations of spec 0262
// requirement 24 for scripts/check-model-mappings.ts, asserted directly on the twin:
// (c) a yq runtime failure of the shell is one `Error: <path>: <reason>` line and exit 1,
// (d) a multi-document mapping is rejected the same way, (e) an offering id starting with
// `-` is taken literally, (f) an explicit tag is read as the tag says. Also the
// non-integer rank, which the shell survives with a `[` diagnostic.
//
// yq-absent exit 2 (check-model-mappings.sh:91-94, oracle case "exit 2 — yq absent from
// PATH"): the twin reads YAML itself and has no yq prerequisite (requirement 5), so that
// exit code has no equivalent; the test below shows the twin working with a PATH that has
// no yq at all.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/worktree-fixtures.ts";

const TS = path.join(REPO, "scripts", "check-model-mappings.ts");
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function repoWith(file: string, edit: (t: string) => string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cmmd-")));
  roots.push(root);
  fs.mkdirSync(path.join(root, "model-mappings"));
  for (const name of fs.readdirSync(path.join(REPO, "model-mappings"))) {
    const text = fs.readFileSync(path.join(REPO, "model-mappings", name), "utf8");
    fs.writeFileSync(path.join(root, "model-mappings", name), name === file ? edit(text) : text);
  }
  return root;
}

function ts(repo: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS, ...args],
    { encoding: "utf8", env: { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: repo, ...env } },
  );
}

const swap =
  (from: string, to: string) =>
  (t: string): string => {
    assert.notEqual(t.replace(from, to), t, `mutation did not apply: ${from}`);
    return t.replace(from, to);
  };

/** Exactly one `Error:` line on stderr and nothing else. */
function oneError(stderr: string, file: string, reason: RegExp): void {
  const lines = stderr.trimEnd().split("\n");
  assert.equal(lines.length, 1, stderr);
  assert.match(lines[0] ?? "", new RegExp(`^Error: .*${file.replace(".", "\\.")}: `));
  assert.match(lines[0] ?? "", reason);
}

describe("check-model-mappings.ts deviations (spec 0262 req 24)", () => {
  test("(c) an empty sequence where the shell's yq reads a key aborts with one Error line", () => {
    const repo = repoWith(
      "claude.yml",
      swap("    items:\n      - item: model\n", "    items:\n      - []\n      - item: model\n"),
    );
    const r = ts(repo);
    assert.equal(r.status, 1);
    oneError(r.stderr, "claude.yml", /cannot index array with 'item'/);
  });

  test("(c) an empty sequence as a grounds entry aborts with one Error line", () => {
    const repo = repoWith(
      "gemini.yml",
      swap(
        "        grounds:\n          - declares: key\n",
        "        grounds:\n          - []\n          - declares: key\n",
      ),
    );
    const r = ts(repo);
    assert.equal(r.status, 1);
    oneError(r.stderr, "gemini.yml", /cannot index array with 'declares'/);
  });

  test("(c) a null node where keys aborts the shell is one Error line", () => {
    const repo = repoWith("gemini.yml", (t) => t.replace(/ {6}intelligence: (flash|pro)\n/g, ""));
    const r = ts(repo);
    assert.equal(r.status, 1);
    oneError(r.stderr, "gemini.yml", /cannot get keys of !!null/);
  });

  test("(c) a non-integer rank stops with one Error line, in both modes", () => {
    const repo = repoWith("gemini.yml", swap("rank: 2", "rank: abc"));
    for (const args of [[], ["--print-selection"]]) {
      const r = ts(repo, args);
      assert.equal(r.status, 1);
      oneError(r.stderr, "gemini.yml", /offering rank 'abc' is not an integer/);
    }
  });

  test("(d) a multi-document mapping is one Error line and exit 1", () => {
    const repo = repoWith("gemini.yml", (t) => `${t}\n---\ntarget: gemini\n`);
    const r = ts(repo);
    assert.equal(r.status, 1);
    oneError(r.stderr, "gemini.yml", /./);
    assert.equal(ts(repo, ["--print-selection"]).status, 1);
  });

  test("(e) an offering id starting with '-' is accepted and printed literally", () => {
    const repo = repoWith("gemini.yml", swap("id: gemini-3.1-flash-lite", "id: -dash"));
    assert.equal(ts(repo).status, 0);
    const r = ts(repo, ["--print-selection"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^model-mappings\/gemini\tminimal\t-dash$/m);
  });

  test("(f) an explicit !!str tag reads as the string it tags; an unknown tag is one Error line", () => {
    assert.equal(
      ts(repoWith("gemini.yml", swap("target: gemini", "target: !!str gemini"))).status,
      0,
    );
    const r = ts(repoWith("gemini.yml", swap("target: gemini", "target: !foo gemini")));
    assert.equal(r.status, 1);
    oneError(r.stderr, "gemini.yml", /unknown tag/);
  });

  test("no yq prerequisite: the twin runs with a PATH that holds no yq", () => {
    const r = ts(REPO, [], { PATH: path.dirname(process.execPath) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^OK: 8 mapping file\(s\) conform\.$/m);
  });
});
