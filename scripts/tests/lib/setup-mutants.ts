// setup-mutants.ts — the mutant table of the oracle mutation test (spec 0256 requirement 8, plan v2
// step A9). A mutant is a list of EXACT string edits applied to files of the sandbox repo AFTER the
// sandbox was built (through `GoldenCase.seed`). Every edit asserts that its `find` text occurs
// exactly once: a mutant that changes nothing, or is ambiguous, fails instead of passing vacuously.
// A mutant edits the TypeScript implementation (`scripts/lib/setup/**`), which BOTH golden legs run
// (`shell` through the forwarding shim, `ts` directly): the shell scripts no longer hold logic.
// API: MUTANTS, applyEdits(repo, edits), mutate(c, edits).

import fs from "node:fs";
import path from "node:path";

import type { Cli, GoldenCase } from "./setup-golden-types.ts";

export interface Edit {
  /** Repository-relative file. */
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

export interface Mutant {
  readonly id: string;
  /** The edits for one CLI, applied on every leg; undefined when the mutant does not apply to it. */
  readonly edits: (cli: Cli) => readonly Edit[] | undefined;
  /** The golden cases (by id) that must catch the mutant, per CLI. */
  readonly cases: Readonly<Partial<Record<Cli, readonly string[]>>>;
}

const TS_STEPS = (cli: Cli): string => `scripts/lib/setup/cli-${cli}.ts`;
const TS_RULES_DEST: Record<Cli, readonly [string, string]> = {
  claude: ['dest: "60-tools.md",', 'dest: "61-tools.md",'],
  gemini: ['dest: "60_TOOLS.md",', 'dest: "61_TOOLS.md",'],
  copilot: ['"60-tools.instructions.md",', '"61-tools.instructions.md",'],
  antigravity: ['"60_TOOLS.md"),', '"61_TOOLS.md"),'],
};
const ONLY = (cli: Cli, id: string): Partial<Record<Cli, readonly string[]>> => ({ [cli]: [id] });

export const MUTANTS: readonly Mutant[] = [
  {
    id: "drop-backup-before-write",
    edits: (cli) =>
      cli === "claude" || cli === "gemini"
        ? [
            {
              file: "scripts/lib/setup/backup.ts",
              find: "  narrowOldBackups(file);\n",
              replace: '  if (file !== "") return "";\n  narrowOldBackups(file);\n',
            },
          ]
        : undefined,
    cases: { claude: ["default-answers"], gemini: ["default-answers"] },
  },
  {
    id: "swap-tls-offer-and-dependency-step",
    edits: (cli) => [
      {
        file: TS_STEPS(cli),
        find: '"tls-offer",\n    "deps-install",',
        replace: '"deps-install",\n    "tls-offer",',
      },
    ],
    cases: Object.fromEntries(
      (["claude", "gemini", "copilot", "antigravity"] as const).map((c) => [
        c,
        ["tls-delegation-on"],
      ]),
    ),
  },
  {
    id: "install-file-destination",
    edits: (cli) => [
      { file: TS_STEPS(cli), find: TS_RULES_DEST[cli][0], replace: TS_RULES_DEST[cli][1] },
    ],
    cases: Object.fromEntries(
      (["claude", "gemini", "copilot", "antigravity"] as const).map((c) => [
        c,
        ["default-answers"],
      ]),
    ),
  },
  {
    id: "drop-cancelled-prompt-guard",
    edits: (cli) =>
      cli === "antigravity" // its transcript prompt has no `|| true` (pinned shell behaviour)
        ? undefined
        : [
            {
              file: "scripts/lib/setup/steps-hooks.ts",
              find: '    options: ["no", "yes"],\n    cancel: "decline",',
              replace: '    options: ["no", "yes"],\n    cancel: "abort",',
            },
          ],
    cases: {
      ...ONLY("claude", "cancelled-prompt-guarded"),
      ...ONLY("gemini", "cancelled-prompt-guarded"),
      ...ONLY("copilot", "cancelled-transcripts-prompt"),
    },
  },
  {
    id: "banner-message",
    edits: () => [
      {
        file: "scripts/lib/setup/summary.ts",
        find: 'io.out("  Setup complete");',
        replace: 'io.out("  Setup done");',
      },
    ],
    cases: Object.fromEntries(
      (["claude", "gemini", "copilot", "antigravity"] as const).map((c) => [
        c,
        ["default-answers"],
      ]),
    ),
  },
  {
    id: "selected-team-marker",
    edits: () => [
      {
        file: "scripts/lib/setup/steps-rules-pick.ts",
        find: "fs.writeFileSync(marker, `${name}\\n`)",
        replace: "undefined",
      },
    ],
    cases: Object.fromEntries(
      (["claude", "gemini", "copilot", "antigravity"] as const).map((c) => [
        c,
        ["default-answers"],
      ]),
    ),
  },
];

/** Apply exact edits under `repo`; throws when a `find` does not occur exactly once. */
export function applyEdits(repo: string, edits: readonly Edit[]): void {
  for (const e of edits) {
    const file = path.join(repo, e.file);
    const text = fs.readFileSync(file, "utf8");
    const n = text.split(e.find).length - 1;
    if (n !== 1)
      throw new Error(`vacuous mutant: ${JSON.stringify(e.find)} occurs ${n}x in ${e.file}`);
    fs.writeFileSync(
      file,
      text.replace(e.find, () => e.replace),
    );
  }
}

/** The case with its seed followed by the mutation: the mutation lands after the sandbox exists. */
export function mutate(c: GoldenCase, edits: readonly Edit[]): GoldenCase {
  return {
    ...c,
    seed: (sb) => {
      c.seed?.(sb);
      applyEdits(sb.repo, edits);
    },
  };
}
