// setup-session-recording-ownership.test.ts — what the session-recording merge owns (spec 0256
// requirement 30; the unchanged Bash suites are the oracle through the shim). `sr_merge` of the
// Bash library strips the plain worktree-git-guard commands and the transcript commands the
// framework wrote, and nothing else: a guarded Windows guard command belongs to the guard
// registration and stays, like an operator's own command. Pure functions over JSON: no shell.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  allHandlers,
  isGuard,
  isTranscript,
  srMerge,
  type Json,
} from "../lib/setup/session-recording-merge.ts";

const GUARDED_GUARD =
  "set NoDefaultCurrentDirectoryInExePath=1&& node C:/work/x/crewrig/hooks/worktree-git-guard.ts";
const OLD_GUARD = 'node "/old/hooks/worktree-git-guard.ts"';
const OLD_GUARD_SH = 'bash "/old/hooks/worktree-git-guard.sh"';
const NEW_GUARD = 'node "/new/hooks/worktree-git-guard.ts"';
const OPERATOR = "echo operator";
const OPERATOR_GUARD = "bash /opt/tools/worktree-git-guard.sh";
const NEW_TRANSCRIPT = 'node "/new/hooks/mempalace-transcript.ts" claude-code';

/** Every shape of transcript command the merge owns (`direct`, `legacy-unmarked`, guarded direct). */
const OWNED_TRANSCRIPTS: readonly string[] = [
  'node "/old/hooks/mempalace-transcript.ts" claude-code',
  'bash "/old/hooks/mempalace-transcript.sh" claude-code',
  'bash "/old/hooks/mempalace-transcript.sh" stop',
  "set NoDefaultCurrentDirectoryInExePath=1&& node C:/old/hooks/mempalace-transcript.ts claude-code",
];

const handler = (command: string): Json => ({ type: "command", command });

/** A grouped (Claude Code, Gemini CLI) document: one `Bash`-matcher group on each event. */
const grouped = (pre: readonly string[], stop: readonly string[]): Json => ({
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: pre.map(handler) }],
    Stop: [{ hooks: stop.map(handler) }],
  },
});

/** A flat (Copilot CLI) document: an event holds handlers. */
const flat = (pre: readonly string[], stop: readonly string[]): Json => ({
  hooks: { PreToolUse: pre.map(handler), Stop: stop.map(handler) },
});

const commandsOf = (doc: Json, flatShape: boolean, event: string): string[] =>
  allHandlers(doc, flatShape)
    .filter((x) => x.event === event)
    .map((x) => (x.handler as Json)["command"] as string);

const MANIFEST = (flatShape: boolean): Json =>
  (flatShape ? flat : grouped)([NEW_GUARD], [NEW_TRANSCRIPT]);

for (const flatShape of [false, true]) {
  const make = flatShape ? flat : grouped;
  describe(`the session-recording merge ownership (${flatShape ? "flat" : "grouped"} shape)`, () => {
    test("a guarded Windows guard command is not owned: it survives beside the manifest's guard", () => {
      const config = make([GUARDED_GUARD], []);
      const merged = srMerge(config, MANIFEST(flatShape), flatShape);
      assert.deepEqual(commandsOf(merged, flatShape, "PreToolUse"), [GUARDED_GUARD, NEW_GUARD]);
    });

    test("an operator command, even one that names a worktree-git-guard script, is kept", () => {
      const config = make([OPERATOR, OPERATOR_GUARD], []);
      const merged = srMerge(config, MANIFEST(flatShape), flatShape);
      assert.deepEqual(commandsOf(merged, flatShape, "PreToolUse"), [
        OPERATOR,
        OPERATOR_GUARD,
        NEW_GUARD,
      ]);
    });

    test("a plain guard command of either twin is replaced by the manifest's one", () => {
      const config = make([OLD_GUARD, OLD_GUARD_SH, OPERATOR], []);
      const merged = srMerge(config, MANIFEST(flatShape), flatShape);
      const commands = commandsOf(merged, flatShape, "PreToolUse");
      assert.ok(!commands.includes(OLD_GUARD) && !commands.includes(OLD_GUARD_SH));
      assert.deepEqual(commands.toSorted(), [NEW_GUARD, OPERATOR].toSorted());
    });

    test("the three kinds together: only the plain guard and the transcripts are replaced", () => {
      const config = make([GUARDED_GUARD, OLD_GUARD, OPERATOR], [...OWNED_TRANSCRIPTS, OPERATOR]);
      const merged = srMerge(config, MANIFEST(flatShape), flatShape);
      assert.deepEqual(
        commandsOf(merged, flatShape, "PreToolUse").toSorted(),
        [GUARDED_GUARD, NEW_GUARD, OPERATOR].toSorted(),
      );
      assert.deepEqual(
        commandsOf(merged, flatShape, "Stop").toSorted(),
        [NEW_TRANSCRIPT, OPERATOR].toSorted(),
      );
    });

    test("a manifest without a guard spares every installed guard command, guarded or plain", () => {
      const config = make([GUARDED_GUARD, OLD_GUARD], []);
      const merged = srMerge(config, make([], [NEW_TRANSCRIPT]), flatShape);
      assert.deepEqual(commandsOf(merged, flatShape, "PreToolUse"), [GUARDED_GUARD, OLD_GUARD]);
    });
  });
}

describe("the ownership predicates", () => {
  test("isGuard owns the plain guard forms only", () => {
    assert.equal(isGuard(handler(OLD_GUARD)), true);
    assert.equal(isGuard(handler(OLD_GUARD_SH)), true);
    assert.equal(isGuard(handler(GUARDED_GUARD)), false);
    assert.equal(isGuard(handler(OPERATOR_GUARD)), false);
    assert.equal(isGuard(handler(OPERATOR)), false);
  });

  test("isTranscript owns every owned transcript shape, the guarded one included", () => {
    for (const command of OWNED_TRANSCRIPTS)
      assert.equal(isTranscript(handler(command)), true, command);
    assert.equal(isTranscript(handler(OPERATOR)), false);
    assert.equal(isTranscript(handler(GUARDED_GUARD)), false);
  });
});
