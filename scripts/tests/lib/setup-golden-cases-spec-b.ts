// setup-golden-cases-spec-b.ts — the R7 spec cells of the Copilot and Antigravity shell setups
// (spec 0256 requirement 7 and delta-01, plan v2 step A4a). The Antigravity half and the shared
// seeds live in setup-golden-cases-spec-b2.ts.
import type { GoldenCase } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";
import { CANCEL } from "./setup-stubs.ts";
import {
  antigravityCases,
  dropChroma,
  emptyCatalogue,
  noMempalace,
  put,
  unstub,
} from "./setup-golden-cases-spec-b2.ts";

const INSTR = ".copilot/instructions";
const seedRules = (sb: SetupSandbox): void =>
  put(sb.home, `${INSTR}/99-custom.instructions.md`, "# mine\n");
const stageTier = (sb: SetupSandbox, tier: string): void =>
  put(sb.repo, `dist/${tier}/.github/skills/demo-${tier}/SKILL.md`, `# ${tier} skill\n`);
const stale = (sb: SetupSandbox): void => {
  for (const kind of ["team", "expertise", "level"])
    put(sb.home, `.copilot/.selected_${kind}`, "STALE\n");
};

const copilotCases: readonly GoldenCase[] = [
  {
    id: "default-answers",
    cli: "copilot",
    note: "Every question answered with its first option runs the setup to completion (R7 row default answers).",
  },
  {
    id: "decline-everywhere",
    cli: "copilot",
    note: "Every opt-in declined (overlay tiers, TLS, MemPalace install, recording, usage capture), existing instructions kept, no overlay installed (R7 row decline everywhere).",
    seed: (sb) => {
      noMempalace(sb);
      seedRules(sb);
      stageTier(sb, "community");
      stageTier(sb, "org");
    },
    stubs: {
      fzf: {
        "skills to ~/.copilot": "no",
        "Configure the framework's tools to trust": "no",
        "MemPalace not found": "no",
        "Enable automatic session recording": "no",
        "Capture token usage for Copilot CLI?": "no",
        Existing: "keep",
      },
    },
  },
  {
    id: "link-mode",
    cli: "copilot",
    note: "--link installs by symlink; the Copilot shell has NO --link warning and NO one-key question (unlike the other three setups: setup-copilot-interactive.sh only sets INSTALL_MODE), so the key y on stdin is never read and the run exits 0 (R7 row --link, requirement 16).",
    args: ["--link"],
    stdin: "y",
  },
  {
    id: "link-mode-no-question",
    cli: "copilot",
    note: "The Copilot shell prints no --link warning and asks no one-key question (it only sets INSTALL_MODE): the key n on stdin is never read, the run installs by symlink without asking and exits 0, where requirement 16 says exit 1 (shell baseline of a spec gap).",
    args: ["--link"],
    stdin: "n",
  },
  {
    id: "rules-kept",
    cli: "copilot",
    note: "An existing instruction file asks INSTR_ACTION; keep skips level, expertise and team selection (R7 row existing context file kept).",
    seed: seedRules,
    stubs: { fzf: { Existing: "keep" } },
  },
  {
    id: "rules-refreshed",
    cli: "copilot",
    note: "refresh deletes the existing *.instructions.md files then runs the full selection flow (R7 row existing context file refreshed).",
    seed: seedRules,
    stubs: { fzf: { Existing: "refresh" } },
  },
  {
    id: "empty-catalogue",
    cli: "copilot",
    note: "An empty team catalogue prints the stderr message with no question, and removes a stale .selected_team marker (pick_catalogue_entry; Copilot asks level, expertise, then team).",
    seed: (sb) => {
      stale(sb);
      emptyCatalogue(sb, "teams");
    },
  },
  {
    id: "declined-catalogue-pick",
    cli: "copilot",
    note: "A cancelled catalogue pick (level, then expertise) is a skip, not an abort: the `|| true` of pick_catalogue_entry; stale markers are removed.",
    seed: stale,
    stubs: { fzf: { "config/level": CANCEL, "config/expertise": CANCEL } },
  },
  {
    id: "tier-optins-yes",
    cli: "copilot",
    note: "Both overlay tiers staged and accepted install their skills under ~/.copilot/skills (R7 row tier opt-ins; the shared fzf key answers both prompts alike).",
    seed: (sb) => {
      stageTier(sb, "community");
      stageTier(sb, "org");
    },
    stubs: { fzf: { "skills to ~/.copilot": "yes" } },
  },
  {
    id: "tier-optins-no",
    cli: "copilot",
    note: "Both overlay tiers staged and declined install nothing and print the skipped lines (R7 row tier opt-ins).",
    seed: (sb) => {
      stageTier(sb, "community");
      stageTier(sb, "org");
    },
  },
  {
    id: "tier-optin-one-staged",
    cli: "copilot",
    note: "Only the community tier is staged: only its question is asked and a yes installs it; the org question is not asked (R7 row tier opt-ins).",
    seed: (sb) => stageTier(sb, "community"),
    stubs: { fzf: { "skills to ~/.copilot": "yes" } },
  },
  {
    id: "copilot-missing-cli-warning",
    cli: "copilot",
    note: "Neither `gh copilot` nor `copilot` on PATH is only a warning: the run continues and completes (R7 row missing prerequisite; requirement 21).",
    seed: (sb) => unstub(sb, "gh", "copilot"),
  },
  {
    id: "missing-identity",
    cli: "copilot",
    note: "No config/SOUL.md and config/PROFILE.md: the shell lists both and exits 1 before any write (R7 row missing identity file).",
    sandbox: { omitIdentity: true },
  },
  {
    id: "cancelled-transcripts-prompt",
    cli: "copilot",
    note: "An fzf cancel on the transcripts question has `|| true`: it reads as a decline and the run completes with status 0 (R7 row cancelled prompt, decline class).",
    stubs: { fzf: { "Enable automatic session recording": CANCEL } },
  },
  {
    id: "cancelled-rules-action",
    cli: "copilot",
    note: "An fzf cancel on INSTR_ACTION has no `|| true`: under set -e the shell stops with status 130 (R7 row cancelled prompt, abort class).",
    seed: seedRules,
    stubs: { fzf: { Existing: CANCEL } },
  },
  {
    id: "link-answers-remain",
    cli: "copilot",
    note: "delta-01 requirement 16: with `y\\nkeep\\n` the Copilot shell reads none of standard input (no link question); the fzf stub answers the questions.",
    args: ["--link"],
    stdin: "y\nkeep\n",
    shellOnly: "delta-01 requirement 16: the TypeScript leg reads the remainder",
  },
  {
    id: "chroma-install-failure",
    cli: "copilot",
    note: "delta-01 scenario: a venv without a chroma binary prints the ERROR lines and exits 1 before any MemPalace registration, nothing after.",
    seed: dropChroma,
  },
];

export const cases: readonly GoldenCase[] = [...copilotCases, ...antigravityCases];
