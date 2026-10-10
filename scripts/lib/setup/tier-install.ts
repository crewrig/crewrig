// tier-install.ts — `install_tier_to_home` (Claude, Gemini), `install_tier_skills_to_home`
// (Copilot) and the overlay-tier loop of the four setup-*-interactive.sh scripts (spec 0256
// requirement 24, plan v2 step B2b.5). Twin of those functions: messages are the shell's, byte
// for byte. Skills are replaced (`rm -rf` then copy) under `<cli home>/skills/<name>/`; Claude
// agents land as `agents/<name>.md` (a directory of that name is removed first), Gemini agents as
// flat `agents/<file>.md`; Copilot installs `SKILL.md` only (its agents are skipped on purpose,
// `~/.copilot/agents` naming being unverified). The `library` tier installs automatically, the
// `community` and `org` tiers behind `overlay.community` / `overlay.org` and only when their built
// tier directory exists. Antigravity reuses `runOverlayTiers` with its own installer.

import fs from "node:fs";
import path from "node:path";

import type { Cli } from "./context.ts";
import { installFile } from "./files.ts";
import type { FilesCtx } from "./files.ts";
import type { PromptSession } from "./prompt.ts";
import { ensureTierBuilt, isDirectory, stagingGate, stagingRoot } from "./tier-build.ts";
import type { BuildCtx, TierBuildDeps } from "./tier-build.ts";

/** What the tier install reads from the run. */
export type TierCtx = FilesCtx & BuildCtx & { readonly home: string };

/** The Claude, Gemini and Copilot installers; Antigravity has its own (antigravity-tier.ts). */
export type TierCli = Exclude<Cli, "antigravity">;

/** The overlay tiers, in the order they are offered. */
export const OVERLAY_TIERS: readonly string[] = ["community", "org"];

/** Names under `dir` the shell's `*` glob matches (no hidden names), in code-unit order. */
export function globNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** `rm -rf dest; cp -R src dest` for one skill directory. */
function replaceDirectory(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
}

/** `~/.claude`, `~/.gemini`: the displayed (literal tilde) home of a CLI whose skills live in it. */
const TILDE_HOME: Readonly<Record<"claude" | "gemini", string>> = {
  claude: "~/.claude",
  gemini: "~/.gemini",
};

function installSkillsAndAgents(ctx: TierCtx, cli: "claude" | "gemini", tier: string): void {
  const staging = stagingRoot(ctx.repoDir, cli, tier);
  const homeDir = path.join(ctx.home, cli === "claude" ? ".claude" : ".gemini");
  const tilde = TILDE_HOME[cli];
  if (!isDirectory(staging)) {
    ctx.io.out(
      `  Tier '${tier}' not built (no ${staging}) — run 'bash scripts/build-components.sh' first.`,
    );
    return;
  }
  const skillsStaging = path.join(staging, "skills");
  if (isDirectory(skillsStaging)) {
    const skillsHome = path.join(homeDir, "skills");
    fs.mkdirSync(skillsHome, { recursive: true });
    for (const name of globNames(skillsStaging)) {
      if (!isDirectory(path.join(skillsStaging, name))) continue;
      replaceDirectory(path.join(skillsStaging, name), path.join(skillsHome, name));
      ctx.io.out(`  Installed skill: ${tier}/${name} -> ${tilde}/skills/${name}`);
    }
  }
  const agentsStaging = path.join(staging, "agents");
  if (isDirectory(agentsStaging)) {
    const agentsHome = path.join(homeDir, "agents");
    fs.mkdirSync(agentsHome, { recursive: true });
    for (const file of globNames(agentsStaging)) {
      if (!file.endsWith(".md") || !isFile(path.join(agentsStaging, file))) continue;
      const dest = path.join(agentsHome, file);
      if (cli === "claude" && isDirectory(path.join(agentsHome, file.slice(0, -3)))) {
        fs.rmSync(path.join(agentsHome, file.slice(0, -3)), { recursive: true, force: true });
      }
      fs.copyFileSync(path.join(agentsStaging, file), dest);
      const shown = cli === "claude" ? file.slice(0, -3) : file;
      ctx.io.out(`  Installed agent: ${tier}/${shown} -> ${tilde}/agents/${file}`);
    }
  }
}

