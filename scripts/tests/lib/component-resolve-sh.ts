// component-resolve-sh.ts — `sh(id, body, ...args)` for component-resolve.test.ts: the shell
// library's output for one call, REPLAYED from component-resolve.json.golden by its explicit
// case id; only the Linux golden container (COMPONENT_RESOLVE_GOLDEN_REGEN=1) runs the shell.

import { spawnSync } from "node:child_process";

import { frozen, requireShellLibrary } from "./component-resolve-golden.ts";

export interface Shell {
  out: string;
  err: string;
  status: number | null;
}

export const makeSh =
  (tmp: string, repo: string) =>
  (id: string, body: string, ...args: string[]): Shell =>
    frozen("component-resolve", id, { "<TMP>": tmp, "<REPO>": repo }, () => {
      requireShellLibrary(repo, "scripts/lib/component-resolve.sh");
      const script = `. "${repo}/scripts/lib/component-resolve.sh"; ${body}`;
      const env = { ...process.env, LC_ALL: "C" };
      const r = spawnSync("bash", ["-c", script, "x", ...args], { encoding: "utf8", env });
      return { out: r.stdout, err: r.stderr, status: r.status };
    });
