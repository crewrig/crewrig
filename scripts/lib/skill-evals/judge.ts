// judge.ts — the runner's judge: prompt, call through the shared judge library, answer parsing
// (spec 0290 R12, R13, R15, R33).
//
// One eval = ONE `llmJudgeEvidence` call (one `max_calls` count, mock mode) in the runner's own
// judge directory `<out>/<skill>/.judge/` holding the `effective.json` the runner wrote. The prompt
// numbers the eval's expectations and asks for one line per expectation:
// `<n> VERDICT=<word> EVIDENCE=<JSON string>`. Calls are serialised through one queue per skill so
// the counter file is race-free. Only PASS can pass (grade.ts checks its evidence); any other word
// is a failed expectation, and a missing index is a failed "no verdict".
//
// Usage: const j = createJudge({...}); j.fn is a JudgeFn; j.callsUsed() reads the counter; j.costUsd()
// the cost the driver reported (spec 0304 R23).
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
import { EFFORT, JUDGE_MAX_TOKENS } from "./settings.ts";

const MAX_TRANSCRIPT = 60_000;
const MAX_FILE = 8_000;
const MAX_FILES_TOTAL = 40_000;

export function buildJudgeMessage(
  expectations: readonly string[],
  material: JudgeMaterial,
  /** Re-ask (0304 R17): why each expectation's earlier PASS was refused, parallel to `expectations`. */
  reasons?: readonly string[],
): string {
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
    "You are grading one run of an AI agent against a numbered list of EXPECTATIONS.\n" +
    "Respond with exactly one line per expectation and nothing else:\n\n" +
    "  <n> VERDICT=<PASS|FAIL> EVIDENCE=<a JSON string>\n\n" +
    "where <n> is the expectation's number. For PASS, EVIDENCE MUST be a verbatim excerpt of at least " +
    "12 non-whitespace characters, copied exactly from the TRANSCRIPT or from a PRODUCED FILE, or a " +
    "reference `path:line` naming a produced file and an existing line of it (a remark may follow it), " +
    "or a whole line of one produced file of 6 to 11 non-whitespace characters. For FAIL, EVIDENCE is " +
    "a short reason.\n\n" +
    (reasons === undefined
      ? ""
      : "Your earlier answer for the expectations below was refused for lack of supported evidence. " +
        "Answer again, quoting evidence that is valid, or FAIL. Reasons, by number:\n" +
        `${reasons.map((r, i) => `  (${i + 1}) ${r}`).join("\n")}\n\n`) +
    `EXPECTATIONS:\n${expectations.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\n` +
    `TRANSCRIPT:\n${transcript}\n\nPRODUCED FILES:\n${files.length > 0 ? files.join("\n") : "(none)"}`
  );
}

// The index prefix of an entry line; what follows is searched for the structured fields.
const INDEX_RE = /^\s*(?:[-*+>]\s*)*[*_`]*(?:#|\[)?(\d+)[\]\.):]?[*_`]*(?![\w])/;
const EVIDENCE_AT = /[*_`]*EVIDENCE[*_`]*\s*[=:]/i;
const VERDICT_FIELD = /\bVERDICT[*_`]*\s*[=:][\s*_`]*([A-Za-z]+)/i;
const VERDICT_WORD = /^(?:PASS|FAIL|UNCERTAIN)$/i;

/**
 * The verdict word of the structured `VERDICT=<word>` field of an entry line, never a `Verdict:`
 * quoted inside the EVIDENCE string (#1914): the field is looked for before `EVIDENCE=`, then after
 * the closing quote of a quoted evidence literal. Only PASS, FAIL and UNCERTAIN are verdict words.
 */
function verdictField(rest: string): string | undefined {
  const at = rest.search(EVIDENCE_AT);
  const regions = [at < 0 ? rest : rest.slice(0, at)];
  if (at >= 0) {
    const tail = rest.slice(at).replace(EVIDENCE_AT, "");
    const lit = /^\s*"(?:[^"\\]|\\.)*"/.exec(tail);
    if (lit !== null) regions.push(tail.slice(lit[0].length));
  }
  for (const r of regions) {
    const w = VERDICT_FIELD.exec(r)?.[1];
    if (w !== undefined && VERDICT_WORD.test(w)) return w;
  }
  return undefined;
}

