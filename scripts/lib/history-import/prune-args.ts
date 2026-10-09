// prune-args.ts — the argument parser of scripts/prune-transcripts.ts (spec 0253 R16-R18),
// reproducing the shell predecessor: left to right, `--help` answers at once, the `--days`
// validation runs after the whole line is read, and the last `--days` / `--project` wins.
// Deviation 5 (delta-01 R25): a flag with no value is an error, not an `unbound variable`.

export type PruneArgs =
  | {
      readonly kind: "run";
      readonly days: number;
      readonly apply: boolean;
      readonly project: string;
    }
  | { readonly kind: "help"; readonly lines: string[] }
  | { readonly kind: "error"; readonly lines: string[]; readonly stream: "stdout" | "stderr" };

export interface PruneArgsContext {
  /** The entry as the user types it, named in `Usage:` and in the hint (deviation 6). */
  readonly script: string;
  /** The pip requirement string, e.g. `mempalace>=3.6.0,<3.7`. */
  readonly installSpec: string;
}

export const DEFAULT_DAYS = 30;

function helpLines(ctx: PruneArgsContext): string[] {
  return [
    `Usage: ${ctx.script} [--days <days>] [--apply] [--project <name>]`,
    "",
    "Options:",
    "  --days     Retention period in days (default: 30)",
    "  --apply    Actually delete drawers (dry-run mode by default)",
    "  --project  Prune only a specific project's transcripts (default: all)",
    "",
    "Prerequisites:",
    "  MemPalace must be installed via pipx (recommended):",
    `    pipx install '${ctx.installSpec}'`,
    "",
    "  If you installed via pip to a custom venv, set MEMPALACE_PYTHON:",
    `    MEMPALACE_PYTHON=/path/to/venv/bin/python ${ctx.script} ...`,
  ];
}

function fail(...lines: string[]): PruneArgs {
  return { kind: "error", lines, stream: "stderr" };
}

/** Parse the command line (without the node and script entries). */
export function parsePruneArgs(argv: readonly string[], ctx: PruneArgsContext): PruneArgs {
  let daysRaw = "";
  let apply = false;
  let project = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--days" || arg === "--project") {
      const value = argv[i + 1];
      if (value === undefined) return fail(`Error: ${arg} requires a value`);
      if (arg === "--days") daysRaw = value;
      else project = value;
      i += 1;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--help" || arg === "-h") {
      return { kind: "help", lines: helpLines(ctx) };
    } else {
      return fail(`Unknown option: ${arg}`, `Run '${ctx.script} --help' for usage.`);
    }
  }
  // `${DAYS:-30}`: an empty value takes the default.
  const text = daysRaw === "" ? String(DEFAULT_DAYS) : daysRaw;
  if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    return fail("Error: --days must be a positive integer");
  }
  const days = Number(text);
  if (days < 1) return fail("Error: --days must be at least 1");
  return { kind: "run", days, apply, project };
}
