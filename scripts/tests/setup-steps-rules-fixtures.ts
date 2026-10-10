// setup-steps-rules-fixtures.ts — the rules data of the four CLIs (the contract documented at the
// top of steps-rules.ts, copied from the shells), a sandbox repository and a runner, shared by the
// setup-steps-rules tests (not a test file itself).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach } from "node:test";

import type { Cli } from "../lib/setup/context.ts";
import type { PickKind, RuleFile, SetupDescriptor, StepId } from "../lib/setup/descriptor.ts";
import { runSetup } from "../lib/setup/flow.ts";
import { descriptor } from "./setup-flow-fixtures.ts";

const REAL = path.resolve(import.meta.dirname, "..", "..");
const GOLDEN = path.join(REAL, "scripts", "tests", "fixtures", "setup-golden");
const STORE_LABEL = "artifacts/core/system-context -> ~/.crewrig/system-context";

interface Style {
  readonly rulesDir: string;
  readonly cliHome: string;
  readonly prefix: string;
  readonly names: readonly string[];
  readonly selNames: readonly string[];
  readonly orgRules?: string;
  readonly texts: readonly string[];
}

const SEL = "Team / expertise / level / profile selection will be skipped.";
// names: soul, organization, profile, 60-tools, 65-tools; selNames: level, expertise, team.
const STYLES: Readonly<Record<Cli, Style>> = {
  claude: {
    rulesDir: ".claude/rules",
    cliHome: ".claude",
    prefix: "rules/",
    names: ["00-soul.md", "20-organization.md", "30-profile.md", "60-tools.md", "65-org-tools.md"],
    selNames: ["10-level.md", "40-expertise.md", "50-team.md"],
    texts: [
      "Existing rule files found in",
      "Existing rules detected — keep them (skip selection) or refresh from scratch?",
      `Keeping existing rules. ${SEL}`,
      "Existing rules removed. Full selection flow will run.",
    ],
  },
  gemini: {
    rulesDir: ".gemini",
    cliHome: ".gemini",
    prefix: "",
    names: ["00_SOUL.md", "20_ORGANIZATION.md", "30_USER_PROFILE.md", "60_TOOLS.md", "65_TOOLS.md"],
    selNames: ["10_USER_LEVEL.md", "40_USER_EXPERTISE.md", "50_USER_TEAM.md"],
    orgRules: "66_ORG_RULES.md",
    texts: [
      "Existing context files found in",
      "Existing context files detected — keep them (skip selection) or refresh from scratch?",
      `Keeping existing context files. ${SEL}`,
      "Existing context files removed. Full selection flow will run.",
    ],
  },
  copilot: {
    rulesDir: ".copilot/instructions",
    cliHome: ".copilot",
    prefix: "instructions/",
    names: [
      "00-soul.instructions.md",
      "20-organization.instructions.md",
      "30-profile.instructions.md",
      "60-tools.instructions.md",
      "65-org-tools.instructions.md",
    ],
    selNames: [
      "10-level.instructions.md",
      "40-expertise.instructions.md",
      "50-team.instructions.md",
    ],
    orgRules: "66-org-rules.instructions.md",
    texts: [
      "Existing instruction files found in",
      "Existing instructions detected — keep them (skip selection) or refresh from scratch?",
      "Keeping existing instructions. Team / expertise / level selection will be skipped.",
      "Existing instructions removed. Full selection flow will run.",
    ],
  },
  antigravity: {
    rulesDir: ".gemini/antigravity-cli",
    cliHome: ".gemini/antigravity-cli",
    prefix: "",
    names: ["00_SOUL.md", "20_ORGANIZATION.md", "30_USER_PROFILE.md", "60_TOOLS.md", "65_TOOLS.md"],
    selNames: ["10_USER_LEVEL.md", "40_USER_EXPERTISE.md", "50_USER_TEAM.md"],
    orgRules: "66_ORG_RULES.md",
    texts: [
      "Existing context files found in",
      "Existing context files detected — keep them (skip selection) or refresh from scratch?",
      `Keeping existing context files. ${SEL}`,
      "Existing context files removed. Full selection flow will run.",
    ],
  },
};

export const GLOBS: Readonly<Record<Cli, string>> = {
  claude: "*.md",
  gemini: "[0-9][0-9]_*.md",
  copilot: "*.instructions.md",
  antigravity: "[0-9][0-9]_*.md",
};