// Bare form: `<index> <word>` with no `VERDICT=`; the word is a verdict only when it is
// PASS/FAIL/UNCERTAIN, or any word that is followed by `EVIDENCE` (so prose is never an entry).
const BARE_RE =
  /^\s*(?:[-*+>]\s*)*[*_`]*(?:#|\[)?(\d+)[\]\.):]?[*_`]*\s+[*_`]*([A-Za-z]+)[*_`]*(?:(\s+[*_`]*EVIDENCE\b)|\s*$)/i;

/**
 * Parse the judge's answer into one entry per expectation (undefined for a missing index). A line
 * is an entry when it starts with an index (`1`, `1.`, `1)`, `1:`, `#1`, `[1]`, optionally after a
 * list marker or inside bold/backticks); `VERDICT=` or `VERDICT:` (any case) is read from the structured field, never from inside the
 * EVIDENCE string (#1914), and `EVIDENCE=` is found anywhere on it; a bare `<index> PASS|FAIL|UNCERTAIN|<word> EVIDENCE` is accepted too. The first line wins on a repeated index; an index outside 1..n is ignored.
 * Fenced code blocks need no special handling: the fence lines carry no index.
 */
export function parseJudgeAnswer(text: string, n: number): (JudgeAnswer | undefined)[] {
  const out: (JudgeAnswer | undefined)[] = Array.from({ length: n }, () => undefined);
  for (const line of text.split(/\r?\n/)) {
    const idx = INDEX_RE.exec(line);
    let word = idx === null ? undefined : verdictField(line.slice(idx[0].length));
    let num = idx?.[1];
    if (word === undefined) {
      const b = BARE_RE.exec(line);
      if (b !== null && (b[3] !== undefined || VERDICT_WORD.test(b[2] ?? ""))) {
        word = b[2];
        num = b[1];
      }
    }
    if (word === undefined || num === undefined) continue;
    const i = Number(num) - 1;
    if (i < 0 || i >= n || out[i] !== undefined) continue;
    const at = line.search(EVIDENCE_AT);
    out[i] = {
      verdict: word.toUpperCase(),
      evidence: at < 0 ? undefined : parseEvidence(line.slice(at)),
    };
  }
  return out;
}

export interface JudgeSetup {
  /** `<out>/<skill>/.judge` (the directory of the effective.json the runner writes). */
  readonly dir: string;
  readonly judge: JudgeSection;
  readonly credential: Credential | undefined;
  readonly maxCalls: number;
  /** The `--effort` level of the claude-cli judge call (R47); default the declared `EFFORT` setting. */
  readonly effort?: string;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly mock: boolean;
  /** Mock mode: the raw judge answer for the eval's expectations (default: PASS quoting the transcript). */
  readonly mockAnswer?: (expectations: readonly string[], material: JudgeMaterial) => string;
  readonly fetchImpl?: typeof fetch;
  /** Retry back-off of the judge transport (default: real timers). */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const defaultMockAnswer = (e: readonly string[], m: JudgeMaterial): string => {
  const quote = JSON.stringify(m.transcript.replace(/\s+/g, " ").trim().slice(0, 40));
  return e.map((_, i) => `${i + 1} VERDICT=PASS EVIDENCE=${quote}`).join("\n");
};

export interface Judge {
  readonly fn: JudgeFn;
  callsUsed(): number;
  /** R23: the summed cost the driver reported for the calls of this judge; null when none reported one. */
  costUsd(): number | null;
  preflight(): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: "auth-missing" | "hard-failure";
        backend: string;
        detail: string;
      }
  >;
}

function writeRaw(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function createJudge(setup: JudgeSetup): Judge {
  fs.mkdirSync(setup.dir, { recursive: true });
  fs.writeFileSync(
    path.join(setup.dir, "effective.json"),
    effectiveJson(
      {
        ...setup.judge,
        max_tokens: JUDGE_MAX_TOKENS,
        effort: setup.effort ?? EFFORT,
      },
      setup.maxCalls,
    ),
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
  let reported: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const next = queue.then(f, f);
    queue = next.catch(() => undefined);
    return next;
  };
  const fn: JudgeFn = (expectations, material, opts) =>
    serial(async () => {
      const mockResponse = setup.mock
        ? (setup.mockAnswer ?? defaultMockAnswer)(expectations, material)
        : undefined;
      const r = await llmJudgeEvidence(
        depsFor(mockResponse),
        buildJudgeMessage(expectations, material, opts?.reasons),
        { maxTokens: JUDGE_MAX_TOKENS * expectations.length },
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
        case "answer": {
          if (r.costUsd !== undefined) reported = (reported ?? 0) + r.costUsd;
          if (opts?.rawFile !== undefined) writeRaw(opts.rawFile, r.text);
          const entries = parseJudgeAnswer(r.text, expectations.length);
          if (entries.every((e) => e === undefined))
            throw new JudgeFailure("no-verdict", "the judge returned no parseable verdict line");
          return entries;
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
    costUsd: () => reported,
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
