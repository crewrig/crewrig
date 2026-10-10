// setup-golden-cases-spec-a.ts — the R7 SPEC cells of the golden matrix for the CLAUDE and GEMINI
// shell setups (spec 0256 requirement 7 and delta-01 scenarios, plan v2 step A4a). A cell is DATA;
// the `fzf` answer table overrides the defaults of setup-golden-common.ts IN PLACE (a key that is
// not a default key lands after them, and the stub takes the FIRST substring match).
import fs from "node:fs";
import path from "node:path";

import type { GoldenCase } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";
import { CANCEL } from "./setup-stubs.ts";

type Shell = "claude" | "gemini";

interface Facts {
  /** The CLI home directory under the sandbox home, and the staging directory name under dist/<tier>/. */
  readonly dir: string;
  /** An existing context file that triggers the keep-or-refresh question. */
  readonly ruleFile: string;
  /** The default fzf key of both overlay-tier questions (substring of the header). */
  readonly overlayKey: string;
  /** The default fzf answers that must change for a "decline everything" run. */
  readonly declines: Readonly<Record<string, string>>;
}

const FACTS: Record<Shell, Facts> = {
  claude: {
    dir: ".claude",
    ruleFile: ".claude/rules/00-soul.md",
    overlayKey: "components to ~/.claude/skills",
    declines: {
      "Install Sequential Thinking MCP server?": "no",
      "Install default settings.json?": "no",
    },
  },
  gemini: {
    dir: ".gemini",
    ruleFile: ".gemini/00_SOUL.md",
    overlayKey: "components to ~/.gemini/skills",
    declines: {},
  },
};

const put = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** An existing context file, so the keep-or-refresh question is asked. */
const seedRule = (sb: SetupSandbox, f: Facts): void =>
  put(path.join(sb.home, f.ruleFile), "# existing rule\n");

/** A staged overlay tier (`dist/<tier>/<dir>`) with one skill and one agent, so its question is asked. */
function stageTier(sb: SetupSandbox, f: Facts, tier: string): void {
  const stage = path.join(sb.repo, "dist", tier, f.dir);
  put(path.join(stage, "skills", `${tier}-skill`, "SKILL.md"), `# ${tier} skill\n`);
  put(path.join(stage, "agents", `${tier}-agent.md`), `# ${tier} agent\n`);
}

/** Seed `.selected_*` markers left by a former run. */
function staleMarkers(sb: SetupSandbox, f: Facts, names: readonly string[]): void {
  for (const name of names) put(path.join(sb.home, f.dir, `.selected_${name}`), "STALE\n");
}

/** The venv bin of the pipx layout `seedMempalaceVenv` creates. */
const venvBin = (sb: SetupSandbox): string =>
  path.join(sb.home, ".local/share/pipx/venvs/mempalace/bin");

type Cell = Omit<GoldenCase, "cli">;
type Make = (f: Facts, cli: Shell) => Cell;

/** One cell per shell setup; the id and the note are shared, everything else comes from the facts. */
function both(make: Make): GoldenCase[] {
  return (["claude", "gemini"] as const).map((cli) => ({ cli, ...make(FACTS[cli], cli) }));
}

const defaultAnswers = both(() => ({
  id: "default-answers",
  note: "Every question answered with the shell default (first option); the run completes with status 0 (R7 default answers).",
}));

const declineEverywhere = both((f) => ({
  id: "decline-everywhere",
  note: "Every opt-in answered no, existing rules kept, both overlay tiers staged and declined, no recording, no usage capture (R7 decline everywhere).",
  stubs: { fzf: { ...f.declines, Existing: "keep" } },
  seed: (sb) => {
    seedRule(sb, f);
    stageTier(sb, f, "community");
    stageTier(sb, f, "org");
  },
}));

const linkMode = both(() => ({
  id: "link-mode",
  note: "--link with the one-key question answered y: warning printed, the files are symlinks, status 0 (R7 --link, R16).",
  args: ["--link"],
  stdin: "y",
}));

const linkDeclined = both(() => ({
  id: "link-mode-declined",
  note: "--link with the key n: `Aborted. Run without --link for secure copy mode.` and status 1, nothing written (R7 --link, R16).",
  args: ["--link"],
  stdin: "n",
}));

const rulesKept = both((f) => ({
  id: "rules-kept",
  note: "An existing context file and the answer keep: team, expertise, level and profile selection is skipped, the file is untouched (R7 existing context file kept, R22).",
  stubs: { fzf: { Existing: "keep" } },
  seed: (sb) => seedRule(sb, f),
}));

const rulesRefreshed = both((f) => ({
  id: "rules-refreshed",
  note: "An existing context file and the answer refresh: the existing files are deleted and the full selection flow runs (R7 existing context file refreshed, R22).",
  stubs: { fzf: { Existing: "refresh" } },
  seed: (sb) => seedRule(sb, f),
}));

const emptyCatalogue = both((f) => ({
  id: "empty-catalogue",
  note: "Every catalogue directory has no entry: no question is asked, the notice goes to stderr and the stale .selected_* markers are removed (R7 empty catalogue, R17).",
  seed: (sb) => {
    for (const name of ["teams", "expertise", "level"]) {
      const dir = path.join(sb.repo, "config", name);
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".md")) fs.rmSync(path.join(dir, file));
      }
    }
    staleMarkers(sb, f, ["team", "expertise", "level"]);
  },
}));

