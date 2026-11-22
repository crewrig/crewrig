// env-classes.ts — spec 0315 delta-01 R12 as a test oracle, written from the spec and not from env.ts: the classes of
// variables the three commands strip, the closed allowlist they pass through, and the one launcher variable.
// The environment tests compare the implementation (scripts/lib/crewrig-cli/env.ts) with this file, so a strip that
// drifts from the spec, in either direction, fails.

/** The closed allowlist of delta-01 R12: exactly these six MEMPALACE_* settings reach the commands. */
export const ALLOWLIST: readonly string[] = [
  "MEMPALACE_MCP_HOST",
  "MEMPALACE_MCP_PORT",
  "MEMPALACE_CHROMA_HOST",
  "MEMPALACE_CHROMA_PORT",
  "MEMPALACE_PALACE_PATH",
  "MEMPALACE_PYTHON",
];

/** The one CREWRIG_* variable the commands keep (only the launcher reads it). */
export const LAUNCHER_VARIABLE = "CREWRIG_RELEASE_BASE_URL";

/** The names the spec's table and prose give as stripped, one of each kind at least. */
export const STRIPPED_NAMES: readonly string[] = [
  "CREWRIG_TLS_CA",
  "CREWRIG_USAGE_ROOT",
  "CREWRIG_TEST_SERVICE_PLATFORM",
  "CREWRIG_TEST_SERVICE_BIN_DIR",
  "CREWRIG_TEST_ANYTHING",
  "CREWRIG_UNLISTED_FUTURE_SETTING",
  "MEMPALACE_MCP_CHROMA_WAIT",
  "MEMPALACE_CHROMA_MAX_CONNECTIONS",
  "MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS",
  "MEMPALACE_CHROMA_ULIMIT_FLOOR",
  "MEMPALACE_MCP_HTTP_TOKEN",
  "MEMPALACE_MCP_TOKEN_FILE",
  "MEMPALACE_MCP_IDLE_HOURS",
  "MEMPALACE_LAUNCHER_KILL_AFTER_MS",
  "MEMPALACE_MCP_LAUNCHER_PATH",
  "MEMPALACE_TLS_EXEC_PATH",
  "MEMPALACE_MCP_LABEL",
  "MEMPALACE_MCP_UNIT",
  "MEMPALACE_MCP_EXPECTED_PID",
  "MEMPALACE_MCP_LISTENER_PID",
  "MEMPALACE_MCP_EVICT_CMD",
  "MEMPALACE_TRANSCRIPT_ENABLED",
  "MEMPALACE_TRANSCRIPT_TIMEOUT_MS",
  "MEMPALACE_DAEMON_TOKEN_FILE",
  "MEMPALACE_HISTORY_IMPORT",
  "MEMPALACE_EXTRACT",
  "MCP_DAEMON_REPLACE_DEADLINE",
];

/** Variables the commands must leave alone: they keep their meaning (delta-01 R12, last sentences). */
export const UNAFFECTED_NAMES: readonly string[] = [
  "HOME",
  "USERPROFILE",
  "PATH",
  "TMPDIR",
  "TEMP",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REPO_DIR",
  "MCP_SOMETHING_ELSE",
];

export type EnvClass = "stripped" | "allowed" | "launcher" | "uncovered" | "unrelated";

/**
 * What the spec says of a name that code in the closure mentions: stripped by class (a), (b) or (c); passed through
 * (the six, or the launcher variable); `uncovered` when it sits in the neighbourhood of the classes (`MCP_DAEMON_*`
 * other than the one the spec names) and no class covers it.
 */
export function classifyEnvName(name: string): EnvClass {
  const upper = name.toUpperCase();
  if (upper === LAUNCHER_VARIABLE) return "launcher";
  if (upper.startsWith("CREWRIG_")) return "stripped";
  if (upper.startsWith("MEMPALACE_")) return ALLOWLIST.includes(upper) ? "allowed" : "stripped";
  if (upper === "MCP_DAEMON_REPLACE_DEADLINE") return "stripped";
  if (upper.startsWith("MCP_DAEMON_")) return "uncovered";
  return "unrelated";
}
