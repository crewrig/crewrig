// detect.ts — the one place the importers meet ticket #1330's interpreter probe
// (`scripts/lib/mempalace-python.ts`, spec 0252): the TypeScript counterpart of
// `detect_mempalace_python`. The importers never read `MEMPALACE_PYTHON` (spec 0253 R14); the
// probe walks the pipx virtual environment, the interpreter of the `mempalace` console script and
// `python3` (on Windows the `python` and `py -3` launchers).

import { detectMempalacePython } from "../mempalace-python.ts";

/** The interpreter on which `mempalace.mcp_server` imports, or undefined. */
export function detectInterpreter(env: NodeJS.ProcessEnv): string | undefined {
  return detectMempalacePython(env);
}