/** The `homes` and `rules` data of one CLI, the way T8's descriptors carry it. */
export function rulesData(cli: Cli): Pick<SetupDescriptor, "homes" | "rules"> {
  const s = STYLES[cli];
  const file = (src: string, label: string, dest: string): RuleFile => ({
    src,
    dest,
    label: `${label} -> ${s.prefix}${dest}`,
  });
  const [soulN, orgN, profN, t60N, t65N] = s.names as [string, string, string, string, string];
  const soul = file("config/SOUL.md", "SOUL.md", soulN);
  const org = file("config/ORGANIZATION.md", "ORGANIZATION.md", orgN);
  const profile = file("config/PROFILE.md", "PROFILE.md", profN);
  const t60 = file("artifacts/core/rules/60-tools.md", "artifacts/core/rules/60-tools.md", t60N);
  const t65 = file("config/TOOLS.md", "TOOLS.md", t65N);
  const store: RuleFile = {
    src: "artifacts/core/system-context",
    dest: ".crewrig/system-context",
    label: STORE_LABEL,
  };
  const orgRules: RuleFile[] =
    s.orgRules === undefined
      ? []
      : [
          {
            src: "AGENTS.org.md",
            dest: s.orgRules,
            label: `AGENTS.org.md -> ${s.prefix}${s.orgRules}`,
            optional: true,
          },
        ];
  const copilot = cli === "copilot";
  const shared = copilot
    ? [soul, org, profile, t60, t65, store, ...orgRules]
    : [org, t60, t65, store, ...orgRules, soul];
  const sel = (kind: PickKind, dir: string, short: string, name: string): RuleFile => ({
    src: `config/${dir}`,
    dest: name,
    label: `${short}/{name}.md -> ${s.prefix}${name}`,
  });
  const [levelN, expN, teamN] = s.selNames as [string, string, string];
  const [existingFound, actionHeader, keptMessage, removedMessage] = s.texts as [
    string,
    string,
    string,
    string,
  ];
  return {
    homes: {
      cliHome: s.cliHome,
      rulesDir: s.rulesDir,
      skillsDir: `${s.cliHome}/skills`,
    },
    rules: {
      existingGlob: GLOBS[cli],
      texts: { existingFound, actionHeader, keptMessage, removedMessage },
      sharedHeader: copilot
        ? "Installing shared layered context to {dir} ..."
        : "Installing shared configuration...",
      shared,
      store,
      pickOrder: copilot ? ["level", "expertise", "team"] : ["team", "expertise", "level"],
      selections: {
        team: sel("team", "teams", "teams", teamN),
        expertise: sel("expertise", "expertise", "expertise", expN),
        level: sel("level", "level", "level", levelN),
      },
      profile: { mode: copilot ? "direct" : "method", file: profile },
      ...(copilot ? { mkdirInExisting: true } : {}),
    },
  };
}

export function rulesDescriptor(cli: Cli, steps: readonly StepId[]): SetupDescriptor {
  return { ...descriptor(steps, cli), ...rulesData(cli) };
}

export const box = { root: "", home: "", repo: "" };

/** A temporary home and a repository whose `config/` is a private copy and `artifacts/` a link. */
export function useRulesSandbox(): void {
  beforeEach(() => {
    box.root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-rules-"));
    box.home = path.join(box.root, "home");
    box.repo = path.join(box.root, "repo");
    fs.mkdirSync(box.home);
    fs.mkdirSync(box.repo);
    fs.cpSync(path.join(REAL, "config"), path.join(box.repo, "config"), { recursive: true });
    fs.symlinkSync(path.join(REAL, "artifacts"), path.join(box.repo, "artifacts"));
    // User-generated files (not tracked): the golden harness seeds them too.
    for (const name of ["SOUL.md", "PROFILE.md", "ORGANIZATION.md", "TOOLS.md"]) {
      const file = path.join(box.repo, "config", name);
      if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${name}\n`);
    }
  });
  afterEach(() => fs.rmSync(box.root, { recursive: true, force: true }));
}

export interface RulesRun {
  readonly status: number;
  readonly out: string;
  readonly err: string;
}

export async function runRules(
  d: SetupDescriptor,
  answers: readonly string[] = [],
  stdin = "",
): Promise<RulesRun> {
  const input = new PassThrough();
  input.end(stdin);
  const out: string[] = [];
  const err: string[] = [];
  const status = await runSetup(d, {
    argv: answers.flatMap((a) => ["--answer", a]),
    stdin: input,
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    env: { HOME: box.home },
    platform: process.platform,
    home: box.home,
    repoDir: box.repo,
  });
  return { status, out: out.join(""), err: err.join("") };
}

export const VALIDATION = [
  "validation.backend=internal",
  "validation.translate=off",
  "validation.pedagogy=contextual",
  "validation.illustration=off",
];
export const PICKS = [
  "catalogue.team=ATLAS",
  "catalogue.expertise=BACKEND-JAVA",
  "catalogue.level=CONFIRMED",
];

/** The stdout with the prompter's `[answer] ...` echo lines removed and the sandbox paths normalized. */
export function normalized(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("[answer] "))
    .join("\n")
    .replaceAll(box.home, "<HOME>")
    .replaceAll(box.repo, "<REPO>");
}

export function golden(cli: Cli, cell: string): string {
  return fs.readFileSync(path.join(GOLDEN, cli, cell, "stdout.golden"), "utf8");
}

/** The paths of the golden tree that a rules step writes (rules dir files, markers, store, conf). */
export function goldenRulesPaths(cli: Cli, cell: string): string[] {
  const text = fs.readFileSync(path.join(GOLDEN, cli, cell, "tree.json.golden"), "utf8");
  const tree = (JSON.parse(text) as { tree: { path: string; kind: string }[] }).tree;
  return tree.map((e) => e.path).filter((p) => isRulesPath(cli, p));
}

function isRulesPath(cli: Cli, p: string): boolean {
  const s = STYLES[cli];
  if (p.startsWith("<HOME>/.crewrig/system-context") || p === "<HOME>/.crewrig/validation.conf")
    return true;
  const dir = path.posix.dirname(p);
  const base = path.posix.basename(p);
  const inHome = dir === `<HOME>/${s.cliHome}` || dir === `<HOME>/${s.rulesDir}`;
  return inHome && /^(\d\d[-_].*|\.selected_.*|99.*)$/.test(base);
}

/** The same selection over the files the run wrote in the sandbox home, `<HOME>`-relative. */
export function writtenRulesPaths(cli: Cli): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const entry = fs.lstatSync(full);
      found.push(`<HOME>/${path.relative(box.home, full).split(path.sep).join("/")}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(box.home);
  return found.filter((p) => isRulesPath(cli, p));
}

export function seedRule(cli: Cli, name: string): void {
  const dir = path.join(box.home, STYLES[cli].rulesDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), "seeded\n");
}
