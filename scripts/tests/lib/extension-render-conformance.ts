// extension-render-conformance.ts — the expected file sets and helpers of the render conformance
// suites (spec 0265, row J2; replaces the heredocs and `hook_file_sets_match` of the retired
// Bash suite). One path per array element, so a legitimate change to the output of the reference
// extension is a one-line, reviewable diff: no golden regeneration, no `--update-golden`.

import fs from "node:fs";
import path from "node:path";

import { REPO, cloneTemplate, globToRegExp, writeFile } from "./extension-sandbox.ts";

export const EXT_NAME = "hello-world";

export const EXPECTED_GEMINI_GENERATED: readonly string[] = [
  "commands/hello.toml",
  "gemini-extension.json",
  "GEMINI.md",
  "hooks/hooks.json",
];

export const EXPECTED_CLAUDE: readonly string[] = [
  ".claude-plugin/plugin.json",
  ".mcp.json",
  "CLAUDE.md",
  "package.json",
  "skills/greeter/SKILL.md",
  "skills/hello/SKILL.md",
  "agents/reference-guide.md",
  "hooks/hooks.json",
  "hooks/prompt-logger.ts",
  "hooks/shell-logger.ts",
  "dist/index.js",
];

export const EXPECTED_COPILOT: readonly string[] = [
  "plugin.json",
  ".mcp.json",
  "package.json",
  "skills/greeter/SKILL.md",
  "skills/hello/SKILL.md",
  "skills/hello-world-context/SKILL.md",
  "agents/reference-guide.agent.md",
  "hooks.json",
  "hooks/prompt-logger.ts",
  "hooks/shell-logger.ts",
  "dist/index.js",
];

export const EXPECTED_ANTIGRAVITY: readonly string[] = [
  "package.json",
  "plugin.json",
  "mcp_config.json",
  "rules/AGENTS.md",
  "skills/greeter/SKILL.md",
  "skills/hello/SKILL.md",
  "agents/reference-guide/AGENT.md",
  "hooks.json",
  "hooks/prompt-logger.ts",
  "hooks/shell-logger.ts",
  "dist/index.js",
];

/** The example hooks every plugin ships, TypeScript only (spec 0258). */
export const EXAMPLE_HOOKS: readonly string[] = ["prompt-logger", "shell-logger"];

/** Every regular file under `dir`, relative, always with "/", sorted; [] when `dir` is absent. */
export function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

export type HookSetResult = "match" | "mismatch" | "vacuity";

/**
 * `vacuity` when a named hook lacks its `.ts` file or carries a `.sh` in the produced tree,
 * `match` when the sets are equal (as sets), `mismatch` otherwise.
 */
export function hookFileSetsMatch(
  actual: readonly string[],
  expected: readonly string[],
  hooks: readonly string[],
): HookSetResult {
  for (const name of hooks) {
    if (actual.includes(`hooks/${name}.sh`)) return "vacuity";
    if (!actual.includes(`hooks/${name}.ts`)) return "vacuity";
  }
  const a = [...new Set(actual)].sort();
  const e = [...new Set(expected)].sort();
  return a.length === e.length && a.every((file, i) => file === e[i]) ? "match" : "mismatch";
}

/**
 * The GENERATED members of a build tree: files that are `manifest_class` members or match a
 * `generated_globs` entry of the class file (shell `case` semantics, see `globToRegExp`), never
 * the verbatim copy of the source the tree also carries.
 */
export function geminiGeneratedMembers(dir: string, classFile: string): string[] {
  const cls = JSON.parse(fs.readFileSync(classFile, "utf8")) as {
    manifest_class: string[];
    generated_globs: string[];
  };
  const globs = cls.generated_globs.map(globToRegExp);
  return listFiles(dir).filter(
    (rel) => cls.manifest_class.includes(rel) || globs.some((re) => re.test(rel)),
  );
}

/** A sandbox (private clone of `template`) holding the real hello-world plus its `dist/` stub. */
export function sandboxFor(template: string, name = EXT_NAME): string {
  const root = cloneTemplate(template);
  if (!fs.existsSync(path.join(root, "extensions", "core", name, "extension.json")))
    throw new Error(`${name} is not among the tracked extensions of ${REPO}`);
  // The artifact the declared MCP server names; it lives in the sandbox only.
  writeFile(
    root,
    `extensions/core/${name}/dist/index.js`,
    "// Fixture stub: proves the artifact-copy path, never executed.\n",
  );
  return root;
}
