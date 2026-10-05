// shim-env.ts — the PATH environments the forwarding shims are tried in (spec
// 0248 R13, R26; plan verification duties 7 and 8): no `node` at all, and a
// `node` that reports Node.js 20.
//
// The second is the real Node.js with a preload that overrides
// `process.version`, so the real floor guard (scripts/lib/node-floor-guard.js)
// runs and decides, as it would on a Node.js 20 machine. POSIX only: the
// shims are Bash.

import fs from "node:fs";
import path from "node:path";

import { cleanEnv, makePathDir, realTmp, which } from "./worktree-fixtures.ts";

function tool(name: string): string {
  const found = which(name);
  if (found === null) throw new Error(`${name} is needed by this test`);
  return found;
}

/** The commands the shims use besides `node`: all but `node` itself. */
const SUPPORT = ["dirname", "cat", "env"];

/** A PATH with the support utilities and no `node`. */
export function pathWithoutNode(): NodeJS.ProcessEnv {
  const links: Record<string, string> = {};
  for (const name of SUPPORT) links[name] = tool(name);
  return cleanEnv({ PATH: makePathDir({ links }) });
}

/** A PATH whose `node` is the real one reporting `version` (default `v20.11.1`). */
export function pathWithFakeNode(version = "v20.11.1"): NodeJS.ProcessEnv {
  const preload = path.join(realTmp("crewrig-fake-node-"), "version.js");
  fs.writeFileSync(
    preload,
    `Object.defineProperty(process, "version", { value: ${JSON.stringify(version)} });\n`,
  );
  const links: Record<string, string> = {};
  for (const name of SUPPORT) links[name] = tool(name);
  const bin = makePathDir({
    links,
    scripts: {
      node: `exec ${JSON.stringify(process.execPath)} --require ${JSON.stringify(preload)} "$@"`,
    },
  });
  return cleanEnv({ PATH: bin });
}

/** As `pathWithFakeNode`, but every other command on the parent's PATH stays reachable (for Bash libraries that need jq, mktemp and git). */
export function fakeNodeFirst(version = "v20.11.1"): NodeJS.ProcessEnv {
  const base = pathWithFakeNode(version);
  return cleanEnv({ PATH: `${base["PATH"] ?? ""}:${process.env["PATH"] ?? ""}` });
}
