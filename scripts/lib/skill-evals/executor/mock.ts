// executor/mock.ts — the scripted mock executor (spec 0290 R24, R25).
//
// Runs no process and makes no model call: a script function decides, per request, which files the
// run "produced" (written into the workspace), its transcript, cost and limit. The default script
// answers deterministically so `--mock` runs are reproducible.
//
// Usage: new MockExecutor(script?).run(request). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import type { ExecOutcome, ExecRequest, Executor, LimitName } from "./types.ts";

export interface MockResult {
  /** Files the run produced, workspace-relative. */
  readonly files?: Record<string, string>;
  readonly transcript?: string;
  /** Measured cost; omit for 0.01, null for unknown. */
  readonly costUsd?: number | null;
  readonly limit?: LimitName;
  readonly failure?: string;
  readonly turns?: number;
  /** Skill names the run "loaded" (reported as skillsLoaded); default none. */
  readonly skillsLoaded?: readonly string[];
  /** Resolve after this many milliseconds (concurrency tests). */
  readonly delayMs?: number;
}

export type MockScript = (req: ExecRequest) => MockResult | Promise<MockResult>;

export const defaultMockScript: MockScript = (req) => ({
  files: { "answer.md": `Mock answer for ${req.label}.\n` },
  transcript: `Assistant: Mock answer for ${req.label}.`,
  costUsd: 0.01,
});

export class MockExecutor implements Executor {
  readonly script: MockScript;
  inFlight = 0;
  maxInFlight = 0;
  readonly calls: ExecRequest[] = [];
  constructor(script: MockScript = defaultMockScript) {
    this.script = script;
  }
  async run(req: ExecRequest): Promise<ExecOutcome> {
    this.calls.push(req);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const r = await this.script(req);
      if (r.delayMs !== undefined)
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, r.delayMs);
          req.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
        });
      if (req.signal.aborted)
        return {
          transcript: "",
          costUsd: null,
          usage: null,
          turns: 0,
          seconds: 0,
          skillsLoaded: [],
          aborted: true,
        };
      for (const [rel, content] of Object.entries(r.files ?? {})) {
        const abs = path.join(req.workspaceDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      }
      const cost = r.costUsd === undefined ? 0.01 : r.costUsd;
      return {
        transcript: r.transcript ?? `Assistant: done (${req.label}).`,
        costUsd: cost,
        usage: cost === null ? null : { input_tokens: 100, output_tokens: 20 },
        turns: r.turns ?? 1,
        seconds: 0,
        skillsLoaded: r.skillsLoaded ?? [],
        ...(r.limit !== undefined ? { limit: r.limit } : {}),
        ...(r.failure !== undefined ? { failure: r.failure } : {}),
      };
    } finally {
      this.inFlight--;
    }
  }
}
