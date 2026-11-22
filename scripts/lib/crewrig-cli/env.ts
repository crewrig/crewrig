// env.ts — the environment that `build`, `setup` and `update` read (spec 0315 R12, delta-01). It is the first
// import of scripts/crewrig-cli.ts and runs for its side effect only: the variables of the strip classes are
// removed from `process.env` before any sibling module is evaluated, so every child process the commands start
// inherits the cleaned environment (the run that `update` starts included).
//
// Classes stripped (a name is compared in upper case, as Windows does):
//   (a) every CREWRIG_* except CREWRIG_RELEASE_BASE_URL, which only the launcher reads;
//   (b) every MEMPALACE_* except the six documented settings of the allowlist below;
//   (c) MCP_DAEMON_REPLACE_DEADLINE.
// Nothing else is removed: HOME, PATH, TMPDIR, NODE_EXTRA_CA_CERTS and SSL_CERT_FILE keep their meaning.
// This file must keep no top-level read of `process.env`; the closure test checks it.

/** The only MEMPALACE_* settings the commands pass through (delta-01 R12, the closed allowlist). */
export const MEMPALACE_ALLOWLIST: ReadonlySet<string> = new Set([
  "MEMPALACE_MCP_HOST",
  "MEMPALACE_MCP_PORT",
  "MEMPALACE_CHROMA_HOST",
  "MEMPALACE_CHROMA_PORT",
  "MEMPALACE_PALACE_PATH",
  "MEMPALACE_PYTHON",
]);

/** The CREWRIG_* variable the launcher reads and the commands leave in place. */
const LAUNCHER_VARIABLE = "CREWRIG_RELEASE_BASE_URL";

/** Whether a variable name belongs to a stripped class of delta-01 R12. */
export function isStrippedVariable(name: string): boolean {
  const upper = name.toUpperCase();
  if (upper.startsWith("CREWRIG_")) return upper !== LAUNCHER_VARIABLE;
  if (upper.startsWith("MEMPALACE_")) return !MEMPALACE_ALLOWLIST.has(upper);
  return upper === "MCP_DAEMON_REPLACE_DEADLINE";
}

/** Remove every stripped variable from `env` (`process.env` by default); returns the removed names. */
export function stripEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const name of Object.keys(env)) {
    if (!isStrippedVariable(name)) continue;
    delete env[name];
    removed.push(name);
  }
  return removed;
}

stripEnvironment();
