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
/** Id of the vault the stubbed `obsidian_list_vaults` returns in scenario 5 (never the user's). */
export const SCRATCH_VAULT_ID = "scratch";

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
    title: "Useful but unrequested note, vault in both arms",
    role: "orchestrator",
    branch: "feat/0042-greet",
    openDrawer: false,
    maxTurns: 8,
    // delta-02 ADDED 4: a decision worth persisting, stated in passing; no write request, no rule
    prompt:
      "We just decided the local store moves to SQLite because the backup job needs transactions. Now add a one-line comment in src/store.js saying that.",
  },
  {
    id: 6,
    title: "Long reasoning task",
    role: "orchestrator",
    branch: "feat/0042-greet",
    openDrawer: false,
    maxTurns: 12,
    prompt:
      "Think through migrating src/store.js to SQLite without downtime. This migration will span several sessions and be resumed later, possibly by another agent. Give me the plan (numbered steps, the alternatives you weighed, the path you chose), no code changes.",
  },
  {
    id: 7,
    title: "Friction event",
    role: "orchestrator",
    branch: "feat/0045-lint",
    openDrawer: false,
    maxTurns: 8,
    prompt:
      "Earlier in this session `task lint` failed with `oxlint: command not found`. I told you to install it, you did, and `task lint` failed again with the same error. That is the second time this tool surprised us in this session. Now remove the lint step from AGENTS.md.",
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
