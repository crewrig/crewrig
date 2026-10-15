// skill-scripts-callers.ts — the text that calls the eleven skill scripts after the switch (spec
// 0258 requirement 35, plan steps 33 and 35-38). Every skill, agent, reference and README text that
// names one of the scripts must spell it as the `.ts` entry run through Node, never as the retired
// `.sh` (nor as a bare name, the old suffixless spelling). `checkCaller` is pure so the test can
// also prove it is not vacuous: it must FAIL on the old spelling and on a missing new spelling.

import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const SKILLS = "artifacts/core/skills";

/** The eleven script names, as `<skill>/<name>`. */
export const NAMES: readonly string[] = [
  "github-actions/check-pinned-actions",
  "github-actions/check-secrets-exposure",
  "github-actions/lint-workflow",
  "github-actions/simulate-job",
  "github-actions/simulate-workflow",
  "gitlab-ci/check-pinned-images",
  "gitlab-ci/check-secrets-exposure",
  "pr-reviewer/lint-json",
  "pr-reviewer/lint-markdown",
  "pr-reviewer/lint-python",
  "pr-reviewer/lint-skill",
];

export interface Caller {
  readonly file: string;
  /** Substrings that MUST be present: the new spelling of each script the file names. */
  readonly required: readonly string[];
}

const run = (...names: string[]): string[] => names.map((n) => `node scripts/${n}.ts`);

export const CALLERS: readonly Caller[] = [
  {
    file: `${SKILLS}/github-actions/SKILL.md`,
    required: run(
      "lint-workflow",
      "check-pinned-actions",
      "check-secrets-exposure",
      "simulate-job",
      "simulate-workflow",
    ),
  },
  {
    file: `${SKILLS}/github-actions/references/secrets-and-vars.md`,
    required: ["scripts/check-secrets-exposure.ts"],
  },
  {
    file: `${SKILLS}/gitlab-ci/SKILL.md`,
    required: run("check-pinned-images", "check-secrets-exposure"),
  },
  {
    file: `${SKILLS}/gitlab-ci/references/runners-and-executors.md`,
    required: ["check-pinned-images.ts"],
  },
  {
    file: `${SKILLS}/gitlab-ci/references/variables-and-secrets.md`,
    required: ["scripts/check-secrets-exposure.ts"],
  },
  {
    file: `${SKILLS}/pr-reviewer/SKILL.md`,
    required: [
      "lint-markdown.ts",
      "lint-skill.ts",
      "lint-python.ts",
      "lint-json.ts",
      "node scripts/lint-markdown.ts",
      "JSON.parse",
      "js-yaml",
    ],
  },
  {
    file: "artifacts/core/agents/ci-configurator/AGENT.md",
    required: run(
      "lint-workflow",
      "check-pinned-actions",
      "check-pinned-images",
      "check-secrets-exposure",
    ),
  },
  {
    file: "artifacts/core/agents/ci-debugger/AGENT.md",
    required: run("lint-workflow", "simulate-job"),
  },
  { file: "README.md", required: ["lint-markdown.ts", "lint-skill.ts"] },
];

/** The retired spellings of the eleven scripts: `<name>.sh`, or the bare name after `scripts/`. */
export function retiredSpellings(text: string): string[] {
  const found: string[] = [];
  for (const full of NAMES) {
    const name = full.split("/")[1] as string;
    const sh = new RegExp(`\\b${name}\\.sh\\b`, "g");
    const bare = new RegExp(`scripts/${name}(?![\\w.-])`, "g");
    for (const m of text.matchAll(sh)) found.push(m[0]);
    for (const m of text.matchAll(bare)) found.push(m[0]);
  }
  return found;
}

/** The problems of one caller text: a retired spelling present, or a required one absent. */
export function checkCaller(caller: Caller, text: string): string[] {
  const problems = retiredSpellings(text).map((s) => `${caller.file}: retired spelling ${s}`);
  for (const need of caller.required)
    if (!text.includes(need)) problems.push(`${caller.file}: missing ${need}`);
  return problems;
}

export const readCaller = (caller: Caller): string =>
  fs.readFileSync(path.join(REPO, caller.file), "utf8");
