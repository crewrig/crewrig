// tests/e2e/lib/llm_judge_drivers/claude-cli.ts — evidence-mode judge driver that makes its model
// call through headless `claude -p` (spec 0290 R15, R33).
//
// It provides `complete()` only (no verdict-only `call`), so `driverFor` and `llmJudge` never
// resolve it. The call uses the same binary and authentication as the skill-evals executor: the
// subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) goes to the `claude` child through its environment
// and is never sent to the Messages API by this code, never put on argv and never logged.
//
// The judge prompt goes to the child on stdin. The child runs with no tools, no slash commands,
// the isolation flags of scripts/lib/skill-evals/claude-child.ts (`--setting-sources project`,
// `--strict-mcp-config`, `--no-session-persistence`), the contributor's real HOME and an empty
// temporary working directory under os.tmpdir(); its environment is the R42 allowlist plus, only
// when the token is in the driver's environment, that one credential. Without a token the driver's
// preflight is the login probe (`claude auth status --json`, memoised, no model call). The binary
// is `claude`, or the path in SKILL_EVALS_CLAUDE_BIN (a test seam). `--max-turns` is deliberately
// not passed: with no tools a single turn is inherent and the flag is absent from `claude --help`.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  childEnv,
  ISOLATION_FLAGS,
  probeLogin,
} from "../../../../scripts/lib/skill-evals/claude-child.ts";
import type { Ctx, Driver, EvidenceCompletion, Preflight } from "../llm_judge.ts";

export const TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const TIMEOUT_MS = 120_000;

async function preflight(ctx: Ctx): Promise<Preflight> {
  if (ctx.mock) return { rc: 0, token: "mock" };
  const token = ctx.deps.env[TOKEN_ENV] ?? "";
  if (token !== "") return { rc: 0, token };
  const state = await probeLogin(ctx.deps.env, { tempRoot: os.tmpdir() });
  return state === "logged-in" ? { rc: 0, token: "" } : { rc: 2 };
}

/** The argv of one judge call: no tools, no slash commands, plus the isolation flags. */
export function buildJudgeArgs(model: string, effort = ""): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--disable-slash-commands",
    ...(effort === "" ? [] : ["--effort", effort]),
    ...ISOLATION_FLAGS,
  ];
}

function runClaude(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  input: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const child = spawn(binary, args, { cwd, env, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(null);
    }, TIMEOUT_MS);
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
    child.stdout.on("data", (d: Buffer) => void (stdout += d.toString("utf8")));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/**
 * The result record of `--output-format json` (`result`, `is_error`, `total_cost_usd`), or the whole
 * output as text when it is not such a record (spec 0304 R23): JSON output is never empty, so the
 * retry rule of spec 0290 R15 tests the parsed `result`.
 */
export function parseCliOutput(stdout: string): {
  text: string;
  isError: boolean;
  costUsd: number | undefined;
} {
  try {
    const doc: unknown = JSON.parse(stdout);
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) {
      const o = doc as Record<string, unknown>;
      if (typeof o["result"] === "string") {
        const cost = o["total_cost_usd"];
        return {
          text: o["result"],
          isError: o["is_error"] === true,
          costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : undefined,
        };
      }
      if (o["is_error"] === true) return { text: "", isError: true, costUsd: undefined };
    }
  } catch {
    // plain text: the whole output is the answer
  }
  return { text: stdout, isError: false, costUsd: undefined };
}

async function complete(
  ctx: Ctx,
  token: string,
  message: string,
  _maxTokens: number,
): Promise<EvidenceCompletion | undefined> {
  if (ctx.mock) return { text: ctx.deps.env["E2E_JUDGE_MOCK_RESPONSE"] ?? "" };
  const binary = ctx.deps.env["SKILL_EVALS_CLAUDE_BIN"] || "claude";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-judge-"));
  try {
    const cwd = path.join(root, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const env = childEnv(
      ctx.deps.env,
      token === "" ? undefined : { name: TOKEN_ENV, value: token },
    );
    const args = buildJudgeArgs(ctx.cfg.model, ctx.cfg.effort);
    // One retry on a non-zero exit, a timeout, an error result or an empty answer (spec 0290 R15).
    // It is a call of its own: refused when the cap is reached, counted in `judge.count` otherwise,
    // and its cost is added to the first attempt's.
    let cost: number | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        if (ctx.count() >= ctx.cfg.maxCalls) return undefined;
        ctx.bump();
      }
      const res = await runClaude(binary, args, env, cwd, message);
      const out = parseCliOutput(res.stdout);
      if (out.costUsd !== undefined) cost = (cost ?? 0) + out.costUsd;
      if (res.code === 0 && !out.isError && out.text.trim() !== "")
        return { text: out.text, ...(cost !== undefined ? { costUsd: cost } : {}) };
    }
    return undefined;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const claudeCliDriver: Driver = {
  preflight,
  // Never reached: `claude-cli` is resolved by `evidenceDriverFor` only, which calls `complete`.
  call: async () => undefined,
  complete,
};
