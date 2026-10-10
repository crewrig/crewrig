// all.ts — the cross-CLI umbrella extension installer (spec 0255 R11, ported from
// scripts/install-extension-all.sh, spec 0177).
//
// `installAll` is written against narrow injected pieces: an `InstallTarget` list (one row per CLI,
// in report order) and the context the entry builds. `childTargets` is the default wiring: each
// target runs `node scripts/<script>.ts <name>` as a child process with its output discarded (the
// shell's `>/dev/null 2>&1`), so a child sees the very environment, PATH included, the umbrella saw.
// Presence checks go through `findOnPath`; `jq` is no longer a prerequisite (spec 0255 R22(a)).

import { spawn } from "node:child_process";
import type { StdioOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { Env, Io } from "../extension/types.ts";
import { findOnPath } from "../mempalace-python.ts";

/** One CLI the umbrella can install into, as the report shows it. */
export interface InstallTarget {
  /** The name on the `[INSTALLED]`, `[SKIPPED]` and `[FAILED]` lines. */
  readonly label: string;
  /** The text after `[INSTALLED] ` (the label, plus a path for Gemini CLI). */
  installed(name: string): string;
  /** The script named on the `[FAILED]` line, with the shell's `.sh` suffix. */
  readonly script: string;
  /** `true` when the CLI is present, otherwise the reason it is skipped. */
  available(env: Env): true | string;
  /** Install the extension; the exit status (0 is success). */
  install(name: string): Promise<number>;
}

export interface AllCtx {
  readonly io: Io;
  readonly repoDir: string;
  readonly env: Env;
}

const TIERS = ["core", "library", "org"];

const isDirectory = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `$GEMINI_HOME`, or `<home>/.gemini` when it is unset or empty. */
export function geminiHomeOf(env: Env, home: string): string {
  const set = env["GEMINI_HOME"];
  return typeof set === "string" && set !== "" ? set : `${home}/.gemini`;
}

/** Run `node <script> <args>` in the current directory; resolves with the status (1 if it did not run). */
export function runNodeScript(
  script: string,
  args: readonly string[],
  env: Env,
  stdio: StdioOptions,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio, windowsHide: true });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** The four targets in report order, each installing through `node scripts/<script>.ts`. */
export function childTargets(ctx: AllCtx, geminiHome: string): InstallTarget[] {
  const run = (script: string, args: string[]): Promise<number> =>
    runNodeScript(path.join(ctx.repoDir, "scripts", `${script}.ts`), args, ctx.env, "ignore");
  const binary = (name: string): ((env: Env) => true | string) => {
    return (env) =>
      findOnPath(name, env, undefined) !== undefined || `'${name}' CLI binary not found in PATH`;
  };
  return [
    {
      label: "Gemini CLI",
      installed: (name) => `Gemini CLI (${geminiHome}/extensions/${name})`,
      script: "install-extension.sh",
      available: (env) =>
        isDirectory(geminiHome) ||
        findOnPath("gemini", env, undefined) !== undefined ||
        `neither '${geminiHome}' directory nor 'gemini' CLI binary found`,
      install: (name) => run("install-extension", ["install", name]),
    },
    {
      label: "Claude Code",
      installed: () => "Claude Code",
      script: "install-claude-plugin.sh",
      available: binary("claude"),
      install: (name) => run("install-claude-plugin", [name]),
    },
    {
      label: "GitHub Copilot CLI",
      installed: () => "GitHub Copilot CLI",
      script: "install-copilot-plugin.sh",
      available: binary("copilot"),
      install: (name) => run("install-copilot-plugin", [name]),
    },
    {
      label: "Antigravity CLI",
      installed: () => "Antigravity CLI",
      script: "install-antigravity-extension.sh",
      available: binary("agy"),
      install: (name) => run("install-antigravity-extension", [name]),
    },
  ];
}

/** The tier directory holding the extension, or the multi-tier / not-found error text. */
function resolveExtension(repoDir: string, name: string): { dir: string } | { error: string } {
  const found = TIERS.map((tier) => path.join(repoDir, "extensions", tier, name)).filter(
    isDirectory,
  );
  if (found.length > 1) {
    return { error: `extension '${name}' exists in multiple tiers; names must be unique.` };
  }
  const [dir] = found;
  if (dir === undefined) {
    return {
      error: `Extension '${name}' not found in extensions/ (searched core, library, org).`,
    };
  }
  return { dir };
}

const USAGE = [
  "Usage: install-extension-all.sh <extension-name>",
  "",
  "Installs an extension across all supported CLIs present on the host machine",
  "(Gemini CLI, Claude Code, GitHub Copilot CLI, Antigravity CLI).",
];

/** Run the umbrella; `targets` default to the child-process wiring. Returns the exit status. */
export async function installAll(
  argv: readonly string[],
  ctx: AllCtx,
  home: string,
  makeTargets: (ctx: AllCtx, geminiHome: string) => InstallTarget[] = childTargets,
): Promise<number> {
  const name = argv[0] ?? "";
  if (name === "" || name === "-h" || name === "--help") {
    USAGE.forEach((line) => ctx.io.out(line));
    return name === "" ? 1 : 0;
  }
  const resolved = resolveExtension(ctx.repoDir, name);
  if ("error" in resolved) {
    ctx.io.err(`Error: ${resolved.error}`);
    return 1;
  }
  ctx.io.out(`Installing extension '${name}' across available CLIs...`);
  const geminiHome = geminiHomeOf(ctx.env, home);
  let installed = 0;
  let skipped = 0;
  let failed = 0;
  for (const target of makeTargets(ctx, geminiHome)) {
    const availability = target.available(ctx.env);
    if (availability !== true) {
      ctx.io.out(`  [SKIPPED]   ${target.label} (${availability})`);
      skipped += 1;
    } else if ((await target.install(name)) === 0) {
      ctx.io.out(`  [INSTALLED] ${target.installed(name)}`);
      installed += 1;
    } else {
      ctx.io.err(`  [FAILED]    ${target.label} (${target.script} failed)`);
      failed += 1;
    }
  }
  ctx.io.out("");
  if (failed > 0) {
    ctx.io.err(
      `Error: Installation failed for ${failed} target(s) (${installed} installed, ${skipped} skipped, ${failed} failed).`,
    );
    return 1;
  }
  if (installed === 0) {
    ctx.io.err(
      `Error: No supported CLI targets were available; all ${skipped} target(s) were skipped.`,
    );
    return 1;
  }
  ctx.io.out(
    `Summary: Successfully installed '${name}' across ${installed} CLI target(s) (${skipped} skipped).`,
  );
  return 0;
}
