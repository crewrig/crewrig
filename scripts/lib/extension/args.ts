// args.ts — argument parsing of the extension entries (spec 0254 R5).
// Twins `build-extension.sh:60-106` (`--check`, `--target`), the `${1:?Usage: ...}` lines of the
// three plugin builders (build-claude-plugin.sh:32, build-copilot-plugin.sh:38,
// build-antigravity-extension.sh:35) and migrate-extension.sh:50. Pure: no output, no exit.

export type BuildArgs =
  | {
      readonly ok: true;
      readonly check: boolean;
      readonly target: string;
      readonly extArgs: string[];
    }
  | { readonly ok: false; readonly status: number; readonly message: string };

export type PluginArgs =
  | { readonly ok: true; readonly extArg: string; readonly outArg: string | undefined }
  | { readonly ok: false; readonly status: number; readonly message: string };

export type MigrateArgs =
  | { readonly ok: true; readonly extArg: string }
  | { readonly ok: false; readonly status: number; readonly message: string };

const TARGET_VALUES: readonly string[] = ["gemini", "claude", "copilot", "antigravity", "all"];

/** `build-extension [--check] [--target <v>] [<extension>...]`; every other word is an extension argument. */
export function parseBuildArgs(argv: readonly string[]): BuildArgs {
  let check = false;
  let target = "all";
  const extArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (word === "--check") {
      check = true;
    } else if (word === "--target") {
      // `${2:?...}`: a missing value and an empty one are both refused.
      const value = argv[i + 1];
      if (value === undefined || value === "") {
        return { ok: false, status: 1, message: "Error: --target requires a value" };
      }
      target = value;
      i += 1;
    } else {
      extArgs.push(word);
    }
  }
  if (!TARGET_VALUES.includes(target)) {
    return {
      ok: false,
      status: 2,
      message: `Error: --target must be one of gemini, claude, copilot, antigravity, all (got '${target}').`,
    };
  }
  return { ok: true, check, target, extArgs };
}

/** `<script> <extension-dir-or-name> [output-dir]`; further words are ignored. */
export function parsePluginArgs(argv: readonly string[], script: string): PluginArgs {
  const extArg = argv[0];
  if (extArg === undefined || extArg === "") {
    return {
      ok: false,
      status: 1,
      message: `Usage: ${script} <extension-dir-or-name> [output-dir]`,
    };
  }
  // `${2:-default}`: an absent or empty second word selects the default directory.
  const out = argv[1];
  return { ok: true, extArg, outArg: out === undefined || out === "" ? undefined : out };
}

/** `migrate-extension.sh <extension-dir-or-name>`; further words are ignored. */
export function parseMigrateArgs(argv: readonly string[]): MigrateArgs {
  const extArg = argv[0];
  if (extArg === undefined || extArg === "") {
    return {
      ok: false,
      status: 1,
      message: "Usage: migrate-extension.sh <extension-dir-or-name>",
    };
  }
  return { ok: true, extArg };
}
