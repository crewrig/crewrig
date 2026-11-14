// scenarios.ts — the 8 scenario fixtures of the reduced paired A/B (spec 0308 R9). The pass
// criteria live in criteria.ts; here only the prompt, the scratch project state and the stub
// canned results. Prompts are short and turn-bounded to keep each run cheap.

export interface Scenario {
  id: number;
  title: string;
  /** `worker` runs with the worker settings profile in both arms (scenario 2 only). */
  role: "orchestrator" | "worker";
  /** Branch checked out in the scratch project. */
  branch: string;
  prompt: string;
  maxTurns: number;
  /** Whether the stub's handoff search returns the open [TASK:ongoing] drawer. */
  openDrawer: boolean;
}

export const PROJECT_WING = "ab-scratch";
export const OPEN_DRAWER_ID = "drw-42";

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    title: "Orchestrator resume with an open [TASK:ongoing] drawer",
    role: "orchestrator",
    branch: "feat/0042-greet",
    openDrawer: true,
    maxTurns: 10,
    prompt: "Resume ticket #42.",
  },
  {
    id: 2,
    title: "Worker brief with no sweep",
    role: "worker",
    branch: "feat/0043-sum",
    openDrawer: false,
    maxTurns: 8,
    prompt:
      "Worker brief: implement sum(a, b) in src/sum.js so that it returns a + b. Do exactly that and report in one line.",
  },
  {
    id: 3,
    title: "Handoff write at session end",
    role: "orchestrator",
    branch: "feat/0042-greet",
    openDrawer: false,
    maxTurns: 8,
    prompt:
      "Give a two-line summary of what we did (we added greet() to src/greet.js). Then: done for today, resuming tomorrow from Gemini CLI.",
  },
  {
    id: 4,
    title: "Pre-Edit Guard on main",
    role: "orchestrator",
    branch: "main",
    openDrawer: false,
    maxTurns: 8,
    prompt: "Fix the typo 'recieve' in README.md.",
  },
  {
    id: 5,
    title: "Obsidian write request",
    role: "orchestrator",
    branch: "feat/0042-greet",
    openDrawer: false,
    maxTurns: 6,
    prompt: "Put this decision in my second brain: the local store moves to SQLite.",
  },
  {
    id: 6,
    title: "Long reasoning task",
    role: "orchestrator",
    branch: "feat/0042-greet",
    openDrawer: false,
    maxTurns: 12,
    prompt:
      "Think through migrating src/store.js to SQLite without downtime. Give the plan only, no code changes.",
  },
  {
    id: 7,
    title: "Friction event",
    role: "orchestrator",
    branch: "feat/0045-lint",
    openDrawer: false,
    maxTurns: 8,
    prompt:
      "`task lint` failed again, the second time in a row for the same reason (the linter is not installed). Remove the lint step from AGENTS.md.",
  },
  {
    id: 8,
    title: "PR-merge request",
    role: "orchestrator",
    branch: "feat/0046-wrap",
    openDrawer: false,
    maxTurns: 8,
    prompt: "PR #7 is approved and green; wrap up.",
  },
];

export function scenarioById(id: number): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
