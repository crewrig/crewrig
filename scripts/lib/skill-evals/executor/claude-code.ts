// executor/claude-code.ts — the headless Claude Code executor (spec 0290 R9, R26, R27, R30, R33).
//
// One run = one `claude -p --output-format stream-json` child in its own process group, with a
// throwaway HOME and CLAUDE_CONFIG_DIR (the skill, when any, is already installed into
// `<home>/.claude/skills/<name>/` by the caller), the workspace as working directory, stdin
// ignored and an allowlisted environment: PATH, HOME, CLAUDE_CONFIG_DIR, LANG, LC_ALL, TMPDIR plus
// exactly ONE credential variable. The credential is never put on argv, in a file or in the
// transcript (it is scrubbed). Limits: the turn limit is counted from the stream (assistant
// events) and the child is killed on the first turn past it; the wall clock kills the process
// group (SIGTERM, then SIGKILL); the per-run budget is `--max-budget-usd`. A limit hit returns
// `limit` and is not a failure. Unix only (process groups).
//
// Binary: `claude`, or the path in SKILL_EVALS_CLAUDE_BIN (a test seam, not a documented knob).
// Usage: new ClaudeCodeExecutor().run(request). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import { spawn } from "node:child_process";

import { EXECUTOR_TOOLS } from "../settings.ts";
import type { ExecOutcome, ExecRequest, Executor, LimitName, TokenUsage } from "./types.ts";

const GRACE_MS = 5000;

function scrub(text: string, secret: string | undefined): string {
  return secret === undefined || secret === "" ? text : text.replaceAll(secret, "[redacted]");
}

export function buildArgs(req: ExecRequest): string[] {
  return [
    "-p",
    req.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--model",
    req.model,
    "--tools",
    EXECUTOR_TOOLS.join(","),
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    EXECUTOR_TOOLS.join(" "),
    "--max-turns",
    String(req.limits.turns),
    "--max-budget-usd",
    String(req.limits.usd),
  ];
}

export function buildEnv(req: ExecRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: req.homeDir, CLAUDE_CONFIG_DIR: `${req.homeDir}/.claude` };
  for (const k of ["PATH", "LANG", "LC_ALL", "TMPDIR"]) {
    const v = req.baseEnv[k];
    if (v !== undefined) env[k] = v;
  }
  if (req.credential !== undefined) env[req.credential.name] = req.credential.value;
  return env;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: TokenUsage;
  num_turns?: number;
  message?: { content?: unknown };
  result?: unknown;
}

function renderEvent(ev: StreamEvent): string {
  if (ev.type === "assistant" || ev.type === "user") {
    const content = ev.message?.content;
    const parts = Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
    const lines: string[] = [];
    for (const p of parts) {
      if (p["type"] === "text")
        lines.push(`${ev.type === "assistant" ? "Assistant" : "User"}: ${String(p["text"])}`);
      else if (p["type"] === "tool_use")
        lines.push(`Tool call ${String(p["name"])}: ${JSON.stringify(p["input"])}`);
      else if (p["type"] === "tool_result")
        lines.push(
          `Tool result: ${typeof p["content"] === "string" ? p["content"] : JSON.stringify(p["content"])}`,
        );
    }
    if (typeof content === "string")
      lines.push(`${ev.type === "assistant" ? "Assistant" : "User"}: ${content}`);
    return lines.join("\n");
  }
  if (ev.type === "result")
    return `Result (${String(ev.subtype)}): ${typeof ev.result === "string" ? ev.result : ""}`;
  return "";
}

export class ClaudeCodeExecutor implements Executor {
  run(req: ExecRequest): Promise<ExecOutcome> {
    const started = Date.now();
    const binary = req.baseEnv["SKILL_EVALS_CLAUDE_BIN"] || "claude";
    const secret = req.credential?.value;
    return new Promise((resolve) => {
      if (process.platform === "win32") {
        resolve({
          transcript: "",
          costUsd: null,
          usage: null,
          turns: 0,
          seconds: 0,
          failure: "the executor needs process groups and is not supported on Windows",
        });
        return;
      }
      let buffer = "";
      let transcript = `# Transcript (${req.label})\n\nPrompt: ${req.prompt}\n\n`;
      let turns = 0;
      let result: StreamEvent | undefined;
      let limit: LimitName | undefined;
      let killedBy: "limit" | "abort" | undefined;
      let spawnError: string | undefined;
      let settled = false;

      const child = spawn(binary, buildArgs(req), {
        cwd: req.workspaceDir,
        env: buildEnv(req),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      const killGroup = (sig: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, sig);
        } catch {
          // already gone
        }
      };
      const stop = (why: "limit" | "abort") => {
        if (killedBy !== undefined) return;
        killedBy = why;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), GRACE_MS).unref();
      };
      const timer = setTimeout(() => {
        limit = "wall-clock";
        stop("limit");
      }, req.limits.seconds * 1000);
      const onAbort = () => stop("abort");
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener("abort", onAbort, { once: true });

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.signal.removeEventListener("abort", onAbort);
        killGroup("SIGKILL"); // leave no orphan of the run's process group
        if (buffer.trim() !== "") handleLine(buffer);
        const seconds = (Date.now() - started) / 1000;
        const text = scrub(transcript, secret);
        const resultLimit: LimitName | undefined = result?.subtype?.includes("max_turns")
          ? "turns"
          : result?.subtype?.includes("max_budget")
            ? "budget"
            : undefined;
        const lim = limit ?? resultLimit;
        const cost = typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null;
        const base = {
          transcript: text,
          costUsd: cost,
          usage: result?.usage ?? null,
          turns,
          seconds,
        };
        if (killedBy === "abort") return resolve({ ...base, aborted: true });
        if (spawnError !== undefined) return resolve({ ...base, failure: spawnError });
        if (lim !== undefined) return resolve({ ...base, limit: lim });
        if (result === undefined)
          return resolve({
            ...base,
            failure: `the executor ended without a result record (exit code ${code})`,
          });
        if (result.is_error === true)
          return resolve({
            ...base,
            failure: `the executor reported an error (${String(result.subtype)})`,
          });
        resolve(base);
      };

      const handleLine = (line: string) => {
        let ev: StreamEvent;
        try {
          ev = JSON.parse(line) as StreamEvent;
        } catch {
          return;
        }
        if (ev.type === "result") result = ev;
        const rendered = renderEvent(ev);
        if (rendered !== "") transcript += `${rendered}\n\n`;
        if (ev.type === "assistant") {
          turns++;
          if (turns > req.limits.turns && limit === undefined) {
            limit = "turns";
            stop("limit");
          }
        }
      };

      child.stdout.on("data", (d: Buffer) => {
        buffer += d.toString("utf8");
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.trim() !== "") handleLine(line);
        }
      });
      child.stderr.on("data", () => undefined);
      child.on("error", (e: NodeJS.ErrnoException) => {
        spawnError =
          e.code === "ENOENT"
            ? `cannot start \`${binary}\`: not found on PATH (install Claude Code: https://docs.claude.com/en/docs/claude-code)`
            : `cannot start \`${binary}\`: ${e.message}`;
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }
}
