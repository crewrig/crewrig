// Helpers for the tier-resolution landing, declaration and Taskfile suites (spec 0119, ported by
// spec 0263). Retires with scripts/lib/common.sh (row J4) only for the shell shims it drives.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, type FixtureTree } from "./build-fixture-tree.ts";
import type { Out } from "./tier-fixtures.ts";

const SCRUBBED =
  /^(CI|GITHUB_.*|GITLAB_.*|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|https?_proxy|no_proxy|all_proxy|REPO_DIR|CLAUDE_CONFIG_DIR)$/;

/** The child environment: the caller's, minus CI and proxy variables, HOME and USERPROFILE at `home`. */
export function scratchEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !SCRUBBED.test(k)) env[k] = v;
  const real = fs.realpathSync(home);
  env["HOME"] = real;
  env["USERPROFILE"] = real;
  return env;
}

/** Run `cmd args` in the fixture root with a scratch home and optional stdin. */
export function runIn(
  t: FixtureTree,
  cmd: string,
  args: readonly string[],
  home: string,
  stdin = "",
): Out {
  const r = spawnSync(cmd, [...args], {
    cwd: t.root,
    env: scratchEnv(home),
    encoding: "utf8",
    input: stdin,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const NODE_FLAGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

/** One `<cli> <key> <value>` fact per entry of the evaluated manage declarations. */
export function manageFacts(): { cli: string; key: string; value: string }[] {
  const r = spawnSync(
    process.execPath,
    [...NODE_FLAGS, path.join(REPO, "scripts/tests/lib/print-manage-declarations.ts")],
    { encoding: "utf8" },
  );
  return r.stdout
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const [cli = "", key = "", ...rest] = l.split("\t");
      return { cli, key, value: rest.join("\t") };
    });
}

/** The value of setup fact `key` for `cli` ("" when absent or the declaration is empty). */
export function setupFact(cli: string, key: string): string {
  const r = spawnSync(
    process.execPath,
    [...NODE_FLAGS, path.join(REPO, "scripts/tests/lib/print-setup-declarations.ts"), cli],
    { encoding: "utf8" },
  );
  for (const l of r.stdout.split("\n")) if (l.startsWith(`${key}=`)) return l.slice(key.length + 1);
  return "";
}
