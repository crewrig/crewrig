// key.ts — the content-addressed cache key and marker path of ci-cache-guard (spec 0147 R6/R7;
// spec 0262 req 10): sha256 of every declared file's sha256 (globs expanded) plus the declared
// env var values plus the command, via `node:crypto`.
//
// Usage: markerPath(opts). Exit codes: not applicable. Finding-line format: not applicable.

import { createHash } from "node:crypto";
import fs from "node:fs";

import { expand } from "./glob.ts";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** `IFS=',' read -r -a arr <<< "$s"`: the first line split on commas, one trailing empty dropped. */
export function splitComma(s: string): string[] {
  const parts = (s.split("\n")[0] ?? "").split(",");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function isFile(p: string): boolean {
  return fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;
}

export interface KeyInput {
  cacheDir: string;
  keyFiles: string;
  keyEnv: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** `$CACHE_DIR/<key>/<cmd-hash>.marker`, with the same concatenation order as the shell. */
export function markerPath(i: KeyInput): string {
  let input = "";
  for (const f of splitComma(i.keyFiles)) {
    if (f === "") continue;
    for (const word of f.split(/[ \t\n]+/).filter((w) => w !== "")) {
      for (const hit of expand(word, i.cwd)) {
        const abs = hit.startsWith("/") ? hit : `${i.cwd}/${hit}`;
        if (isFile(abs)) input += sha256(fs.readFileSync(abs));
      }
    }
  }
  for (const e of splitComma(i.keyEnv)) {
    if (e === "") continue;
    input += `${e}=${i.env[e] ?? ""}`;
  }
  const cmd = i.args.join(" ");
  const key = sha256(`${input}${cmd}`);
  return `${i.cacheDir}/${key}/${sha256(cmd)}.marker`;
}
