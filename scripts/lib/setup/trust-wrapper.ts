// trust-wrapper.ts — the argv prefix that a stdio MCP entry puts in front of the command it wraps
// (spec 0256 requirements 25 and 28, delta-01 deviation (m)). The shell registers
// `bash <repo>/scripts/lib/tls-exec.sh <command...>` unconditionally (the wrapper does nothing when
// no TLS file exists); on Windows there is no `bash`, so the entry names the TypeScript trust
// wrapper that the service installer already ships to `<home>/.crewrig/tls-exec.ts`
// (`installTrustWrapperProgram`, scripts/lib/service/program-install.ts). The setup installs that
// program before it writes the first entry; this module only names the command line.

import path from "node:path";

export interface WrapperEnv {
  readonly platform: NodeJS.Platform;
  /** `HOME` (`USERPROFILE` on Windows). */
  readonly home: string;
  /** The repository checkout the setup runs from. */
  readonly repoDir: string;
}

/** The program that runs the wrapper: `bash` on POSIX, `node` on win32. */
export function wrapperProgram(platform: NodeJS.Platform): "bash" | "node" {
  return platform === "win32" ? "node" : "bash";
}

/** The wrapper script path: in the repository on POSIX, in the profile on win32. */
export function wrapperScriptPath(env: WrapperEnv): string {
  return env.platform === "win32"
    ? path.win32.join(env.home, ".crewrig", "tls-exec.ts")
    : path.posix.join(env.repoDir, "scripts", "lib", "tls-exec.sh");
}

/** `[program, script]`: the words that precede the wrapped command in a stdio entry. */
export function trustWrapperPrefix(env: WrapperEnv): readonly string[] {
  return [wrapperProgram(env.platform), wrapperScriptPath(env)];
}

/** The whole stdio command: the prefix followed by the wrapped command words. */
export function wrapStdioCommand(env: WrapperEnv, command: readonly string[]): readonly string[] {
  return [...trustWrapperPrefix(env), ...command];
}
