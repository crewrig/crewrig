// setup-mutants.ts — the mutant table of the oracle mutation test (spec 0256 requirement 8, plan v2
// step A9). A mutant is a list of EXACT string edits applied to files of the sandbox repo AFTER the
// sandbox was built (through `GoldenCase.seed`). Every edit asserts that its `find` text occurs
// exactly once: a mutant that changes nothing, or is ambiguous, fails instead of passing vacuously.
// Each mutant declares its edits PER LEG; a leg without edits is skipped, so the TypeScript twin
// (`scripts/setup-<cli>-interactive.ts`, `scripts/lib/setup/**`) is mutated the same way once added.
// API: MUTANTS, applyEdits(repo, edits), mutate(c, edits).

import fs from "node:fs";
import path from "node:path";

import type { Cli, GoldenCase } from "./setup-golden-types.ts";
import type { Leg } from "./setup-sandbox.ts";

export interface Edit {
  /** Repository-relative file. */
  readonly file: string;
  readonly find: string;
  readonly replace: string;
}

export interface Mutant {
  readonly id: string;
  /** The edits per leg for one CLI; a leg absent from the record has no mutation yet. */
  readonly edits: (cli: Cli) => Partial<Record<Leg, readonly Edit[]>> | undefined;
  /** The golden cases (by id) that must catch the mutant, per CLI. */
  readonly cases: Readonly<Partial<Record<Cli, readonly string[]>>>;
}

const entry = (cli: Cli): string => `scripts/setup-${cli}-interactive.sh`;
const HOME_VAR: Record<Cli, string> = {
  claude: "CLAUDE_HOME",
  gemini: "GEMINI_HOME",
  copilot: "COPILOT_HOME",
  antigravity: "AGY_HOME",
};
const RULES_DEST: Record<Cli, readonly [string, string]> = {
  claude: ['"$CLAUDE_RULES/60-tools.md"', '"$CLAUDE_RULES/61-tools.md"'],
  gemini: ['"$GEMINI_HOME/60_TOOLS.md"', '"$GEMINI_HOME/61_TOOLS.md"'],
  copilot: [
    '"$COPILOT_INSTRUCTIONS/60-tools.instructions.md"',
    '"$COPILOT_INSTRUCTIONS/61-tools.instructions.md"',
  ],
  antigravity: ['"$AGY_HOME/60_TOOLS.md"', '"$AGY_HOME/61_TOOLS.md"'],
};
const TLS = 'offer_tls_delegation\necho ""\n';
const DEPS = 'install_production_dependencies "$REPO_DIR" || exit 1\necho ""\n';
const TRANSCRIPT_Q = '(opt-in)" || true)';
const ONLY = (cli: Cli, id: string): Partial<Record<Cli, readonly string[]>> => ({ [cli]: [id] });

export const MUTANTS: readonly Mutant[] = [
  {
    id: "drop-backup-before-write",
    edits: (cli) =>
      cli === "claude" || cli === "gemini"
        ? {
            shell: [
              {
                file: "scripts/lib/common.sh",
                find: 'LAST_BACKUP_PATH=""\n  for old in "$target".bak.*; do',
                replace: 'LAST_BACKUP_PATH=""\n  return 0\n  for old in "$target".bak.*; do',
              },
            ],
          }
        : undefined,
    cases: { claude: ["default-answers"], gemini: ["default-answers"] },
  },
  {
    id: "swap-tls-offer-and-dependency-step",
    edits: (cli) => ({
      shell: [
        { file: entry(cli), find: TLS, replace: "" },
        { file: entry(cli), find: DEPS, replace: `${DEPS}${TLS}` },
      ],
    }),
    cases: Object.fromEntries(
      (["claude", "gemini", "copilot", "antigravity"] as const).map((c) => [
        c,
        ["tls-delegation-on"],
      ]),
    ),
  },
  {
    id: "install-file-destination",
    edits: (cli) => ({
      shell: [
        {
          file: entry(cli),
          find: `rules/60-tools.md" ${RULES_DEST[cli][0]}`,
          replace: `rules/60-tools.md" ${RULES_DEST[cli][1]}`,
        },
      ],
    }),
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
        : { shell: [{ file: entry(cli), find: TRANSCRIPT_Q, replace: '(opt-in)")' }] },
    cases: {
      ...ONLY("claude", "cancelled-prompt-guarded"),
      ...ONLY("gemini", "cancelled-prompt-guarded"),
      ...ONLY("copilot", "cancelled-transcripts-prompt"),
    },
  },
  {
    id: "banner-message",
    edits: (cli) => ({
      shell: [
        { file: entry(cli), find: 'echo "  Setup complete"', replace: 'echo "  Setup done"' },
      ],
    }),
    cases: Object.fromEntries(
      (["claude", "gemini", "copilot", "antigravity"] as const).map((c) => [
        c,
        ["default-answers"],
      ]),
    ),
  },
  {
    id: "selected-team-marker",
    edits: (cli) => ({
      shell: [
        {
          file: entry(cli),
          find: `echo "$TEAM" > "$${HOME_VAR[cli]}/.selected_team"`,
          replace: "true",
        },
      ],
    }),
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
