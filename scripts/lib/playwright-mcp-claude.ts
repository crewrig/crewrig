// playwright-mcp-claude.ts — the Claude Code adapter of `task setup:playwright-mcp`
// (spec 0245 R10): Claude Code is changed only through its own CLI, at user
// scope. The replaced registration is printed in full before any change, a
// failed `add` triggers an `add-json` restore of it, and a re-read of
// ~/.claude.json decides the outcome. That file is never written directly.
//
// Standard library only (spec 0240 R16).

import { CLI_LABEL, MSG, type Context, type Outcome } from "./playwright-mcp-contract.ts";
import { SERVER_NAME, classify, wrappedLaunch, type Cli } from "./playwright-mcp-shape.ts";

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Claude Code: changed only through its own CLI, user scope (R10). */
export async function processClaude(ctx: Context, file: string): Promise<Outcome> {
  const { deps, wrapper, samePath } = ctx;
  const cli: Cli = "claude";
  const label = CLI_LABEL[cli];
  const read = ctx.readEntry(cli, file);
  if (!read.ok) {
    deps.err(MSG.unreadable(label, file, read.reason));
    return "failed";
  }
  const verdict = classify(cli, read.entry, wrapper, samePath);
  if (verdict.kind === "wrapped-current") {
    deps.out(MSG.upToDate(label));
    return "already up to date";
  }
  if (verdict.kind === "custom") {
    deps.err(MSG.untouched(label, `${file} (user scope)`));
    return "left untouched";
  }

  const add = [
    "claude",
    "mcp",
    "add",
    "--scope",
    "user",
    SERVER_NAME,
    "--",
    ...wrappedLaunch(wrapper),
  ];
  let prior: string | null = null;
  if (verdict.kind !== "absent") {
    prior = JSON.stringify(read.entry);
    deps.out(
      verdict.kind === "legacy"
        ? MSG.convergingClaude(label, prior)
        : MSG.relocatingClaude(label, verdict.oldPath, wrapper, prior),
    );
    const remove = await deps.run(["claude", "mcp", "remove", "--scope", "user", SERVER_NAME]);
    if (remove.status !== 0) {
      deps.err(MSG.claudeCommandFailed(label, "claude mcp remove", firstLine(remove.stderr)));
      return "failed";
    }
  }
  const added = await deps.run(add);
  if (added.status !== 0) {
    deps.err(MSG.claudeCommandFailed(label, "claude mcp add", firstLine(added.stderr)));
    if (prior !== null) {
      const restore = await deps.run([
        "claude",
        "mcp",
        "add-json",
        "--scope",
        "user",
        SERVER_NAME,
        prior,
      ]);
      deps.err(
        restore.status === 0 ? MSG.claudeRestored(label) : MSG.claudeRestoreFailed(label, prior),
      );
    }
    return "failed";
  }

  const after = ctx.readEntry(cli, file);
  if (!after.ok || classify(cli, after.entry, wrapper, samePath).kind !== "wrapped-current") {
    deps.err(MSG.claudeVerifyFailed(label, file));
    return "failed";
  }
  if (verdict.kind === "absent") {
    deps.out(MSG.registeredClaude(label));
    return "registered";
  }
  return verdict.kind === "legacy" ? "converged" : "relocated";
}
