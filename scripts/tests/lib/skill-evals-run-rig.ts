// skill-evals-run-rig.ts — a mock-mode run of the skill eval runner over a fixture repository.
//
// `mockRun` builds a repo whose skill `demo` changed against `origin/main`, runs `runEvals` with a
// scripted mock executor and a scripted mock judge answer, and returns the report, the output
// directory and the repo. No model call: no credential variable, a throwing `fetch`.

import fs from "node:fs";
import path from "node:path";

import { MockExecutor } from "../../lib/skill-evals/executor/mock.ts";
import type { MockScript } from "../../lib/skill-evals/executor/mock.ts";
import { runEvals } from "../../lib/skill-evals/run.ts";
import type { RunOptions, RunReport, RunSettings } from "../../lib/skill-evals/run.ts";
import { cleanEnv, commitAll, makeRepo, markOrigin, selectionOf, skillRel, throwingFetch, tmpDir, writeSkill } from "./skill-evals-fixtures.ts";
import type { Repo } from "./skill-evals-fixtures.ts";

export interface Rig {
  readonly repo: Repo;
  readonly out: string;
  readonly executor: MockExecutor;
  run(over?: Partial<RunOptions>, names?: string[]): Promise<RunReport>;
  cleanup(): void;
}

export interface RigOptions {
  /** Edit applied to the skill after `origin/main` (default: SKILL.md only). */
  readonly change?: (repo: Repo) => void;
  readonly script?: MockScript;
  readonly evalsCount?: number;
  readonly skills?: string[];
  readonly newSkill?: boolean;
  readonly mock?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly settings?: Partial<RunSettings>;
}

export function evalsWith(name: string, count: number, expectations = 1): string {
  const evals = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    prompt: `Task ${i + 1}: do the thing described in in.txt.`,
    expected_output: "An answer file.",
    files: ["evals/files/in.txt"],
    expectations: Array.from({ length: expectations }, (_, j) => `Expectation ${j + 1} holds`),
    checks: [{ type: "file_exists", path: "answer.md" }],
  }));
  return `${JSON.stringify({ skill_name: name, evals, trigger_probes: [{ query: "q", should_trigger: true }] }, null, 2)}\n`;
}

export function makeRig(opts: RigOptions = {}): Rig {
  const repo = makeRepo();
  const skills = opts.skills ?? ["demo"];
  for (const s of skills) writeSkill(repo, s, { "evals/evals.json": evalsWith(s, opts.evalsCount ?? 1) });
  commitAll(repo, "base");
  markOrigin(repo);
  if (opts.newSkill === true) for (const s of skills) writeSkill(repo, `${s}-new`, { "evals/evals.json": evalsWith(`${s}-new`, opts.evalsCount ?? 1) });
  for (const s of skills) {
    if (opts.change !== undefined) opts.change(repo);
    else fs.appendFileSync(path.join(repo.root, skillRel(s), "SKILL.md"), "edit\n");
  }
  commitAll(repo, "change");
  const out = tmpDir();
  const executor = new MockExecutor(opts.script);
  return {
    repo,
    out,
    executor,
    run: (over = {}, names = skills) =>
      runEvals(
        {
          repoRoot: repo.root,
          out,
          mock: opts.mock ?? true,
          env: cleanEnv(opts.env as Record<string, string>),
          fetchImpl: throwingFetch,
          sleep: async () => undefined,
          ticket: "1849",
          declare: () => ({ ok: true }),
          executor,
          ...(opts.settings !== undefined ? { settings: opts.settings } : {}),
          ...over,
        },
        names.map((n) => selectionOf(repo, n)),
      ),
    cleanup: () => {
      repo.cleanup();
      fs.rmSync(out, { recursive: true, force: true });
    },
  };
}

/** `n` evals with one expectation each and no check (each run scores 0 or 1). */
export function plainEvals(name: string, n: number): string {
  const evals = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    prompt: `Task ${i + 1}`,
    expected_output: "An answer.",
    files: [],
    expectations: ["The answer is good"],
  }));
  return `${JSON.stringify({ skill_name: name, evals }, null, 2)}\n`;
}

/** A recording Messages API endpoint: PASS quoting the fixed phrase unless the message holds `failMarker`. */
export function judgeFetch(failMarker = "BROKEN"): { fetch: typeof fetch; requests: { url: string; headers: Record<string, string>; message: string }[] } {
  const requests: { url: string; headers: Record<string, string>; message: string }[] = [];
  const f = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const message = (JSON.parse(init.body) as { messages: { content: string }[] }).messages[0]?.content ?? "";
    requests.push({ url, headers: init.headers, message });
    const text = message.includes(failMarker) ? `VERDICT=FAIL CONF=0.90\nEVIDENCE="not good"` : `VERDICT=PASS CONF=0.90\nEVIDENCE="the quick brown fox"`;
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, requests };
}
