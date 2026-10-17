// antigravity-fixtures.ts — fixture builders and the sourced-shell runner shared by the Antigravity
// component tests. Retires with scripts/lib/common.sh (row J4): `runCommon` sources the library.
// The builders are ports of write_component / stage_skill / stage_agent of the retired
// test-antigravity-component-install.sh and are also used against the TypeScript twin.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cleanEnv, realTmp, REPO } from "./worktree-fixtures.ts";

export interface ShellRun {
  readonly status: number | null;
  /** stdout and stderr interleaved (`2>&1`, as the Bash suite captured it). */
  readonly out: string;
}

/**
 * Write one component marker. `body: "canonical"` appends an INDENTED provenance block to the BODY,
 * outside the frontmatter and lexically identical to a real one. The indentation is load-bearing:
 * never simplify it to column 0, or a mutant that drops the frontmatter-exit rule would pass green.
 */
export function writeComponent(
  marker: string,
  name: string,
  prov: boolean,
  body: "plain" | "canonical" = "plain",
): void {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  const lines = ["---", `name: ${name}`, `description: "Fixture component ${name}."`];
  if (prov) {
    lines.push(
      "metadata:",
      "  provenance:",
      '    canonical: "https://github.com/crewrig/crewrig"',
      '    feedback: "https://github.com/crewrig/crewrig"',
      '    version: "1.0.0"',
    );
  }
  lines.push("---", "", `# ${name}`, "", "Fixture body.");
  if (body === "canonical") {
    lines.push(
      "",
      "A user's own notes, quoting what a framework block looks like:",
      "",
      "    metadata:",
      "      provenance:",
      '        canonical: "https://github.com/some-user/their-own-thing"',
      "",
    );
  }
  fs.writeFileSync(marker, lines.join("\n") + "\n");
}

export const stageSkill = (
  root: string,
  name: string,
  prov = true,
  body: "plain" | "canonical" = "plain",
): void => writeComponent(path.join(root, "skills", name, "SKILL.md"), name, prov, body);

export const stageAgent = (
  root: string,
  name: string,
  prov = true,
  body: "plain" | "canonical" = "plain",
): void => writeComponent(path.join(root, "agents", name, "AGENT.md"), name, prov, body);

/** A real-path scratch directory, removed by `cleanupAll` of worktree-fixtures. */
export const scratch = (prefix: string): string => realTmp(prefix);

const BASH = fs.existsSync("/bin/bash") ? "/bin/bash" : "bash";

/**
 * `bash -c '. scripts/lib/common.sh; INSTALL_MODE=copy; fn "$@" 2>&1'` under `set -uo pipefail`
 * (the empty-array trap of Bash 3.2 lives under `set -u`). HOME and USERPROFILE are scratch.
 */
export function runCommon(fn: string, args: readonly string[]): ShellRun {
  const home = realTmp("agy-common-home-");
  const script = `set -uo pipefail\nINSTALL_MODE=copy\n. "${path.join(REPO, "scripts/lib/common.sh")}"\n${fn} "$@" 2>&1`;
  const res = spawnSync(BASH, ["-c", script, "_", ...args], {
    encoding: "utf8",
    cwd: home,
    env: cleanEnv({ HOME: home, USERPROFILE: home, CI: undefined }),
  });
  return { status: res.status, out: res.stdout };
}
