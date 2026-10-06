// token.ts — the daemon bearer token of the MemPalace transcript hook (spec
// 0247 R14). The file is chosen by the first rule that applies, and the
// choice is final:
//   (a) `MEMPALACE_DAEMON_TOKEN_FILE`, when non-empty (spec 0167);
//   (b) `TOKEN_PATH_MOCK`, when non-empty;
//   (c) the palace-keyed path of `mcp_token_path`, through the one definition
//       scripts/lib/usage-store/mcp.js holds (`tokenPathNoCreate()`, decision
//       Q3) and, only under (c) and only when that file does not exist, the
//       first `<home>/.mempalace/server/*/token` in byte order of the
//       directory name (hooks/mempalace-transcript.sh:270-275).
// Resolving the token creates no file and no directory.
//
// Standard library only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tokenPathNoCreate } from "../usage-store/mcp.js";

export type TokenResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly reason: string };

/** The first `<server>/<dir>/token` in byte order of `<dir>`, as the shell's glob found it. */
function wildcardToken(serverDir: string): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(serverDir);
  } catch {
    return undefined;
  }
  const sorted = names
    .filter((name) => !name.startsWith("."))
    .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  for (const name of sorted) {
    const candidate = path.join(serverDir, name, "token");
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    // The glob's first match is the only one the shell tested with `-f`.
    return stat.isFile() ? candidate : undefined;
  }
  return undefined;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The token file the rules of R14 choose. */
export function chooseTokenFile(env: NodeJS.ProcessEnv): string {
  const named = env["MEMPALACE_DAEMON_TOKEN_FILE"];
  if (named !== undefined && named !== "") return named;
  const mock = env["TOKEN_PATH_MOCK"];
  if (mock !== undefined && mock !== "") return mock;
  const computed = tokenPathNoCreate();
  if (isFile(computed)) return computed;
  return wildcardToken(path.join(os.homedir(), ".mempalace", "server")) ?? computed;
}

/** The token, with every whitespace character removed, or the `DAEMON_UNREACHABLE` reason. */
export function readDaemonToken(env: NodeJS.ProcessEnv): TokenResult {
  const file = chooseTokenFile(env);
  if (!isFile(file)) return { ok: false, reason: `token file not found at ${file}` };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: `token file not readable at ${file}` };
  }
  // `tr -d '[:space:]'`: the POSIX space class.
  const token = raw.replace(/[ \t\n\v\f\r]+/g, "");
  if (token === "") return { ok: false, reason: `token file is empty at ${file}` };
  return { ok: true, token };
}
