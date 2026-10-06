// hook-guard-corpus.test.ts — recognition by content, in both twins (spec 0248
// R31; scenarios 20, 21; named edit v1-F5).
//
// One corpus, fixtures/worktree-guard/recognition-corpus.json, is run through
// the TypeScript recognition (scripts/lib/hook-recognition.ts with the guard's
// descriptor) and through the Bash predicate that classifies framework-owned
// session-recording handlers (`sr_is_guard` and `sr_is_transcript` in
// scripts/lib/usage-capture-optin.sh). They accept and reject the same
// commands. The one exception is stated in the corpus: the Antigravity CLI
// guarded form is recognised by the TypeScript descriptor only (its flag
// `guardedPrefix`); no Bash path ever sees it. v1-F5: `bash
// /opt/tools/worktree-git-guard.sh` has no `/hooks/` directory and is a guard
// on neither twin. The last block states what the flag means for a guarded
// command that turns up in a Claude Code, Gemini CLI or Copilot CLI
// configuration, in the rewrite and in the session-recording merge (plan D3).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { WORKTREE_GIT_GUARD } from "../lib/hook-descriptor.ts";
import { isHookCommand } from "../lib/hook-recognition.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { guardCommands, makeCheckout, wiring } from "./lib/guard-wiring-fixtures.ts";
import { cleanupAll, read, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

interface Row {
  readonly command: string;
  readonly guard: boolean;
  readonly note: string;
  readonly transcript?: boolean;
  readonly tsOnly?: boolean;
}

after(cleanupAll);

const CORPUS_FILE = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "worktree-guard",
  "recognition-corpus.json",
);
const CORPUS = JSON.parse(read(CORPUS_FILE)) as Row[];

describe("the corpus", () => {
  test("is not empty and holds both verdicts, the v1-F5 row and the look-alikes of scenario 21", () => {
    assert.ok(CORPUS.length >= 25);
    assert.ok(CORPUS.some((row) => row.guard) && CORPUS.some((row) => !row.guard));
    const commands = CORPUS.map((row) => row.command);
    assert.ok(commands.includes("bash /opt/tools/worktree-git-guard.sh"));
    assert.ok(commands.includes('node "/opt/tools/worktree-git-guard.ts" --strict'));
    assert.ok(
      commands.some((c) => c.includes("&& bash /srv/co/crewrig/hooks/worktree-git-guard.sh")),
    );
  });
});

describe("the TypeScript recognition", () => {
  for (const row of CORPUS) {
    const verdict = row.tsOnly === true ? true : row.guard;
    test(`${verdict ? "guard" : "not guard"}: ${JSON.stringify(row.command)} (${row.note})`, () => {
      assert.equal(isHookCommand(row.command, WORKTREE_GIT_GUARD), verdict);
    });
  }
});

describe("the Bash predicate agrees with it", { skip: SKIP_POSIX }, () => {
  const run = (predicate: string): string[] => {
    const res = bashLibs(
      `jq -c '.[]' ${JSON.stringify(CORPUS_FILE)} | while IFS= read -r row; do
         c="$(jq -r .command <<< "$row")"
         jq -n --arg shape grouped --arg c "$c" "$_UC_JQ_DEFS {type: \\"command\\", command: \\$c} | ${predicate}"
       done`,
    );
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim().split("\n");
  };

  test("sr_is_guard gives the corpus verdict for every row that is not TypeScript-only", () => {
    const got = run("sr_is_guard");
    assert.equal(got.length, CORPUS.length);
    CORPUS.forEach((row, i) => {
      assert.equal(got[i], String(row.guard), `${JSON.stringify(row.command)} (${row.note})`);
    });
  });

  test("sr_is_transcript accepts exactly the mempalace-transcript rows the framework owns (row C3, spec 0247 R24)", () => {
    const got = run("sr_is_transcript");
    CORPUS.forEach((row, i) => {
      assert.equal(
        got[i],
        String(row.transcript === true),
        `${JSON.stringify(row.command)} (${row.note})`,
      );
    });
  });

  test("a legacy and a direct guard are both owned, so the merge strips both and adds the manifest's one", () => {
    const got = bashLibs(
      `printf '%s\\n' '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"bash \\"/a/hooks/worktree-git-guard.sh\\""},{"type":"command","command":"node \\"/a/hooks/worktree-git-guard.ts\\""}]}]}}' > cfg.json
       jq -c --arg shape grouped "$_UC_JQ_DEFS sr_strip | .hooks" cfg.json`,
    );
    assert.equal(got.status, 0, got.stderr);
    assert.equal(got.stdout.trim(), "null");
  });
});

describe("a guarded command in a Claude Code, Gemini CLI or Copilot CLI configuration (D3; v1-F5)", () => {
  const GUARDED =
    "set NoDefaultCurrentDirectoryInExePath=1&& node C:/work/x/crewrig/hooks/worktree-git-guard.ts";
  const claude = (): string =>
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: GUARDED }] }] },
    });

  test("the rewrite leaves it as it is: it is already the direct form", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "claude.json");
    fs.writeFileSync(file, claude());
    const res = wiring("guard", "rewrite", "claude", "--config", file, "--repo", co.repo);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(file), claude(), "byte-identical");
    assert.match(res.stdout, /left .*already the direct form/);
  });

  test(
    "the session-recording merge does not own it either: it survives beside the manifest's guard",
    { skip: SKIP_POSIX },
    () => {
      const co = makeCheckout();
      const cfg = path.join(path.dirname(co.repo), "claude-merge.json");
      fs.writeFileSync(cfg, claude());
      const res = bashLibs(
        `render_session_recording_manifest claude ${JSON.stringify(co.repo)} ${JSON.stringify(co.manifest("claude"))} rendered.json \\
         && merge_session_recording_hooks claude ${JSON.stringify(cfg)} rendered.json`,
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const commands = guardCommands(JSON.parse(read(cfg)));
      assert.ok(
        commands.includes(GUARDED),
        "the guarded command is an operator's command to the Bash twin",
      );
      assert.ok(
        commands.includes(`node "${co.guard}"`),
        "and the manifest's guard is merged beside it",
      );
    },
  );
});
