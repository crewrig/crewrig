// mempalace-detect.ts — find the MemPalace interpreter and read its installed version (spec 0256
// requirement 25, as replaced by delta-01). TypeScript twins of `detect_mempalace_python` and
// `mempalace_installed_version` in scripts/lib/common.sh. The candidate walk is the existing
// detector of scripts/lib/mempalace-python.ts (the pipx venv, the console script's interpreter,
// `python3`, or the Windows `python` and `py -3` launchers); this module only puts it behind the
// setup's context and its `Spawner` seam.

import { detectMempalacePython, splitLauncher } from "../mempalace-python.ts";
import type { Env, Spawner } from "./context.ts";

/** What the detection reads from the setup context. */
export interface DetectCtx {
  readonly env: Env;
}

/** The machine seam; the default is the real detector, which probes each candidate with a process. */
export interface DetectDeps {
  readonly detect?: (env: NodeJS.ProcessEnv) => string | undefined;
}

/** The program run to print the installed version; the shell's `$1 -c "..."` body. */
export const VERSION_PROGRAM =
  "from importlib.metadata import version; print(version('mempalace'))";

/**
 * The interpreter that imports `mempalace.mcp_server`, as the detector lists it (so the Windows
 * launcher stays `py -3`: pass it to `installedVersion`, which splits it), or `undefined` when
 * none does (the shell's non-zero return).
 */
export function detectMempalaceInterpreter(
  ctx: DetectCtx,
  deps: DetectDeps = {},
): string | undefined {
  const detect = deps.detect ?? detectMempalacePython;
  const found = detect({ ...ctx.env });
  return typeof found === "string" && found !== "" ? found : undefined;
}

/**
 * The installed MemPalace version as `<python> -c "..."` prints it, trailing line breaks removed as
 * a shell command substitution removes them; `undefined` when the run fails or prints nothing.
 * Standard error is captured by the spawner and dropped, as the shell's `2>/dev/null` does.
 */
export function installedVersion(spawn: Spawner, python: string): string | undefined {
  const result = spawn([...splitLauncher(python), "-c", VERSION_PROGRAM]);
  if (result.status !== 0) return undefined;
  const version = result.stdout.replace(/[\r\n]+$/, "");
  return version === "" ? undefined : version;
}