function installCopilotSkills(ctx: TierCtx, tier: string): void {
  const staging = stagingGate(ctx.repoDir, "copilot", tier);
  if (!isDirectory(staging) || fs.readdirSync(staging).length === 0) {
    ctx.io.out(
      `  Tier '${tier}' has no built skills (no ${staging}) — run 'bash scripts/build-components.sh --target copilot' first.`,
    );
    return;
  }
  const skillsHome = path.join(ctx.home, ".copilot", "skills");
  fs.mkdirSync(skillsHome, { recursive: true });
  for (const name of globNames(staging)) {
    if (!isDirectory(path.join(staging, name))) continue;
    const target = path.join(skillsHome, name);
    fs.mkdirSync(target, { recursive: true });
    const source = path.join(staging, name, "SKILL.md");
    if (!isFile(source)) continue;
    installFile(
      ctx,
      source,
      path.join(target, "SKILL.md"),
      `${tier}/${name}/SKILL.md -> ~/.copilot/skills/${name}/SKILL.md`,
    );
  }
}

export interface InstallTierOptions {
  readonly ctx: TierCtx;
  readonly cli: TierCli;
  readonly tier: string;
}

/** `install_tier_to_home <tier>` (Claude, Gemini) / `install_tier_skills_to_home <tier>` (Copilot). */
export function installTierToHome(options: InstallTierOptions): void {
  const { ctx, cli, tier } = options;
  if (cli === "copilot") installCopilotSkills(ctx, tier);
  else installSkillsAndAgents(ctx, cli, tier);
}

/** The question header of an overlay tier, verbatim from each script. */
export function overlayHeader(ctx: Pick<TierCtx, "home">, cli: Cli, tier: string): string {
  switch (cli) {
    case "claude":
      return `Install '${tier}' components to ~/.claude/skills? (opt-in)`;
    case "gemini":
      return `Install '${tier}' components to ~/.gemini/skills? (opt-in)`;
    case "copilot":
      return `Install '${tier}' skills to ${path.join(ctx.home, ".copilot", "skills")}? (opt-in)`;
    case "antigravity":
      return `Install '${tier}' components to ~/.gemini/config/skills? (opt-in)`;
  }
}

/** The line printed when an overlay tier is declined. */
export function overlaySkipped(cli: Cli, tier: string): string {
  return cli === "copilot" ? `  '${tier}' skills install skipped.` : `  '${tier}' install skipped.`;
}

export interface OverlayOptions {
  readonly ctx: TierCtx;
  readonly session: PromptSession;
  readonly cli: Cli;
  /** The per-tier installer; required for Antigravity, defaults to `installTierToHome` otherwise. */
  readonly install?: (tier: string) => void;
}

/**
 * The overlay loop: for `community` then `org`, only when the built tier directory exists, ask
 * `overlay.<tier>` (`no`, `yes`; a cancel aborts) and install on `yes`, else print the skip line;
 * a blank line follows each asked tier.
 */
export async function runOverlayTiers(options: OverlayOptions): Promise<void> {
  const { ctx, session, cli } = options;
  const install =
    options.install ??
    ((tier: string): void => {
      if (cli === "antigravity") throw new Error("runOverlayTiers: Antigravity needs an installer");
      installTierToHome({ ctx, cli, tier });
    });
  for (const tier of OVERLAY_TIERS) {
    if (!isDirectory(stagingGate(ctx.repoDir, cli, tier))) continue;
    const answer = await session.choose({
      id: `overlay.${tier}`,
      header: overlayHeader(ctx, cli, tier),
      options: ["no", "yes"],
      cancel: "abort",
    });
    if (answer === "yes") install(tier);
    else ctx.io.out(overlaySkipped(cli, tier));
    ctx.io.out("");
  }
}

export interface RunTierInstallOptions {
  readonly ctx: TierCtx;
  readonly session: PromptSession;
  readonly cli: TierCli;
  readonly deps?: TierBuildDeps;
}

/**
 * The whole artifact-install block of a Claude, Gemini or Copilot script: the blank line and the
 * `Installing library ...` announcement, the build of the library tier when absent, its install,
 * a blank line, then the overlay tiers. A failed build throws `SetupExit(1)`.
 */
export async function runTierInstall(options: RunTierInstallOptions): Promise<void> {
  const { ctx, session, cli } = options;
  if (cli === "copilot") {
    ctx.io.out(
      `Installing library skills to ${path.join(ctx.home, ".copilot", "skills")} (automatic)...`,
    );
  } else {
    ctx.io.out("");
    const skills = path.join(ctx.home, cli === "claude" ? ".claude" : ".gemini", "skills");
    ctx.io.out(`Installing library components to ${skills} (automatic)...`);
  }
  await ensureTierBuilt(ctx, cli, stagingGate(ctx.repoDir, cli, "library"), options.deps);
  installTierToHome({ ctx, cli, tier: "library" });
  ctx.io.out("");
  await runOverlayTiers({ ctx, session, cli });
}
