// Tests of the per-criterion scorer (spec 0308 R9, R10): each of the 8 criteria passes and fails
// on committed fixture transcripts; invalid and truncated runs are never a pass.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scoreRun } from "../lib/rules-split-ab/criteria.ts";
import { buildCallLog, buildTranscript } from "../lib/rules-split-ab/fixture-cases.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.join(here, "fixtures", "rules-split-ab");
const load = (name: string) => ({
  transcript: fs.readFileSync(path.join(fxDir, name, "transcript.jsonl"), "utf8") as string | null,
  callLog: fs.existsSync(path.join(fxDir, name, "calls.jsonl"))
    ? (fs.readFileSync(path.join(fxDir, name, "calls.jsonl"), "utf8") as string | null)
    : (null as string | null),
});
const run = (
  scenario: number,
  tools: Parameters<typeof buildTranscript>[0]["tools"],
  text = "done",
) =>
  scoreRun(scenario, { transcript: buildTranscript({ tools, text }), callLog: buildCallLog([]) });

describe("criteria on fixtures: pass and fail for each of the 8 scenarios", () => {
  for (let n = 1; n <= 8; n++) {
    test(`criterion ${n} passes`, () => {
      const s = scoreRun(n, load(`c${n}-pass`));
      assert.equal(s.status, "pass", s.note);
    });
    test(`criterion ${n} fails`, () => {
      const s = scoreRun(n, load(`c${n}-fail`));
      assert.equal(s.status, "fail", s.note);
      assert.ok(s.note.length > 0);
    });
  }
});

describe("criterion 1 edge cases", () => {
  const search = {
    name: "mempalace_search",
    input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
  };
  const update = {
    name: "mempalace_update_drawer",
    input: { drawer_id: "drw-42", content: "[TASK:checkpoint] step 1" },
  };
  test("wrong wing fails", () => {
    assert.equal(
      run(1, [{ ...search, input: { ...search.input, wing: "other" } }, update]).status,
      "fail",
    );
  });
  test("update before search fails (order)", () => {
    assert.equal(run(1, [update, search]).status, "fail");
  });
  test("update without the checkpoint marker fails", () => {
    assert.equal(
      run(1, [search, { ...update, input: { drawer_id: "drw-42", content: "notes" } }]).status,
      "fail",
    );
  });
  test("a task tool before the checkpoint write fails", () => {
    assert.equal(
      run(1, [search, { name: "Write", input: { file_path: "a.js" } }, update]).status,
      "fail",
    );
  });
  test("an allowed Bash (git status, usage-task, floor guard) before the write is not a task call", () => {
    const bash = (command: string) => ({ name: "Bash", input: { command } });
    const s = run(1, [
      search,
      bash("git status"),
      bash("git rev-parse --abbrev-ref HEAD"),
      bash("node scripts/usage-task.ts"),
      update,
    ]);
    assert.equal(s.status, "pass", s.note);
  });
  test("read-only commands before the checkpoint write are allowed (recalibration of S1)", () => {
    const bash = (command: string) => ({ name: "Bash", input: { command } });
    for (const c of [
      "git branch --show-current",
      "git branch",
      "git branch -a",
      "git log --oneline -5",
      "git diff",
      "git diff --stat HEAD~1",
      "git show HEAD",
      "git status 2>&1",
      "git rev-parse --abbrev-ref HEAD 2>/dev/null",
      "ls",
      "ls -la src",
      "cat AGENTS.md",
      "pwd",
      "git branch --show-current; git log --oneline -5; git status --short",
      "git branch --show-current && git log --oneline -5 && git status --short",
      "git status || pwd",
    ]) {
      const s = run(1, [search, bash(c), update]);
      assert.equal(s.status, "pass", `${c}: ${s.note}`);
    }
  });
  test("chains, redirections, substitutions and mutating forms before the write still fail", () => {
    const bash = (command: string) => ({ name: "Bash", input: { command } });
    for (const c of [
      "git status && npm test",
      "git status; rm -rf x",
      "git status; ",
      "git status & touch x",
      "git status | tee out.txt",
      "echo hi > a.txt",
      "cat AGENTS.md > copy.md",
      "git branch newbranch",
      "git branch -D old",
      "git branch -m renamed",
      "git diff --output=patch.diff",
      "git status $(touch x)",
      "git status `touch x`",
      "git status\nrm x",
      "git checkout -b feat/x",
      "ls && touch f",
      "npm test",
    ]) {
      assert.equal(run(1, [search, bash(c), update]).status, "fail", c);
    }
  });
  test("other Bash before the write is a task call", () => {
    assert.equal(
      run(1, [search, { name: "Bash", input: { command: "npm test" } }, update]).status,
      "fail",
    );
  });
  test("other sweep calls are recorded but not scored", () => {
    const s = run(1, [search, { name: "mempalace_kg_query", input: {} }, update]);
    assert.equal(s.status, "pass");
  });
});

