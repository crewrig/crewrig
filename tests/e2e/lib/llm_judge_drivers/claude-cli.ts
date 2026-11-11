// tests/e2e/lib/llm_judge_drivers/claude-cli.ts — evidence-mode judge driver that makes its model
// call through headless `claude -p` (spec 0290 R15, R33).
//
// It provides `complete()` only (no verdict-only `call`), so `driverFor` and `llmJudge` never
// resolve it. The call uses the same binary and authentication as the skill-evals executor: the
// subscription token (`CLAUDE_CODE_OAUTH_TOKEN`) goes to the `claude` child through its environment
// and is never sent to the Messages API by this code, never put on argv and never logged.
//
// The judge prompt goes to the child on stdin. The child runs with no tools, no session
// persistence, no slash commands, an empty temporary working directory and a throwaway
// HOME/CLAUDE_CONFIG_DIR; its environment is an allowlist plus that one credential. The binary is
// `claude`, or the path in SKILL_EVALS_CLAUDE_BIN (a test seam). `--max-turns` is deliberately not
// passed: with no tools a single turn is inherent and the flag is absent from `claude --help`.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Ctx, Driver, Preflight } from "../llm_judge.ts";

export const TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const TIMEOUT_MS = 120_000;

async function preflight(ctx: Ctx): Promise<Preflight> {
  if (ctx.mock) return { rc: 0, token: "mock" };
  const token = ctx.deps.env[TOKEN_ENV] ?? "";
  return token === "" ? { rc: 2 } : { rc: 0, token };
}

function childEnv(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  token: string,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude") };
  for (const k of ["PATH", "LANG", "LC_ALL", "TMPDIR"]) {
    const v = env[k];
    if (v !== undefined) out[k] = v;
  }
  out[TOKEN_ENV] = token;
  return out;
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

async function complete(
  ctx: Ctx,
  token: string,
  message: string,
  _maxTokens: number,
): Promise<string | undefined> {
  if (ctx.mock) return ctx.deps.env["E2E_JUDGE_MOCK_RESPONSE"] ?? "";
  const binary = ctx.deps.env["SKILL_EVALS_CLAUDE_BIN"] || "claude";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-judge-"));
  try {
    const home = path.join(root, "home");
    const cwd = path.join(root, "cwd");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    const args = [
      "-p",
      "--output-format",
      "text",
      "--model",
      ctx.cfg.model,
      "--tools",
      "",
      "--no-session-persistence",
      "--disable-slash-commands",
    ];
    const res = await runClaude(binary, args, childEnv(ctx.deps.env, home, token), cwd, message);
    if (res.code !== 0 || res.stdout.trim() === "") return undefined;
    return res.stdout;
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