const cataloguePickDeclined = both((f) => ({
  id: "catalogue-pick-declined",
  note: "The expertise and level pickers are cancelled (`|| true`): `No <category> selected` on stderr, the stale markers of the unselected categories are removed, the team is still installed (R7 empty catalogue, R17).",
  stubs: { fzf: { "config/expertise": CANCEL, "config/level": CANCEL } },
  seed: (sb) => staleMarkers(sb, f, ["team", "expertise", "level"]),
}));

const tierOptins = both((f) => ({
  id: "tier-optins",
  note: "Both overlay tiers staged and both questions answered yes: skills and agents of the two tiers are installed (R7 tier opt-ins, R24). The fzf table is first-match on one shared key, so one tier yes and one tier no is not expressible; see tier-optin-org-declined.",
  stubs: { fzf: { [f.overlayKey]: "yes" } },
  seed: (sb) => {
    stageTier(sb, f, "community");
    stageTier(sb, f, "org");
  },
}));

const tierDeclined = both((f) => ({
  id: "tier-optin-org-declined",
  note: "Only the org tier staged and the question answered with the default no: `'org' install skipped.`, nothing of the tier installed, the community tier is never asked (R7 tier opt-ins, R24).",
  seed: (sb) => stageTier(sb, f, "org"),
}));

const missingPrerequisite = both((_, cli) =>
  cli === "claude"
    ? {
        id: "missing-prerequisite",
        note: "No `claude` on PATH: `Error: 'claude' CLI is required to register MCP servers.` and status 1 before any rule is written (R7 missing prerequisite, R21).",
        seed: (sb) => fs.rmSync(path.join(sb.bin, "claude")),
      }
    : {
        id: "missing-prerequisite",
        note: "The Gemini setup has no CLI prerequisite beyond fzf and jq; the real branch is the missing jq: `Error: jq is required but not installed.` and status 1 (R7 missing prerequisite, R21).",
        seed: (sb) => fs.rmSync(path.join(sb.bin, "jq")),
        // Deviation tag (a): the TypeScript setup has no `jq` guard (requirement 44 (a)).
        legs: ["shell"],
      },
);

const missingIdentity = both(() => ({
  id: "missing-identity",
  note: "config/SOUL.md and config/PROFILE.md absent: the missing-file list is printed and the status is 1 (R7 missing identity file, R21).",
  sandbox: { omitIdentity: true },
}));

const cancelGuarded = both(() => ({
  id: "cancelled-prompt-guarded",
  note: "The transcript question is cancelled (Esc): its site has `|| true`, so the answer reads as a decline and the run completes with status 0 (R7 cancelled prompt, R15).",
  stubs: { fzf: { "Enable automatic session recording": CANCEL } },
}));

const cancelUnguarded = both((f) => ({
  id: "cancelled-prompt-unguarded",
  note: "The keep-or-refresh question is cancelled: its site has no `|| true`, so `set -e` aborts the shell with the fzf status (130), nothing past the question is written (R7 cancelled prompt, R15).",
  stubs: { fzf: { Existing: CANCEL } },
  seed: (sb) => seedRule(sb, f),
  // Shell only, deviation tags (c)/(e)/(g) of requirement 44: an abort-class cancel has no
  // non-terminal form on the TypeScript leg (no pre-answer; closed stdin is exit 2). The TS side
  // is covered by setup-prompt-tty.test.ts and setup-prompt-integration.test.ts (fake terminal).
  legs: ["shell"],
}));

const linkAnswersRemain = both((f) => ({
  id: "link-answers-remain",
  note: "`y\\nkeep\\n` with --link: the shell reads one key with `read -n 1` and nothing else of stdin (its questions go to the stub fzf), so the rules question is answered by the stub (keep). The TypeScript leg reads the remainder `keep` into that question (delta-01 requirement 16).",
  args: ["--link"],
  stdin: "y\nkeep\n",
  stubs: { fzf: { Existing: "keep" } },
  seed: (sb) => seedRule(sb, f),
  shellOnly: "delta-01 requirement 16: the TypeScript leg reads the remainder",
}));

const chromaFailure = both(() => ({
  id: "chroma-install-failure",
  note: "The MemPalace venv has no `chroma` binary beside its python: the pre-flight prints ERROR lines and the status is 1, before any MemPalace registration (delta-01 Chroma failure, R25).",
  seed: (sb) => fs.rmSync(path.join(venvBin(sb), "chroma")),
}));

export const cases: readonly GoldenCase[] = [
  ...defaultAnswers,
  ...declineEverywhere,
  ...linkMode,
  ...linkDeclined,
  ...rulesKept,
  ...rulesRefreshed,
  ...emptyCatalogue,
  ...cataloguePickDeclined,
  ...tierOptins,
  ...tierDeclined,
  ...missingPrerequisite,
  ...missingIdentity,
  ...cancelGuarded,
  ...cancelUnguarded,
  ...linkAnswersRemain,
  ...chromaFailure,
];
