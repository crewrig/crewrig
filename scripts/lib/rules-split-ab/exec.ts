// exec.ts — the real executor: one scratch HOME and project per run, one `claude -p` child
// (spec 0308 R10). This is the only module that spawns a paid model call; the runner is manual
// and is never wired into CI, ci:pre-push or a hook.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { ExecuteFn } from "./orchestrate.ts";
import type { AuthHome } from "./scratch.ts";
import { buildClaudeArgs, buildEnv, createScratch, removeScratch } from "./scratch.ts";
import { parseTranscript } from "./transcript.ts";

export interface ExecutorOptions {
  armRules: { A: string[]; B: string[] };
  model: string;
  workerSettings?: string;
  /** Directory receiving each run's transcript and call log. */
  outDir: string;
  skillDirs?: string[];
  claudeBin?: string;
  keepScratch?: boolean;
  /** `auto` (default): scratch HOME first, the real-HOME mode once an auth check fails. */
  authHome?: "auto" | "scratch" | "real";
  realHome?: string;
  timeoutMs?: number;
}

export class AuthError extends Error {}

export function makeClaudeExecutor(o: ExecutorOptions): ExecuteFn {
  fs.mkdirSync(path.join(o.outDir, "runs"), { recursive: true });
  let mode: AuthHome = o.authHome === "real" ? "real" : "scratch";
  const runOnce = async (req: Parameters<ExecuteFn>[0], authHome: AuthHome) => {
    const scratch = createScratch({
      ruleFiles: o.armRules[req.arm],
      scenario: req.scenario,
      skillDirs: o.skillDirs,
      authHome,
      realHome: o.realHome,
      workerSettings: o.workerSettings,
    });
    try {
      const args = buildClaudeArgs({
        scratch,
        scenario: req.scenario,
        model: o.model,
        maxBudgetUsd: Number(req.maxBudgetUsd.toFixed(4)),
        workerSettings: o.workerSettings,
      });
      const stdout = await new Promise<string>((resolve) => {
        const child = spawn(o.claudeBin ?? "claude", args, {
          cwd: scratch.proj,
          env: buildEnv(scratch, process.env),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        child.stdout.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr.on("data", () => {});
        const timer = setTimeout(() => child.kill("SIGKILL"), o.timeoutMs ?? 600_000);
        child.on("close", () => {
          clearTimeout(timer);
          resolve(out);
        });
        child.on("error", () => {
          clearTimeout(timer);
          resolve(out);
        });
      });
      const callLog = fs.existsSync(scratch.callLog)
        ? fs.readFileSync(scratch.callLog, "utf8")
        : null;
      const tag = `s${req.scenario.id}-${req.arm}${req.runIndex}-try${req.attempt}`;
      fs.writeFileSync(path.join(o.outDir, "runs", `${tag}.transcript.jsonl`), stdout);
      if (callLog !== null)
        fs.writeFileSync(path.join(o.outDir, "runs", `${tag}.calls.jsonl`), callLog);
      const t = parseTranscript(stdout);
      if (
        t.result?.isError &&
        /not logged in|please run \/login|api key|authenticat/i.test(t.result.text)
      ) {
        throw new AuthError(
          `claude is not authenticated (${authHome} HOME mode): ${t.result.text.slice(0, 200)}`,
        );
      }
      return { transcript: stdout === "" ? null : stdout, callLog };
    } finally {
      if (!o.keepScratch) removeScratch(scratch);
    }
  };
  return async (req) => {
    try {
      return await runOnce(req, mode);
    } catch (e) {
      if (!(e instanceof AuthError) || mode === "real" || (o.authHome ?? "auto") !== "auto")
        throw e;
      // the login lives in the keychain, unreachable under a scratch HOME: switch for the rest of the run
      mode = "real";
      return runOnce(req, mode);
    }
  };
}
