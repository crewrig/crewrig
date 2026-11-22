// steps-distribution.ts — the distribution-only skills of a two-root run (spec 0315 R8). `init-team` is the script
// that `init-soul` and `init-personal-profile` run, so setup installs the three for each CLI from the compiled
// outputs of the version root, where the checkout keeps them. A checkout run takes no such step (flow.ts).

import fs from "node:fs";
import path from "node:path";

import type { Cli } from "./context.ts";
import type { StepFn, StepRegistry } from "./descriptor.ts";
import { installDir, installFile } from "./files.ts";
import { SetupExit } from "./exit.ts";
import { antigravityHomes } from "./antigravity-tier.ts";
import { filesCtx } from "./steps-rules-pick.ts";

/** The skills of the distribution, and the commands that Gemini CLI receives as TOML files instead. */
const SKILLS = ["init-team", "init-soul", "init-personal-profile"] as const;
const GEMINI_COMMANDS = ["init-soul", "init-personal-profile"] as const;

export interface DistributionTarget {
  readonly kind: "dir" | "file";
  readonly src: string;
  readonly dest: string;
  readonly label: string;
}

/** Where each CLI's distribution skills come from in the version root, and where they are installed. */
export function distributionTargets(cli: Cli, repoDir: string, home: string): DistributionTarget[] {
  const targets: DistributionTarget[] = [];
  const skill = (rootDir: string, homeDir: string, names: readonly string[]): void => {
    for (const name of names) {
      targets.push({
        kind: "dir",
        src: path.join(repoDir, rootDir, "skills", name),
        dest: path.join(homeDir, name),
        label: `${name} skill`,
      });
    }
  };
  if (cli === "claude") skill(".claude", path.join(home, ".claude", "skills"), SKILLS);
  if (cli === "copilot") skill(".github", path.join(home, ".copilot", "skills"), SKILLS);
  if (cli === "antigravity") skill(".agents", antigravityHomes(home).skills, SKILLS);
  if (cli === "gemini") {
    skill(".gemini", path.join(home, ".gemini", "skills"), ["init-team"]);
    for (const name of GEMINI_COMMANDS) {
      targets.push({
        kind: "file",
        src: path.join(repoDir, ".gemini", "commands", `${name}.toml`),
        dest: path.join(home, ".gemini", "commands", `${name}.toml`),
        label: `${name} command`,
      });
    }
  }
  return targets;
}

const distributionSkills: StepFn = async (env) => {
  const { ctx } = env;
  if (ctx.org === undefined) return;
  ctx.io.out(
    "Installing the organization setup skills (init-team, init-soul, init-personal-profile)...",
  );
  for (const target of distributionTargets(ctx.cli, ctx.repoDir, ctx.home)) {
    if (!fs.existsSync(target.src)) {
      ctx.io.err(`Error: the pinned version lacks ${target.src}; install that version again.`);
      throw new SetupExit(1);
    }
    if (target.kind === "dir") installDir(filesCtx(env), target.src, target.dest, target.label);
    else installFile(filesCtx(env), target.src, target.dest, target.label);
  }
  ctx.io.out("");
};

export const distributionSteps: StepRegistry = { "distribution-skills": distributionSkills };
