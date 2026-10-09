// main.ts — order of operations, banner, collision refusal and verdict of the build
// (spec 0250 R8, R9, R25).
//
// Twins scripts/build-components.sh :1081-1139 and the order the shell reached them in:
//   1. arguments                                   (:52-62)   a bad one is status 1
//   2. `--list-output-dirs`                        (:114-117) before anything is read
//   3. the YAML library                            (:120, was `yq`) status 1 when missing
//   4. `--resolve`                                 (:161-185) before the configuration
//   5. configuration and `canonical_repo`          (:233-244) status 1 when malformed
//   6. the banner                                  (:1081-1090)
//   7. the `--check` staging root                  (:1095-1097)
//   8. the installed-name collision pre-pass       (:1106-1111) before any file is written,
//      over every tier and all four CLIs whatever `--tier` and `--target` say, both modes
//   9. the tier loop                               (:1115-1125)
//  10. the verdict                                 (:1127-1139)
// The temporary roots (the staging root and the merge root the model library derived) are
// removed on every path out, failures included (staging.ts).
//
// Differences from the shell, both listed in spec 0250 R33: `--check` does not run
// `tests/test-assembly-verification.sh` (R25, (c)), so the verdict is the last act; the
// drift hint names the TypeScript invocation ((a)).
//
// `main` returns the exit status and never exits the process; the entry sets
// `process.exitCode` so every stream drains first.

import { createResolveContext } from "../model-resolve.ts";
import type { ResolveContext } from "../model-resolve.ts";
import { reportInstalledNameCollisions } from "../component-resolve.ts";
import { extractFrontmatter } from "../render-command.ts";
import { loadDependency, MissingDependencyError } from "../require-dependency.ts";
import { joinRoot, parseArgs, resolveRepoDir } from "./args.ts";
import { loadConfig, validateCanonicalRepo } from "./config.ts";
import { buildAgents } from "./emit-agents.ts";
import { buildCommands } from "./emit-commands.ts";
import { buildSkills } from "./emit-skills.ts";
import { createFrontmatter } from "./frontmatter.ts";
import { outputDirLines } from "./output-dirs.ts";
import { runResolveArm } from "./resolve-arm.ts";
import { createStagingRoot, installCleanup } from "./staging.ts";
import { discoverTiers, outputRootForTier } from "./tiers.ts";
import { escapeControl } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { BaseCtx, Ctx, MainInput } from "./types.ts";
import { readUmask } from "./resources.ts";

const RULE = "=========================================";

/** Let a pending signal run its handler (staging.ts) between two tiers. */
function turnEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function banner(ctx: Ctx): void {
  const { io, opts } = ctx;
  io.out(RULE);
  io.out("  Community Component Builder");
  io.out(`  Target: ${opts.target}`);
  io.out(opts.check ? "  Mode: CHECK (drift detection)" : "  Mode: BUILD (generate files)");
  io.out(RULE);
  io.out("");
}

/** The R13 pre-pass: false (after the refusal text) when two components claim one name. */
function namesAreFree(ctx: Ctx): boolean {
  const clean = reportInstalledNameCollisions(ctx.artifactsDir, (text) => ctx.io.errRaw(text));
  if (clean === 0) return true;
  ctx.io.err("FAILED: two components would be installed under one name into one landing zone.");
  ctx.io.err("        Rename one of them, or move one to a tier with a different landing zone.");
  ctx.io.err("        See artifacts/FORMAT.md -> Validation Rules.");
  return false;
}

/** The tier loop: `core` is drift-compared in `--check`, every other tier is built and discarded. */
async function buildTiers(ctx: Ctx, model: ResolveContext): Promise<void> {
  for (const tier of discoverTiers(ctx)) {
    ctx.state.compare = tier === "core";
    const tierDir = joinRoot(ctx.platform, ctx.artifactsDir, tier);
    const outRoot = outputRootForTier(ctx, tier);
    ctx.io.out(`--- Tier: ${escapeControl(tier)} (output root: ${escapeControl(outRoot)}) ---`);
    buildSkills(ctx, tier, tierDir, outRoot);
    buildCommands(ctx, tierDir, outRoot);
    buildAgents(ctx, model, tierDir, outRoot);
    await turnEventLoop();
  }
}

/** The verdict: `Done.`, or in `--check` the drift verdict and its status. */
function verdict(ctx: Ctx): number {
  ctx.io.out("");
  if (!ctx.opts.check) {
    ctx.io.out("Done.");
    return 0;
  }
  if (ctx.state.driftFound) {
    ctx.io.out("FAILED: Drift detected. Run 'node scripts/build-components.ts' to regenerate.");
    return 1;
  }
  ctx.io.out("OK: All generated files match source.");
  return 0;
}

/** Run the build with `input.argv` (script arguments only) and return its exit status. */
export async function main(input: MainInput): Promise<number> {
  const { io, env, platform } = input;
  const parsed = parseArgs(input.argv);
  if (!parsed.ok) {
    io.err(parsed.message);
    return 1;
  }
  const { opts } = parsed;
  if (opts.listOutputDirs) {
    for (const line of outputDirLines(opts)) io.out(escapeControl(line));
    return 0;
  }

  let yamlNamespace: unknown;
  try {
    yamlNamespace = await loadDependency("js-yaml");
  } catch (error) {
    if (!(error instanceof MissingDependencyError)) throw error;
    io.err(error.message);
    return 1;
  }
  const fm = createFrontmatter(yamlNamespace);
  const repoDir = resolveRepoDir(env, input.entryFile);
  const base: BaseCtx = {
    opts,
    repoDir,
    artifactsDir: joinRoot(platform, repoDir, "artifacts"),
    env,
    platform,
    io,
    umask: readUmask(platform),
    fm,
    state: { driftFound: false, compare: true, stagingRoot: "" },
  };
  const model = createResolveContext({
    repoDir,
    yaml: fm.yaml,
    extractFrontmatter,
    env,
    platform,
    stderr: (line) => io.err(line),
  });

  const cleanup = installCleanup(base.state, model);
  try {
    if (opts.resolve !== null) return runResolveArm(base, model);

    const config = loadConfig(repoDir, platform, io);
    validateCanonicalRepo(config);
    const ctx: Ctx = { ...base, config };
    banner(ctx);
    if (opts.check) base.state.stagingRoot = createStagingRoot(env);
    if (!namesAreFree(ctx)) return 1;
    await buildTiers(ctx, model);
    return verdict(ctx);
  } catch (error) {
    if (!(error instanceof BuildFailure)) throw error;
    io.err(error.message);
    return error.exitCode;
  } finally {
    cleanup.dispose();
  }
}