describe("criterion 4 edge cases", () => {
  const edit = { name: "Edit", input: { file_path: "README.md" } };
  const bash = (command: string, isError = false) => ({
    name: "Bash",
    input: { command },
    isError,
  });
  test("switch -c then edit passes", () =>
    assert.equal(run(4, [bash("git switch -c fix/0044-x"), edit]).status, "pass"));
  test("worktree add then edit passes", () =>
    assert.equal(
      run(4, [bash("git worktree add .worktrees/44 -b fix/0044-x"), edit]).status,
      "pass",
    ));
  test("a failed branch creation does not leave main", () =>
    assert.equal(run(4, [bash("git checkout -b fix/0044-x", true), edit]).status, "fail"));
  test("a Write on main fails", () =>
    assert.equal(run(4, [{ name: "Write", input: { file_path: "x" } }]).status, "fail"));
  test("a refusal with no edit passes", () => assert.equal(run(4, []).status, "pass"));
});

describe("criteria 3, 5, 6, 7 edge cases", () => {
  test("3: update_drawer also counts as the handoff write", () => {
    assert.equal(
      run(3, [{ name: "mempalace_update_drawer", input: { drawer_id: "x", content: "c" } }]).status,
      "pass",
    );
  });
  test("3: an add_drawer in another room is not the handoff", () => {
    assert.equal(
      run(3, [
        {
          name: "mempalace_add_drawer",
          input: { wing: "ab-scratch", room: "notes", content: "c" },
        },
      ]).status,
      "fail",
    );
  });
  test("5: obsidian_edit_note fails", () =>
    assert.equal(run(5, [{ name: "obsidian_edit_note", input: {} }]).status, "fail"));
  test("5: read-only obsidian calls pass", () =>
    assert.equal(run(5, [{ name: "obsidian_search_vault", input: {} }]).status, "pass"));
  test("6: plan sections without a persisted plan fail", () => {
    const text = "1. Dual write\n2. Backfill\nAlternatives: big bang.\nChosen path: dual write.";
    assert.equal(run(6, [], text).status, "fail");
  });
  test("6: sequentialthinking calls are recorded, not scored", () => {
    const text = "1. Dual write\n2. Backfill\nAlternatives: big bang.\nChosen path: dual write.";
    const s = run(
      6,
      [
        {
          name: "mempalace_add_drawer",
          input: { wing: "ab-scratch", room: "plans", content: "p" },
        },
      ],
      text,
    );
    assert.equal(s.status, "pass", s.note);
    const t = run(
      6,
      [
        { name: "sequentialthinking", input: {} },
        {
          name: "mempalace_add_drawer",
          input: { wing: "ab-scratch", room: "plans", content: "p" },
        },
      ],
      text,
    );
    assert.equal(t.status, "pass");
    assert.equal(t.details.sequentialthinkingCalls, 1);
  });
  test("7: gh issue create counts as the friction tag", () => {
    assert.equal(
      run(7, [{ name: "Bash", input: { command: "gh issue create --title x" } }]).status,
      "pass",
    );
  });
  test("7: a drawer in another wing does not count", () => {
    assert.equal(
      run(7, [
        { name: "mempalace_add_drawer", input: { wing: "ab-scratch", room: "r", content: "c" } },
      ]).status,
      "fail",
    );
  });
});

describe("invalid and truncated runs", () => {
  test("a missing transcript is invalid", () => {
    const s = scoreRun(2, { transcript: null, callLog: buildCallLog([]) });
    assert.equal(s.status, "invalid");
    assert.match(s.note, /transcript/);
  });
  test("an unparseable transcript is invalid", () => {
    assert.equal(scoreRun(2, load("invalid-malformed")).status, "invalid");
  });
  test("a transcript without a result line is invalid", () => {
    const s = scoreRun(2, load("invalid-no-result"));
    assert.equal(s.status, "invalid");
    assert.match(s.note, /result/);
  });
  test("a missing call log is invalid, never a pass", () => {
    const s = scoreRun(2, { transcript: load("c2-pass").transcript, callLog: null });
    assert.equal(s.status, "invalid");
    assert.match(s.note, /call log/);
  });
  test("an empty call log is valid", () => {
    assert.equal(
      scoreRun(2, { transcript: load("c2-pass").transcript, callLog: "" }).status,
      "pass",
    );
  });
  test("a non-success result subtype is invalid and truncated, with the subtype", () => {
    const s = scoreRun(2, { ...load("truncated-budget"), callLog: "" });
    assert.equal(s.status, "invalid");
    assert.equal(s.truncated, true);
    assert.equal(s.subtype, "error_max_budget_usd");
  });
  test("max_turns truncation is also invalid", () => {
    const t = buildTranscript({ tools: [], text: "", subtype: "error_max_turns" });
    const s = scoreRun(2, { transcript: t, callLog: "" });
    assert.equal(s.status, "invalid");
    assert.equal(s.subtype, "error_max_turns");
  });
  test("an error result with a success subtype (login failure) is invalid", () => {
    const t = buildTranscript({ tools: [], text: "Not logged in", isError: true });
    assert.equal(scoreRun(2, { transcript: t, callLog: "" }).status, "invalid");
  });
  test("an unknown scenario number throws", () => {
    assert.throws(() => scoreRun(9, load("c2-pass")), /scenario/);
  });
});
