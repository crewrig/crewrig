// guard-asserts.ts — assertions and payload helpers shared by the guard suites
// (worktree-guard-*.test.ts, spec 0248 R9, R10).

import assert from "node:assert/strict";

import type { Result } from "./worktree-fixtures.ts";

const REFUSAL_HEAD =
  "mempalace-git-guard: prohibited whole-tree operation in shared worktree '.worktrees/%s' refused (Spec 0114 R2 / Spec 0153 R2).";
const HINT =
  " Take an exclusive claim via 'node scripts/worktree-claim.ts take --agent <name>' or use 'run' before attempting whole-tree git operations.";

/** The refusal of R9 for a ticket: one line, the hint naming the TypeScript tool (R38(a)). */
export const refusal = (ticket: string): string => `${REFUSAL_HEAD.replace("%s", ticket)}${HINT}\n`;

/** A Claude Code `PreToolUse` payload. */
export const payload = (command: string, cwd: string): string =>
  JSON.stringify({ cwd, tool_input: { command } });

/** Exit 0 and zero bytes on both streams (R10). */
export function allowed(res: Result, why = ""): void {
  assert.equal(res.status, 0, `${why}\n${res.stderr}`);
  assert.equal(res.stdout, "", why);
  assert.equal(res.stderr, "", why);
}

/** Exit 1, nothing on standard output, exactly the refusal on standard error (R9). */
export function refused(res: Result, ticket: string, why = ""): void {
  assert.equal(res.status, 1, `${why}\n${res.stdout}${res.stderr}`);
  assert.equal(res.stdout, "", why);
  assert.equal(res.stderr, refusal(ticket), why);
}

/** An Antigravity `PreToolUse` payload: a `toolCall` envelope (R39). */
export const agyPayload = (command: string, cwd: string): string =>
  JSON.stringify({
    workspacePaths: [cwd],
    toolCall: { name: "run_command", args: { CommandLine: command } },
  });

/** An allow outcome for an Antigravity payload: exit 0, the single `ask` line, empty stderr (R40). */
export function askAnswer(res: Result, why = ""): void {
  assert.equal(res.status, 0, `${why}\n${res.stderr}`);
  assert.equal(res.stdout, '{"decision": "ask"}\n', why);
  assert.equal(res.stderr, "", why);
}

/** R39 as a test oracle: a parsed `toolCall` object, or unparsable text carrying `"toolCall"`. */
export function isAntigravityInput(input: string): boolean {
  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const call = (parsed as Record<string, unknown>)["toolCall"];
    return typeof call === "object" && call !== null && !Array.isArray(call);
  } catch {
    return input.includes('"toolCall"');
  }
}

/** An allow outcome for `input`: the `ask` line for an Antigravity payload, silence otherwise. */
export function allowedFor(res: Result, input: string, why = ""): void {
  if (isAntigravityInput(input)) askAnswer(res, why);
  else allowed(res, why);
}
