// prerequisites.ts — the prerequisite and identity checks at the top of every setup (spec 0256
// requirement 21, plan v2 step B1.10; deviation (a): the `fzf` and `jq` guards are removed). The
// lookup is `findOnPath` of scripts/lib/mempalace-python.ts (`PATHEXT` on Windows). Layer 1.

import fs from "node:fs";
import path from "node:path";

import type { Cli, SetupCtx, Spawner } from "./context.ts";
import { SetupExit } from "./exit.ts";
import { createSpawner } from "./spawner.ts";
import { findOnPath } from "../mempalace-python.ts";

type PrereqCtx = Pick<SetupCtx, "io" | "env" | "platform" | "repoDir" | "cli">;

function onPath(ctx: PrereqCtx, name: string): boolean {
  return findOnPath(name, { ...ctx.env }, { platform: ctx.platform }) !== undefined;
}

/** The tool presence checks of one CLI's setup; throws `SetupExit(1)` after printing when one is missing. */
export function checkPrerequisites(ctx: PrereqCtx, spawn?: Spawner): void {
  if (ctx.cli === "claude" && !onPath(ctx, "claude")) {
    ctx.io.out("Error: 'claude' CLI is required to register MCP servers.");
    ctx.io.out("Install Claude Code: https://docs.claude.com/en/docs/claude-code/setup");
    throw new SetupExit(1);
  }
  if (ctx.cli === "antigravity" && !onPath(ctx, "agy")) {
    ctx.io.out("Error: 'agy' binary not found in PATH.");
    ctx.io.out("Install Antigravity CLI: https://docs.antigravity.ai/install");
    throw new SetupExit(1);
  }
  if (ctx.cli === "copilot") {
    const run = spawn ?? createSpawner(ctx);
    if (run(["gh", "copilot", "--help"]).status !== 0 && !onPath(ctx, "copilot")) {
      ctx.io.out("Warning: GitHub Copilot CLI not detected.");
      ctx.io.out("  Install with: gh extension install github/gh-copilot");
      ctx.io.out("  or follow: https://docs.github.com/copilot/github-copilot-in-the-cli");
      ctx.io.out("  Proceeding anyway — settings files will be written to the repo.");
      ctx.io.out("");
    }
  }
}

/** How each CLI is invoked to run one of the identity skills. */
export function identityInvocation(cli: Cli, skill: string): string {
  if (cli === "copilot") return `copilot -i "${skill}"`;
  if (cli === "antigravity") return `agy -i "${skill}" --new-project`;
  return `${cli} ${skill}`;
}

/** `config/SOUL.md` and `config/PROFILE.md` must exist; otherwise print the list and exit 1. */
export function checkIdentity(ctx: PrereqCtx): void {
  const required: readonly (readonly [string, string])[] = [
    ["config/SOUL.md", "/init-soul"],
    ["config/PROFILE.md", "/init-personal-profile"],
  ];
  const missing: string[] = [];
  for (const [label, skill] of required) {
    let present = false;
    try {
      present = fs.statSync(path.join(ctx.repoDir, label)).isFile();
    } catch {
      present = false;
    }
    if (!present) missing.push(`${label} is missing — run: ${identityInvocation(ctx.cli, skill)}`);
  }
  if (missing.length === 0) return;
  ctx.io.out("Cannot proceed — required identity files are missing:");
  for (const item of missing) ctx.io.out(`  - ${item}`);
  ctx.io.out("");
  ctx.io.out("Generate them BEFORE re-running this script.");
  throw new SetupExit(1);
}
