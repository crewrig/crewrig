// setup-golden-cases-spec-b2.ts — shared seeds and the Antigravity half of the R7 spec cells of
// the Copilot and Antigravity shell setups (spec 0256 requirement 7 and delta-01, plan v2 step A4a).
// The Copilot half and the concatenation live in setup-golden-cases-spec-b.ts.
import fs from "node:fs";
import path from "node:path";

import type { GoldenCase } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";
import { CANCEL } from "./setup-stubs.ts";

/** Write `text` at `rel` under `base` (a sandbox directory), creating parents. */
export function put(base: string, rel: string, text: string): void {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Remove the named stubs from the sandbox bin: the program is then absent from PATH. */
export function unstub(sb: SetupSandbox, ...names: readonly string[]): void {
  for (const name of names) fs.rmSync(path.join(sb.bin, name), { force: true });
}

/** Empty one catalogue of the sandbox checkout (`config/teams` and so on). */
export function emptyCatalogue(sb: SetupSandbox, name: string): void {
  const dir = path.join(sb.repo, "config", name);
  for (const file of fs.readdirSync(dir)) if (file.endsWith(".md")) fs.rmSync(path.join(dir, file));
}

/** The pipx venv of the seed has no `chroma` beside its python. */
export function dropChroma(sb: SetupSandbox): void {
  fs.rmSync(path.join(sb.home, ".local/share/pipx/venvs/mempalace/bin/chroma"));
}

/** No MemPalace anywhere: the seeded pipx venv and the python3 stub (which always claims the module) are gone. */
export function noMempalace(sb: SetupSandbox): void {
  fs.rmSync(path.join(sb.home, ".local/share/pipx"), { recursive: true, force: true });
  unstub(sb, "python3");
}

const AGY = ".gemini/antigravity-cli";
const seedRules = (sb: SetupSandbox): void => put(sb.home, `${AGY}/99_CUSTOM.md`, "# mine\n");
const stageTier = (sb: SetupSandbox, tier: string): void => {
  put(sb.repo, `dist/${tier}/.agents/skills/demo-${tier}/SKILL.md`, `# ${tier} skill\n`);
  put(sb.repo, `dist/${tier}/.agents/agents/demo-${tier}/AGENT.md`, `# ${tier} agent\n`);
};
const stale = (sb: SetupSandbox): void => {
  for (const kind of ["team", "expertise", "level"])
    put(sb.home, `${AGY}/.selected_${kind}`, "STALE\n");
};

export const antigravityCases: readonly GoldenCase[] = [
  {
    id: "default-answers",
    cli: "antigravity",
    note: "Every question answered with its first option runs the setup to completion (R7 row default answers).",
  },
  {
    id: "decline-everywhere",
    cli: "antigravity",
    note: "Every opt-in declined (SequentialThinking, overlay tiers, TLS, MemPalace install, recording, usage capture), existing rules kept, no overlay installed (R7 row decline everywhere).",
    seed: (sb) => {
      noMempalace(sb);
      seedRules(sb);
      stageTier(sb, "community");
      stageTier(sb, "org");
    },
    stubs: {
      fzf: {
        "Include SequentialThinking MCP server": "no",
        "components to ~/.gemini/config/skills": "no",
        "Configure the framework's tools to trust": "no",
        "MemPalace not found": "no",
        "Enable automatic session recording": "no",
        "Enable Antigravity CLI usage capture": "no",
        Existing: "keep",
      },
    },
  },
  {
    id: "link-mode",
    cli: "antigravity",
    note: "--link with the key y on stdin: the shell reads one key with `read -n 1`, then installs by symlink (R7 row --link, requirement 16).",
    args: ["--link"],
    stdin: "y",
  },
  {
    id: "link-mode-declined",
    cli: "antigravity",
    note: "--link with the key n: the agy guard runs BEFORE the link warning, then the warning, then exit 1 with `Aborted. Run without --link for secure copy mode.` and nothing written (requirement 16).",
    args: ["--link"],
    stdin: "n",
  },
  {
    id: "rules-kept",
    cli: "antigravity",
    note: "An existing context file asks the keep/refresh question; keep skips team, expertise, level and profile selection (R7 row existing context file kept).",
    seed: seedRules,
    stubs: { fzf: { Existing: "keep" } },
  },
  {
    id: "rules-refreshed",
    cli: "antigravity",
    note: "refresh deletes the existing NN_*.md files then runs the full selection flow (R7 row existing context file refreshed).",
    seed: seedRules,
    stubs: { fzf: { Existing: "refresh" } },
  },
  {
    id: "empty-catalogue",
    cli: "antigravity",
    note: "An empty team catalogue prints the stderr message with no question, and removes a stale .selected_team marker (pick_catalogue_entry; Antigravity asks team, expertise, level in that order).",
    seed: (sb) => {
      stale(sb);
      emptyCatalogue(sb, "teams");
    },
  },
  {
    id: "declined-catalogue-pick",
    cli: "antigravity",
    note: "A cancelled catalogue pick (level, then expertise) is a skip, not an abort: the `|| true` of pick_catalogue_entry; stale markers are removed.",
    seed: stale,
    stubs: { fzf: { "config/level": CANCEL, "config/expertise": CANCEL } },
  },
  {
    id: "tier-optins-yes",
    cli: "antigravity",
    note: "Both overlay tiers staged and accepted install their skills and agents under ~/.gemini/config (R7 row tier opt-ins; the shared fzf key answers both prompts alike).",
    seed: (sb) => {
      stageTier(sb, "community");
      stageTier(sb, "org");
    },
    stubs: { fzf: { "components to ~/.gemini/config/skills": "yes" } },
  },
  {
    id: "tier-optins-no",
    cli: "antigravity",
    note: "Both overlay tiers staged and declined install nothing and print the skipped lines (R7 row tier opt-ins).",
    seed: (sb) => {
      stageTier(sb, "community");
      stageTier(sb, "org");
    },
  },
  {
    id: "tier-optin-one-staged",
    cli: "antigravity",
    note: "Only the community tier is staged: only its question is asked and a yes installs it; the org question is not asked (R7 row tier opt-ins).",
    seed: (sb) => stageTier(sb, "community"),
    stubs: { fzf: { "components to ~/.gemini/config/skills": "yes" } },
  },
  {
    id: "missing-prerequisite",
    cli: "antigravity",
    note: "No agy on PATH: the shell prints the install error and exits 1 before anything is written (R7 row missing prerequisite).",
    seed: (sb) => unstub(sb, "agy"),
  },
  {
    id: "missing-identity",
    cli: "antigravity",
    note: "No config/SOUL.md and config/PROFILE.md: the shell lists both and exits 1 before any selection (R7 row missing identity file).",
    sandbox: { omitIdentity: true },
  },
  {
    id: "cancelled-transcripts-prompt",
    cli: "antigravity",
    note: "An fzf cancel on the transcripts question has no `|| true`: under set -e the shell stops with status 130 (R7 row cancelled prompt, abort class).",
    stubs: { fzf: { "Enable automatic session recording": CANCEL } },
  },
  {
    id: "cancelled-rules-action",
    cli: "antigravity",
    note: "An fzf cancel on the keep/refresh question has no `|| true`: under set -e the shell stops with status 130 (R7 row cancelled prompt, abort class).",
    seed: seedRules,
    stubs: { fzf: { Existing: CANCEL } },
  },
  {
    id: "link-answers-remain",
    cli: "antigravity",
    note: "delta-01 requirement 16: with `y\\nkeep\\n` the shell consumes only the key y; the remainder is never read by the shell (the fzf stub answers the questions).",
    args: ["--link"],
    stdin: "y\nkeep\n",
    shellOnly: "delta-01 requirement 16: the TypeScript leg reads the remainder",
  },
  {
    id: "chroma-install-failure",
    cli: "antigravity",
    note: "delta-01 scenario: a venv without a chroma binary prints the ERROR lines and exits 1 before any MemPalace registration, nothing after.",
    seed: dropChroma,
  },
];
