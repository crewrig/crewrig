// fixed-context-probe.ts — pure helpers of the fixed-context probe (issue #1994, ADR-0025
// appendix): read the first-call input tokens out of Claude Code transcripts and compare
// them with the committed threshold. No I/O besides reading transcript files; no model call.

import fs from "node:fs";
import path from "node:path";

export interface Threshold {
  worker: number;
  subagent: number;
}

export interface SessionMeasure {
  /** `worker` for the main session, `subagent:<agentType>` for a subagent. */
  kind: "worker" | "subagent";
  agent: string;
  tokens: number;
  transcript: string;
}

export interface Breach {
  kind: "worker" | "subagent";
  agent: string;
  tokens: number;
  limit: number;
  excess: number;
}

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * First-call input tokens of a transcript: input + cache read + cache creation of the first
 * `assistant` line carrying a usage block. Lines of any other type (attachments, user turns,
 * summaries) are skipped, so only the first API request is counted. Null when none exists.
 */
export function firstCallTokens(jsonl: string): number | null {
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: { type?: string; message?: { usage?: Usage } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const usage = entry.message?.usage;
    if (usage === undefined) continue;
    return (
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
    );
  }
  return null;
}

/** Locate `<projectsDir>/<project>/<sessionId>.jsonl` without computing the project slug. */
export function findTranscript(projectsDir: string, sessionId: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
  if (!fs.existsSync(projectsDir)) return null;
  for (const project of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, project, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Measure the main session and every subagent transcript next to it. */
export function measureSession(transcript: string): SessionMeasure[] {
  const out: SessionMeasure[] = [];
  const main = firstCallTokens(fs.readFileSync(transcript, "utf8"));
  if (main !== null) out.push({ kind: "worker", agent: "main", tokens: main, transcript });
  const subDir = path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  if (fs.existsSync(subDir)) {
    for (const name of fs.readdirSync(subDir).sort()) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(subDir, name);
      const tokens = firstCallTokens(fs.readFileSync(file, "utf8"));
      if (tokens === null) continue;
      out.push({ kind: "subagent", agent: agentType(file), tokens, transcript: file });
    }
  }
  return out;
}

function agentType(transcript: string): string {
  try {
    const meta = JSON.parse(fs.readFileSync(transcript.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    if (typeof meta.agentType === "string" && meta.agentType !== "") return meta.agentType;
  } catch {
    // no sidecar: fall through
  }
  return path.basename(transcript, ".jsonl");
}

/** Parse the committed threshold file; throws on a missing or non-positive limit. */
export function parseThreshold(text: string): Threshold {
  const raw = JSON.parse(text);
  for (const key of ["worker", "subagent"] as const) {
    if (!Number.isInteger(raw[key]) || raw[key] <= 0) {
      throw new Error(`threshold "${key}" must be a positive integer`);
    }
  }
  return { worker: raw.worker, subagent: raw.subagent };
}

/** Every measure strictly above its limit; equal to the limit passes. */
export function compare(measures: SessionMeasure[], threshold: Threshold): Breach[] {
  const out: Breach[] = [];
  for (const m of measures) {
    const limit = threshold[m.kind];
    if (m.tokens > limit) {
      out.push({ kind: m.kind, agent: m.agent, tokens: m.tokens, limit, excess: m.tokens - limit });
    }
  }
  return out;
}

/** The probe spends real money; it must never run where `CI` is set. */
export function refuseInCi(env: Record<string, string | undefined>): string | null {
  const ci = env.CI;
  if (ci !== undefined && ci !== "" && ci !== "0" && ci.toLowerCase() !== "false") {
    return "refused: the fixed-context probe makes paid model calls and never runs in CI (CI is set); use `--transcript`/`--session` to read an existing session for free";
  }
  return null;
}
