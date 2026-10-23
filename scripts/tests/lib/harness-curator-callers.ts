// harness-curator-callers.ts — the text that calls the three curator scripts after the switch (spec
// 0258 requirements 32 and 35). Every skill body, reference, README and Taskfile line that names
// `curate`, `schedule-curator` or `setup-labels` must spell it as the `.ts` entry run through Node,
// never as the `.sh`, which is now a forwarding shim kept for the Bash oracle only. `checkCaller` is
// pure so the test can also prove the guard is not vacuous: it must FAIL on the old spelling and on
// a missing new spelling.

import fs from "node:fs";
import path from "node:path";
import { loadTaskfileTree } from "../../lib/taskfile-tree.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const SKILL = "artifacts/library/skills/harness-curator";

/** The three script names that became forwarding shims. */
export const NAMES: readonly string[] = ["curate", "schedule-curator", "setup-labels"];

export interface Caller {
  readonly file: string;
  /** Substrings that MUST be present: the new spelling of each script the file names. */
  readonly required: readonly string[];
}

// The Taskfile that DEFINES the curator entry (the root while monolithic, an included file after).
const CURATE_TASKFILE = loadTaskfileTree(REPO).byName.get("harness-curate")?.file;
if (CURATE_TASKFILE === undefined) throw new Error("Taskfile task harness-curate not found");

export const CALLERS: readonly Caller[] = [
  {
    file: `${SKILL}/SKILL.md`,
    required: [
      "node scripts/curate.ts --dry-run",
      "node scripts/curate.ts --deep",
      "node scripts/setup-labels.ts --repo",
      `node ${SKILL}/scripts/schedule-curator.ts`,
      `node ${SKILL}/scripts/curate.ts --apply --dedup --max-issues 5`,
    ],
  },
  { file: "artifacts/library/skills/harness-report/SKILL.md", required: [] },
  // The text moved to references/ (spec 0269); the guard follows it.
  {
    file: "artifacts/library/skills/harness-report/references/operating-mode.md",
    required: [`node ${SKILL}/scripts/curate.ts --apply`],
  },
  {
    file: "artifacts/library/skills/harness-report/references/identify-and-route.md",
    required: [],
  },
  {
    file: "artifacts/library/skills/harness-report/references/self-reporting-bias.md",
    required: [],
  },
  { file: "artifacts/FORMAT.md", required: ["scripts/curate.ts"] },
  { file: "README.md", required: [`${SKILL}/scripts/schedule-curator.ts`] },
  { file: CURATE_TASKFILE, required: [`${SKILL}/scripts/curate.ts`] },
];

/** The retired spellings of the three scripts: `<name>.sh`. */
export function retiredSpellings(text: string): string[] {
  const found: string[] = [];
  for (const name of NAMES)
    for (const m of text.matchAll(new RegExp(`\\b${name}\\.sh\\b`, "g"))) found.push(m[0]);
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
