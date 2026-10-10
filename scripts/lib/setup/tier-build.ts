// tier-build.ts — `ensure_tier_built` of scripts/lib/common.sh (spec 0256 requirement 24, plan v2
// step B2b.5): build a tier's staging tree on the fly when it is absent. Twin of that function:
// the shell ran `bash scripts/build-components.sh --target <cli>`; here the build is the in-process
// `main` of scripts/lib/build-components/main.ts, never a shell (parent requirement 23). The
// announcement line keeps the shell's text byte for byte, command included, because the
// differential test compares the printed bytes. Layer 2: runs after the dependency step (the
// build reads YAML through `js-yaml`).

import fs from "node:fs";
import path from "node:path";

import type { MainInput } from "../build-components/types.ts";
import type { Cli, SetupCtx } from "./context.ts";
import { SetupExit } from "./exit.ts";

/** What the build reads from the run: the output channels, the environment and the repository. */
export type BuildCtx = Pick<SetupCtx, "io" | "env" | "platform" | "repoDir">;

/** The in-process build; tests inject a fake, the default is `main` of `build-components/main.ts`. */
export type BuildFn = (input: MainInput) => Promise<number>;

export interface TierBuildDeps {
  readonly build?: BuildFn;
}

const defaultBuild: BuildFn = async (input) => {
  const { main } = await import("../build-components/main.ts");
  return main(input);
};

/** The directory under `dist/<tier>/` each CLI's compiled output lives in. */
const CLI_ROOT: Readonly<Record<Cli, string>> = {
  claude: ".claude",
  gemini: ".gemini",
  copilot: ".github",
  antigravity: ".agents",
};

/** `dist/<tier>/<cli root>`, the staging tree of one tier for one CLI. */
export function stagingRoot(repoDir: string, cli: Cli, tier: string): string {
  return path.join(repoDir, "dist", tier, CLI_ROOT[cli]);
}

/**
 * The directory whose existence means "the tier is built" for `cli`: the staging root, except for
 * Copilot, which only ever installs `.github/skills` and so gates on that directory.
 */
export function stagingGate(repoDir: string, cli: Cli, tier: string): string {
  const root = stagingRoot(repoDir, cli, tier);
  return cli === "copilot" ? path.join(root, "skills") : root;
}

export function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `ensure_tier_built <repo> <cli> <staging>`: nothing when `stagingDir` is a directory; otherwise
 * announce, then build every tier for `cli` in process. A build that fails (or throws) prints
 * `ERROR: automatic build failed for target '<cli>'.` on standard error and throws `SetupExit(1)`
 * (the shell's `|| exit 1`). Like the shell, a build that succeeds is trusted: a staging tree that
 * is still absent afterwards is reported by the install step as "not built".
 */
export async function ensureTierBuilt(
  ctx: BuildCtx,
  cli: Cli,
  stagingDir: string,
  deps: TierBuildDeps = {},
): Promise<void> {
  if (isDirectory(stagingDir)) return;
  ctx.io.out(
    `Tier not built (no ${stagingDir}) — building automatically via 'bash scripts/build-components.sh --target ${cli}'...`,
  );
  const build = deps.build ?? defaultBuild;
  let status: number;
  try {
    status = await build({
      argv: ["--target", cli],
      env: { ...ctx.env, REPO_DIR: ctx.repoDir },
      platform: ctx.platform,
      entryFile: path.join(ctx.repoDir, "scripts", "build-components.ts"),
      io: ctx.io,
    });
  } catch (error: unknown) {
    ctx.io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    status = 1;
  }
  if (status !== 0) {
    ctx.io.err(`ERROR: automatic build failed for target '${cli}'.`);
    throw new SetupExit(1);
  }
}
