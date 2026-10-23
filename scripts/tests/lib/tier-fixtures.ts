// Shared fixtures for the tier-resolution suites (spec 0119, ported by spec 0263).
// Retires with retired scripts/lib/common.sh (row J4) only for the shell shims it drives.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { taskfilePaths } from "../../lib/taskfile-tree.ts";
import { createFixtureTree, REPO, type FixtureTree } from "./build-fixture-tree.ts";

export const COLLISION_REPORT_RE = /claimed by more than one component|Every source presenting it/;
export const UNRESOLVED_REPORT_RE = /resolved in any served tier|Locations examined/;

export const CLAUDE_CMD = "scripts/manage-claude-component.ts";
export const GEMINI_CMD = "scripts/manage-workspace-component.ts";
export const COPILOT_CMD = "scripts/manage-copilot-component.ts";
export const AGY_CMD = "scripts/manage-antigravity-component.ts";

export interface Out {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export const both = (o: Out): string => `${o.stdout}${o.stderr}`;

/** A throwaway repository: scripts copy, closure, Taskfile tree, config, ignore file, empty artifacts. */
export function newRepo(): FixtureTree {
  const t = createFixtureTree();
  for (const rel of taskfilePaths(REPO)) {
    fs.mkdirSync(path.dirname(t.resolve(rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), t.resolve(rel));
  }
  const cfg = path.join(REPO, "crewrig.config.toml");
  if (fs.existsSync(cfg)) fs.copyFileSync(cfg, t.resolve("crewrig.config.toml"));
  t.write(".gitignore", "dist/\ncli-home*/\npackage.json\nnode_modules/\n");
  fs.mkdirSync(t.resolve("artifacts"), { recursive: true });
  fs.mkdirSync(t.resolve("cli-home"), { recursive: true });
  return t;
}

const SCRUBBED =
  /^(CI|GITHUB_.*|GITLAB_.*|HTTPS?_PROXY|NO_PROXY|ALL_PROXY|https?_proxy|no_proxy|all_proxy|REPO_DIR|CLAUDE_CONFIG_DIR)$/;

/** Run a script of the fixture (`.ts` under node, otherwise under bash) with HOME and USERPROFILE at `home`. */
export function run(
  t: FixtureTree,
  script: string,
  args: readonly string[],
  opts: { home?: string; stdin?: string } = {},
): Out {
  const home = fs.realpathSync(opts.home ?? t.resolve("cli-home"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !SCRUBBED.test(k)) env[k] = v;
  env["HOME"] = home;
  env["USERPROFILE"] = home;
  const [bin, argv] = script.endsWith(".ts")
    ? [process.execPath, [t.resolve(script), ...args]]
    : ["bash", [t.resolve(script), ...args]];
  const r = spawnSync(bin as string, argv as string[], {
    cwd: t.root,
    env,
    encoding: "utf8",
    input: opts.stdin ?? "",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function homeDir(t: FixtureTree, name: string): string {
  const d = t.resolve(name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function build(t: FixtureTree, target: string): Out {
  return run(t, "scripts/build-components.ts", ["--target", target]);
}

const frontmatter = (kind: string, tier: string, name: string): string =>
  `---\nname: ${name}\ndescription: "Synthetic ${tier} ${kind} '${name}' for the spec 0119 regression tests."\n---\n\n\n`;

export function seedSkill(t: FixtureTree, tier: string, name: string): void {
  t.artifact(
    `${tier}/skills/${name}/SKILL.md`,
    `${frontmatter("skill", tier, name)}Body content for ${name}, seeded in tier ${tier}. This paragraph exists so the\nbuild has something to normalise that is not whitespace.\n`,
  );
}
export function seedAgent(t: FixtureTree, tier: string, name: string): void {
  t.artifact(
    `${tier}/agents/${name}/AGENT.md`,
    `${frontmatter("agent", tier, name)}Body content for agent ${name}, seeded in tier ${tier}.\n`,
  );
}
export function seedCommand(t: FixtureTree, tier: string, name: string): void {
  t.artifact(
    `${tier}/commands/${name}.md`,
    `---\nname: ${name}\ndescription: "Synthetic ${tier} command '${name}' for the spec 0119 regression tests."\ntype: command\n---\n\nBody content for command ${name}, seeded in tier ${tier}.\n`,
  );
}
export function seedPolicy(t: FixtureTree, tier: string, name: string): void {
  t.artifact(
    `${tier}/policies/${name}.md`,
    `\nPolicy body content, seeded in tier ${tier} for the spec 0119 regression tests.\n`,
  );
}
export function seedHook(t: FixtureTree, tier: string, name: string): void {
  t.artifact(`${tier}/hooks/${name}.sh`, `echo "${name} ran"\n`, 0o755);
}
export function seedJson(t: FixtureTree, tier: string, type: string, name: string): void {
  t.artifact(`${tier}/${type}/${name}.json`, `{"command":"/bin/echo","args":["${name}"]}\n`);
}
export function seedEmptyType(t: FixtureTree, tier: string, type: string): void {
  t.artifact(`${tier}/${type}/.gitkeep`, "");
}

/** Stdout minus the build's progress lines, then stderr (the `report_view` of the Bash suite). */
export function reportView(o: Out): string {
  const progress =
    /^(--- Tier:|Building (skill|command|agent):|=+$| +(Target|Mode):| +Community Component Builder$|Done\.$|$)/;
  const kept = o.stdout.split("\n").filter((l) => !progress.test(l));
  return `${kept.join("\n")}\n${o.stderr}`;
}
