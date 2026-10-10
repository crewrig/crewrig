// uninstall-oracle-fixture.ts — hermetic-PATH helpers of the uninstall-mcp-daemon
// oracle (spec 0252 R21): link a real tool onto the hermetic PATH, derive the token path.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HermeticEnv } from "./hermetic-env.ts";

/** Absolute path of the first executable `name` on the real PATH. */
function realTool(name: string): string {
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (path.isAbsolute(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate;
  }
  throw new Error(`oracle: ${name} not found on PATH`);
}

/** Make a real tool available on the hermetic PATH (the script needs jq and a sha256 tool). */
export function linkReal(h: HermeticEnv, name: string): void {
  fs.symlinkSync(realTool(name), path.join(h.bin, name));
}

/** The token path `mcp_token_path` derives: ~/.mempalace/server/<sha256(palace)[:24]>/token. */
export function tokenPathOf(home: string): string {
  const palace = path.join(fs.realpathSync(path.join(home, ".mempalace")), "palace");
  const key = createHash("sha256").update(palace).digest("hex").slice(0, 24);
  return path.join(home, ".mempalace", "server", key, "token");
}
