// judge.ts — the runner's judge: prompt, call through the shared judge library, answer parsing
// (spec 0290 R12, R13, R15, R33).
//
// One expectation = one `llmJudgeEvidence` call (3-call quorum, `max_calls` cap via `judge.count`,
// mock mode) in the runner's own judge directory `<out>/<skill>/.judge/` holding the
// `effective.json` the runner wrote. Calls are serialised through one queue per skill so the
// counter file is race-free. The evidence of a PASS is taken from the FIRST PASS slot; if it fails
// the evidence rule the expectation is recorded unsupported, the other slots are not searched.
//
// Usage: const j = createJudge({...}); j.fn is a JudgeFn; j.callsUsed() reads the counter.
// Exit codes: not applicable (library). Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import { judgeEvidencePreflight, llmJudgeEvidence } from "../../../tests/e2e/lib/llm_judge.ts";
import type { JudgeDeps } from "../../../tests/e2e/lib/llm_judge.ts";
import { effectiveJson, judgeEnv } from "./credentials.ts";
import type { Credential, JudgeSection } from "./credentials.ts";
import { parseEvidence } from "./evidence.ts";
import { JudgeFailure } from "./grade.ts";
import type { JudgeAnswer, JudgeFn, JudgeMaterial } from "./grade.ts";
import { JUDGE_MAX_TOKENS } from "./settings.ts";

const MAX_TRANSCRIPT = 60_000;
const MAX_FILE = 8_000;
const MAX_FILES_TOTAL = 40_000;

export function buildJudgeMessage(expectation: string, material: JudgeMaterial): string {
  let transcript = material.transcript;
  if (transcript.length > MAX_TRANSCRIPT)
    transcript = `${transcript.slice(0, MAX_TRANSCRIPT / 2)}\n[... transcript truncated ...]\n${transcript.slice(-MAX_TRANSCRIPT / 2)}`;
  let budget = MAX_FILES_TOTAL;
  const files: string[] = [];
  for (const f of material.files) {
    if (budget <= 0) break;
    const body = f.content.slice(0, Math.min(MAX_FILE, budget));
    budget -= body.length;
    files.push(`--- FILE ${f.rel} ---\n${body}`);
  }
  return (
    "You are grading one run of an AI agent against ONE expectation.\n" +
    "Respond with EXACTLY two lines and nothing else:\n\n" +
    "  VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>\n" +
    "  EVIDENCE=<a JSON string>\n\n" +
    "For PASS, EVIDENCE MUST be a verbatim excerpt of at least 12 non-whitespace characters, copied " +
    "exactly from the TRANSCRIPT or from a PRODUCED FILE, or a reference `path:line` naming a produced " +
    "file and an existing line of it. For FAIL or UNCERTAIN, EVIDENCE is a short reason.\n\n" +
    `EXPECTATION:\n${expectation}\n\nTRANSCRIPT:\n${transcript}\n\nPRODUCED FILES:\n${files.length > 0 ? files.join("\n") : "(none)"}`
  );
}

export interface JudgeSetup {
  /** `<out>/<skill>/.judge` (the directory of the effective.json the runner writes). */
  readonly dir: string;
  readonly judge: JudgeSection;
  readonly credential: Credential | undefined;
  readonly maxCalls: number;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly mock: boolean;
  /** Mock mode: the raw judge answer for an expectation (default: PASS quoting the transcript). */
  readonly mockAnswer?: (expectation: string, material: JudgeMaterial) => string;
  readonly fetchImpl?: typeof fetch;
  /** Retry back-off of the judge transport (default: real timers). */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const defaultMockAnswer = (_e: string, m: JudgeMaterial): string => {
  const quote = m.transcript.replace(/\s+/g, " ").trim().slice(0, 40);
  return `VERDICT=PASS CONF=0.90\nEVIDENCE=${JSON.stringify(quote)}`;
};

export interface Judge {
  readonly fn: JudgeFn;
  callsUsed(): number;
  preflight(): Promise<
    | { ok: true }
    | { ok: false; reason: "auth-missing" | "hard-failure"; backend: string; detail: string }
  >;
}

export function createJudge(setup: JudgeSetup): Judge {
  fs.mkdirSync(setup.dir, { recursive: true });
  fs.writeFileSync(
    path.join(setup.dir, "effective.json"),
    effectiveJson({ ...setup.judge, max_tokens: JUDGE_MAX_TOKENS }, setup.maxCalls),
  );
  fs.rmSync(path.join(setup.dir, "judge.count"), { force: true });
  const depsFor = (mockResponse?: string): JudgeDeps => ({
    env: judgeEnv({
      base: setup.baseEnv,
      judge: setup.judge,
      credential: setup.credential,
      reportDir: setup.dir,
      mock: setup.mock,
      ...(mockResponse !== undefined ? { mockResponse } : {}),
    }),
    now: () => Date.now(),
    sleep: setup.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    ...(setup.fetchImpl !== undefined ? { fetch: setup.fetchImpl } : {}),
  });
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const next = queue.then(f, f);
    queue = next.catch(() => undefined);
    return next;
  };
  const fn: JudgeFn = (expectation, material) =>
    serial(async (): Promise<JudgeAnswer> => {
      const mockResponse = setup.mock
        ? (setup.mockAnswer ?? defaultMockAnswer)(expectation, material)
        : undefined;
      const r = await llmJudgeEvidence(
        depsFor(mockResponse),
        buildJudgeMessage(expectation, material),
        { maxTokens: JUDGE_MAX_TOKENS },
      );
      switch (r.kind) {
        case "auth-missing":
          throw new JudgeFailure("auth-missing", `judge backend ${r.backend} has no credentials`);
        case "hard-failure":
          throw new JudgeFailure(
            r.stderr.includes("does not support") ? "unsupported-backend" : "hard-failure",
            `judge backend ${r.backend} failed: ${r.stderr.trim()}`,
          );
        case "cap-exceeded":
          throw new JudgeFailure("cap", `judge max_calls ${r.maxCalls} reached (count ${r.count})`);
        case "verdict": {
          if (r.capped)
            throw new JudgeFailure(
              "cap",
              `judge max_calls ${setup.maxCalls} reached before a verdict`,
            );
          if (r.texts.every((t) => t === undefined))
            throw new JudgeFailure("no-verdict", "the judge returned no verdict after its retries");
          const idx = r.slots.indexOf(r.verdict);
          const text = idx >= 0 ? r.texts[idx] : undefined;
          return {
            verdict: r.verdict,
            evidence: text === undefined ? undefined : parseEvidence(text),
            confidence: r.confidence,
          };
        }
      }
    });
  return {
    fn,
    callsUsed: () => {
      try {
        return Number(fs.readFileSync(path.join(setup.dir, "judge.count"), "utf8").trim()) || 0;
      } catch {
        return 0;
      }
    },
    async preflight() {
      const r = await judgeEvidencePreflight(depsFor(setup.mock ? "" : undefined));
      if (r.kind === "ok") return { ok: true };
      return {
        ok: false,
        reason: r.kind,
        backend: r.backend,
        detail: r.kind === "hard-failure" ? r.stderr.trim() : "no credentials",
      };
    },
  };
}
