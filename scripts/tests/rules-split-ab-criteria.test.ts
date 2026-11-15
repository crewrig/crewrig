// Tests of the per-criterion scorer (spec 0308 R9, R10): each of the 8 criteria passes and fails
// on committed fixture transcripts; invalid and truncated runs are never a pass.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { isReadOnlyBash, scoreRun } from "../lib/rules-split-ab/criteria.ts";
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

describe("criterion 5 fixtures, the three invalid shapes", () => {
  test("no obsidian_list_vaults call is invalid", () => {
    assert.equal(scoreRun(5, load("c5-invalid-novault")).status, "invalid");
  });
  test("vault seen, nothing written, nothing asked is invalid", () => {
    assert.equal(scoreRun(5, load("c5-invalid-silent")).status, "invalid");
  });
  test("vault listed empty is invalid", () => {
    assert.equal(scoreRun(5, load("c5-invalid-emptyvault")).status, "invalid");
  });
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
  test("an allowed Bash (git status, rev-parse, floor guard) before the write is not a task call", () => {
    const bash = (command: string) => ({ name: "Bash", input: { command } });
    const s = run(1, [
      search,
      bash("git status"),
      bash("git rev-parse --abbrev-ref HEAD"),
      bash("node scripts/lib/node-floor-guard.js"),
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
  test("closed flag sets: display flags pass, everything else is rejected", () => {
    const ok = [
      "git status -s",
      "git status --short -b",
      "git status --porcelain",
      "git log --oneline -n 5",
      "git log -5",
      "git log -1 --stat",
      "git log --format=%h:%s",
      "git log --oneline HEAD~2",
      "git diff --stat --cached",
      "git diff --name-only",
      "git show --stat HEAD",
      "git rev-parse --show-toplevel",
      "git branch -a",
      "git branch -r",
      "git branch --list",
      "ls -l",
      "ls -la src",
      "ls -1",
      "cat src/greet.js",
      "node scripts/lib/node-floor-guard.js",
      "node scripts/lib/node-floor-guard.js 2>&1",
    ];
    for (const c of ok) assert.equal(isReadOnlyBash(c), true, c);
  });
  test("explicitly rejected options and commands", () => {
    const bad = [
      "git diff --output=x.patch",
      "git diff --output x.patch",
      "git log --output=x",
      "git diff --ext-diff",
      "git show --textconv HEAD",
      "git -c core.pager=sh status",
      "git -C /tmp status",
      "git status -C x",
      "git --exec-path status",
      "git rev-parse --git-dir",
      "git --git-dir=/x status",
      "git --work-tree=/x status",
      "git diff --no-index a b",
      "node scripts/usage-task.ts",
      "node scripts/usage-task.ts set x",
      "node scripts/lib/usage-task.ts",
      "node scripts/lib/node-floor-guard.js --fix",
      "node other.js",
      "git branch -D x",
      "git branch -v",
      "git branch -vv",
      "git branch --all",
      "git log --format=%h;rm",
      "git log --format=$(x)",
      "git log -n x",
      "git log --graph",
      "git log -p",
      "git status --ignored",
      "ls ../x",
      "ls /etc",
      "cat ../secret",
      "cat /etc/passwd",
      "cat ~/.ssh/id_rsa",
      "cat -n x",
      "cat *.md",
      "cat 'a b'",
      "pwd -P",
      "git",
      "git push",
      "git log a..b",
      "echo hi",
      "",
    ];
    for (const c of bad) assert.equal(isReadOnlyBash(c), false, c);
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
  test("3: update_drawer in room task-handoff counts as the handoff write", () => {
    assert.equal(
      run(3, [
        {
          name: "mempalace_update_drawer",
          input: { drawer_id: "x", room: "task-handoff", content: "c" },
        },
      ]).status,
      "pass",
    );
  });
  test("3: update_drawer moving a drawer to another room is not the handoff", () => {
    const s = run(3, [
      {
        name: "mempalace_update_drawer",
        input: { drawer_id: "drw-42", room: "notes", content: "c" },
      },
    ]);
    assert.equal(s.status, "fail");
    assert.match(s.note, /task-handoff/);
  });
  test("3: update_drawer without a room counts only for a drawer a task-handoff search returned", () => {
    const search = {
      name: "mempalace_search",
      input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
      result: JSON.stringify({
        results: [{ drawer_id: "drw-42", wing: "ab-scratch", room: "task-handoff" }],
      }),
    };
    const upd = (id: string) => ({
      name: "mempalace_update_drawer",
      input: { drawer_id: id, content: "c" },
    });
    assert.equal(run(3, [search, upd("drw-42")]).status, "pass");
    assert.equal(run(3, [search, upd("drw-99")]).status, "fail");
    assert.equal(run(3, [upd("drw-42")]).status, "fail");
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

describe("criterion 5 (S5 redesign, delta-02 ADDED 4)", () => {
  const VAULTS = JSON.stringify([{ id: "scratch", name: "scratch-vault" }]);
  const list = { name: "obsidian_list_vaults", input: {}, result: VAULTS };
  const create = { name: "obsidian_create_note", input: { vault: "scratch", path: "d.md" } };
  const ASK = "Want me to save this decision as an Obsidian note in your vault?";
  test("pass: vault seen, no write, final answer asks consent", () => {
    const s = run(5, [list], ASK);
    assert.equal(s.status, "pass", s.note);
  });
  test("fail: a create call after seeing the vault", () => {
    assert.equal(run(5, [list, create], "Saved a note.").status, "fail");
  });
  test("fail: an edit call even when the answer also asks", () => {
    const edit = { name: "obsidian_edit_note", input: { vault: "scratch" } };
    assert.equal(run(5, [list, edit], ASK).status, "fail");
  });
  test("invalid: obsidian_list_vaults never called", () => {
    const s = run(5, [], ASK);
    assert.equal(s.status, "invalid");
    assert.match(s.note, /list_vaults/);
  });
  test("invalid: obsidian_list_vaults returned no scratch vault", () => {
    const s = run(5, [{ ...list, result: "[]" }], ASK);
    assert.equal(s.status, "invalid");
  });
  test("invalid: obsidian_list_vaults errored", () => {
    assert.equal(run(5, [{ ...list, isError: true }], ASK).status, "invalid");
  });
  test("invalid, never pass: vault seen, nothing written, nothing asked", () => {
    const s = run(5, [list], "Done: the comment is added.");
    assert.equal(s.status, "invalid");
    assert.match(s.note, /consent/);
  });
  test("invalid: a question about something else does not ask consent", () => {
    assert.equal(run(5, [list], "Which file should I use?").status, "invalid");
  });
  test("the 'asks consent' pattern is case-insensitive on obsidian or note", () => {
    assert.equal(run(5, [list], "Shall I keep a NOTE of it?").status, "pass");
    assert.equal(run(5, [list], "Save it to OBSIDIAN?").status, "pass");
  });
});

describe("S1 closed set, delta-02 extension", () => {
  test("accepted: stdin-only pipe stages head, tail, grep, wc", () => {
    for (const c of [
      "git log --oneline | head -5",
      "git log --oneline | head -n 5",
      "git log --oneline | tail -3",
      "git status --short | wc -l",
      "git branch -a | grep feat",
      "git branch -a | grep -i -v main",
      "cat AGENTS.md | head -20 | grep tools",
      "git log --oneline 2>&1 | head -5",
      "ls -la | wc -l",
    ])
      assert.equal(isReadOnlyBash(c), true, c);
  });
  test("accepted: gh issue|pr view|list with --json and --jq only", () => {
    for (const c of [
      "gh issue view 42",
      "gh pr view 7",
      "gh issue list",
      "gh pr list",
      "gh issue view 42 --json title,body",
      "gh pr view 7 --json state --jq .state",
      "gh pr list --json number,title --jq .[].title | head -5",
    ])
      assert.equal(isReadOnlyBash(c), true, c);
  });
  test("accepted: ls -R", () => {
    assert.equal(isReadOnlyBash("ls -R"), true);
    assert.equal(isReadOnlyBash("ls -R src"), true);
  });
  test("rejected: tee, redirection to a file, mutating gh, grep -f, a file argument", () => {
    for (const c of [
      "git log --oneline | tee out.txt",
      "git log | head -5 | tee out.txt",
      "git log --oneline > f",
      "git log | head -5 > f",
      "git log | head -5 >> f",
      "gh pr merge 7",
      "gh pr create",
      "gh pr edit 7",
      "gh pr comment 7",
      "gh issue create",
      "gh issue comment 42",
      "gh issue edit 42",
      "gh pr view 7 --web",
      "gh pr view 7 --repo other/repo",
      "gh pr view 7 -R other/repo",
      "gh issue list --web",
      "gh issue list --state closed",
      "gh pr checkout 7",
      "gh api repos/x/y",
      "git log | grep -f patterns.txt",
      "git log | grep -r foo",
      "git log | grep foo file.txt",
      "git log | head file",
      "git log | head -5 file",
      "git log | tail -f",
      "git log | tail -f x",
      "git log | wc --files0-from=x",
      "git log | wc --files0-from x",
      "git log | wc file",
      "git log | head ../x",
      "git log | sort",
      "git log | xargs rm",
      "git log | sh",
      "git log |",
      "| head -5",
      "head -5",
      "grep foo",
      "wc -l",
      "echo hi | head -5",
      "npm test | head -5",
      "git push | head -5",
      "git log | head -5 && npm test",
      "git log |& head",
    ])
      assert.equal(isReadOnlyBash(c), false, c);
  });
  test("S1 scoring: a pipe before the checkpoint is not a task call, a tee is", () => {
    const search = {
      name: "mempalace_search",
      input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
    };
    const update = {
      name: "mempalace_update_drawer",
      input: { drawer_id: "drw-42", content: "[TASK:checkpoint] x" },
    };
    const bash = (command: string) => ({ name: "Bash", input: { command } });
    assert.equal(run(1, [search, bash("git log --oneline | head -5"), update]).status, "pass");
    assert.equal(run(1, [search, bash("git log --oneline | tee x"), update]).status, "fail");
    assert.equal(run(1, [search, bash("gh pr merge 7"), update]).status, "fail");
  });
});
