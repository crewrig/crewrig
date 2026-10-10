// antigravity-tier.ts — `install_antigravity_tier_to_home` and the supersession migration of
// scripts/setup-antigravity-interactive.sh (spec 0256 requirement 24, plan v2 step B2b.6). Twin of
// scripts/lib/common.sh `install_antigravity_tier_to_home` (changed together; the messages are
// byte for byte). Both kinds are directory-shaped (`<name>/SKILL.md`, `<name>/AGENT.md`) and land
// in `~/.gemini/config/{skills,agents}`; presence at the destination is asserted BEFORE the
// `Installed ...` line is printed (R5), a shortfall is named (R4), and a kind that staged
// components and placed none fails the install (R6): the install returns 1 and the run
// ends with `SetupExit(1)` (the shell's `|| exit 1`). The migration of components left at the
// superseded placement goes through antigravity-migrate.ts with the kind `all`.

import fs from "node:fs";
import path from "node:path";

import { migrateAntigravitySupersededComponents } from "../antigravity-migrate.ts";
import { SetupExit } from "./exit.ts";
import type { PromptSession } from "./prompt.ts";
import { ensureTierBuilt, isDirectory, stagingGate, stagingRoot } from "./tier-build.ts";
import type { TierBuildDeps } from "./tier-build.ts";
import { globNames, runOverlayTiers } from "./tier-install.ts";
import type { TierCtx } from "./tier-install.ts";

/** `~/.gemini/config/skills` and `~/.gemini/config/agents`, absolute. */
export function antigravityHomes(home: string): { skills: string; agents: string } {
  const config = path.join(home, ".gemini", "config");
  return { skills: path.join(config, "skills"), agents: path.join(config, "agents") };
}

interface KindTally {
  staged: number;
  placed: number;
}

/** Copy every `<name>/` of `source` into `destHome`, counting what was staged and what arrived. */
function placeKind(
  ctx: TierCtx,
  tier: string,
  kind: "skill" | "agent",
  source: string,
  destHome: string,
  missing: string[],
): KindTally {
  const tally: KindTally = { staged: 0, placed: 0 };
  if (!isDirectory(source)) return tally;
  fs.mkdirSync(destHome, { recursive: true });
  const marker = kind === "skill" ? "SKILL.md" : "AGENT.md";
  for (const item of globNames(source)) {
    if (!isDirectory(path.join(source, item))) continue;
    tally.staged += 1;
    const dest = path.join(destHome, item);
    fs.rmSync(dest, { recursive: true, force: true });
    try {
      fs.cpSync(path.join(source, item), dest, { recursive: true, verbatimSymlinks: true });
    } catch {
      // the presence check below is the single source of truth for "placed"
    }
    if (fs.existsSync(path.join(dest, marker))) {
      tally.placed += 1;
      ctx.io.out(`  Installed ${kind}: ${tier}/${item} -> ${dest}`);
    } else {
      missing.push(`${kind} ${tier}/${item}`);
    }
  }
  return tally;
}

/**
 * `install_antigravity_tier_to_home <repo> <tier> <skills_home> <agents_home>`: returns 0, or 1
 * when a kind staged components and placed none. An unbuilt tier prints the shell's line and
 * returns 0.
 */
export function installAntigravityTier(ctx: TierCtx, tier: string): number {
  const staging = stagingRoot(ctx.repoDir, "antigravity", tier);
  if (!isDirectory(staging)) {
    ctx.io.out(
      `  Tier '${tier}' not built (no ${staging}) — run 'bash scripts/build-components.sh' first.`,
    );
    return 0;
  }
  const homes = antigravityHomes(ctx.home);
  const missing: string[] = [];
  const skills = placeKind(ctx, tier, "skill", path.join(staging, "skills"), homes.skills, missing);
  const agents = placeKind(ctx, tier, "agent", path.join(staging, "agents"), homes.agents, missing);

  if (skills.staged !== skills.placed || agents.staged !== agents.placed) {
    ctx.io.err(
      `  WARNING: tier '${tier}' staged ${skills.staged} skill(s) and ${agents.staged} agent(s)`,
    );
    ctx.io.err(
      `           but placed ${skills.placed} and ${agents.placed} at the install target.`,
    );
    for (const item of missing) {
      ctx.io.err(`           absent from the install target: ${item}`);
    }
  }
  let failed = 0;
  if (skills.staged > 0 && skills.placed === 0) {
    ctx.io.err(
      `  ERROR: tier '${tier}' staged ${skills.staged} skill(s) and placed none at ${homes.skills}.`,
    );
    failed = 1;
  }
  if (agents.staged > 0 && agents.placed === 0) {
    ctx.io.err(
      `  ERROR: tier '${tier}' staged ${agents.staged} agent(s) and placed none at ${homes.agents}.`,
    );
    failed = 1;
  }
  return failed;
}

export interface AntigravityTierOptions {
  readonly ctx: TierCtx;
  readonly session: PromptSession;
  readonly deps?: TierBuildDeps;
}

function installOrExit(ctx: TierCtx, tier: string): void {
  if (installAntigravityTier(ctx, tier) !== 0) throw new SetupExit(1);
}

/**
 * The artifact-install block of the Antigravity script: the blank line and the `Installing
 * library ...` announcement, the library build when absent, its install, a blank line, then the
 * overlay tiers. A failed build or install throws `SetupExit(1)`.
 */
export async function runAntigravityTiers(options: AntigravityTierOptions): Promise<void> {
  const { ctx, session } = options;
  ctx.io.out("");
  ctx.io.out(
    `Installing library components to ${antigravityHomes(ctx.home).skills} (automatic)...`,
  );
  await ensureTierBuilt(
    ctx,
    "antigravity",
    stagingGate(ctx.repoDir, "antigravity", "library"),
    options.deps,
  );
  installOrExit(ctx, "library");
  ctx.io.out("");
  await runOverlayTiers({
    ctx,
    session,
    cli: "antigravity",
    install: (tier) => installOrExit(ctx, tier),
  });
}

/**
 * `migrate_antigravity_superseded_components "$AGY_HOME" "$REPO_DIR/artifacts" all`, with its
 * announcement and trailing blank line. Runs on every setup run, whichever tiers were installed
 * (spec 0123 R8); a non-zero status (an empty served-name set) throws `SetupExit(1)`.
 */
export function migrateSupersededPlacement(ctx: TierCtx): void {
  ctx.io.out("Migrating components left at the superseded placement...");
  const superseded = path.join(ctx.home, ".gemini", "antigravity-cli");
  const result = migrateAntigravitySupersededComponents(
    superseded,
    path.join(ctx.repoDir, "artifacts"),
    "all",
    [],
    ctx.io,
  );
  if (result.status !== 0) throw new SetupExit(1);
  ctx.io.out("");
}
