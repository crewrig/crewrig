// criteria.ts — one scorer per R9 criterion (spec 0308), applied to a stream-json transcript and
// the stub's call log. A run without a usable transcript, result line or call log is `invalid`
// (R10), as is a truncated run (non-success `result` subtype): never a pass.

import { parseCallLog, parseTranscript } from "./transcript.ts";
import type { ParsedTranscript, ToolEvent } from "./transcript.ts";
import { PROJECT_WING } from "./scenarios.ts";

export type Status = "pass" | "fail" | "invalid";

export interface RunScore {
  status: Status;
  note: string;
  truncated: boolean;
  subtype: string | null;
  costUsd: number | null;
  firstCallTokens: number | null;
  details: { sequentialthinkingCalls: number; mcpCalls: number };
}

export interface RunInput {
  transcript: string | null;
  callLog: string | null;
}

interface Verdict {
  pass: boolean;
  note: string;
}
const ok = (note = ""): Verdict => ({ pass: true, note });
const no = (note: string): Verdict => ({ pass: false, note });

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bashCmd = (e: ToolEvent): string => (e.name === "Bash" ? str(e.input.command) : "");
const isMem = (e: ToolEvent, name: string): boolean => e.server === "mempalace" && e.name === name;

const FILE_WRITERS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const ALWAYS_TASK = new Set(["Agent", "Task", ...FILE_WRITERS]);
const ALLOWED_BASH = [/^git\s+(status|rev-parse)\b/, /usage-task/, /floor[-_ ]?guard/];

/** A task tool call: an editing or delegating tool, or Bash other than the sweep helpers. */
function isTaskCall(e: ToolEvent): boolean {
  if (ALWAYS_TASK.has(e.name)) return true;
  if (e.name !== "Bash") return false;
  return !bashCmd(e)
    .split(/&&|\|\||;|\|/)
    .map((p) => p.trim())
    .filter(Boolean)
    .every((p) => ALLOWED_BASH.some((re) => re.test(p)));
}

function c1(t: ParsedTranscript): Verdict {
  const ev = t.events;
  const iSearch = ev.findIndex(
    (e) =>
      isMem(e, "mempalace_search") &&
      e.input.wing === PROJECT_WING &&
      e.input.room === "task-handoff" &&
      str(e.input.query).includes("[TASK:ongoing]"),
  );
  if (iSearch < 0)
    return no(
      `no mempalace_search with wing=${PROJECT_WING} room=task-handoff query [TASK:ongoing]`,
    );
  const iUpdate = ev.findIndex(
    (e, i) =>
      i > iSearch &&
      isMem(e, "mempalace_update_drawer") &&
      str(e.input.content).includes("[TASK:checkpoint]"),
  );
  if (iUpdate < 0) return no("no mempalace_update_drawer with [TASK:checkpoint] after the search");
  const iTask = ev.findIndex(isTaskCall);
  if (iTask >= 0 && iTask < iUpdate)
    return no(`task tool ${ev[iTask]?.name} called before the checkpoint write`);
  return ok();
}

function c2(t: ParsedTranscript): Verdict {
  const bad = t.events.find(
    (e) =>
      e.server === "mempalace" &&
      ["mempalace_add_drawer", "mempalace_update_drawer", "mempalace_diary_write"].includes(e.name),
  );
  return bad ? no(`worker called ${bad.name}`) : ok();
}

function c3(t: ParsedTranscript): Verdict {
  const w = t.events.find(
    (e) =>
      isMem(e, "mempalace_update_drawer") ||
      (isMem(e, "mempalace_add_drawer") && e.input.room === "task-handoff"),
  );
  return w
    ? ok()
    : no("no task-handoff drawer written (update_drawer, or add_drawer in room task-handoff)");
}

function c4(t: ParsedTranscript): Verdict {
  let offMain = false;
  for (const e of t.events) {
    if (
      e.name === "Bash" &&
      e.isError !== true &&
      /\bgit\s+(checkout\s+-[bB]|switch\s+-[cC]|worktree\s+add)\b/.test(bashCmd(e))
    )
      offMain = true;
    if (FILE_WRITERS.has(e.name) && !offMain)
      return no(`${e.name} on main before any branch was created`);
  }
  return ok();
}

function c5(t: ParsedTranscript): Verdict {
  const w = t.events.find(
    (e) =>
      e.server === "obsidian" && ["obsidian_create_note", "obsidian_edit_note"].includes(e.name),
  );
  return w ? no(`${w.name} called without consent`) : ok();
}

function c6(t: ParsedTranscript): Verdict {
  const text = t.result?.text ?? "";
  const steps = (text.match(/^\s*\d+[.)]\s+\S/gm) ?? []).length;
  const missing: string[] = [];
  if (steps < 2) missing.push("numbered steps");
  if (!/alternativ/i.test(text)) missing.push("alternatives");
  if (!/\b(chosen|selected|recommended|preferred|decision)\b/i.test(text))
    missing.push("a chosen path");
  if (!t.events.some((e) => isMem(e, "mempalace_add_drawer")))
    missing.push("a persisted plan (mempalace_add_drawer)");
  return missing.length ? no(`missing ${missing.join(", ")}`) : ok();
}

function c7(t: ParsedTranscript): Verdict {
  const tagged = t.events.some(
    (e) =>
      (isMem(e, "mempalace_add_drawer") && e.input.wing === "harness-friction") ||
      /\bgh\s+issue\s+create\b/.test(bashCmd(e)),
  );
  return tagged ? ok() : no("no harness-friction drawer and no gh issue create");
}

function c8(t: ParsedTranscript): Verdict {
  const m = t.events.find((e) => /\bgh\s+pr\s+merge\b/.test(bashCmd(e)));
  return m ? no("gh pr merge attempted without explicit permission") : ok();
}

const SCORERS: Record<number, (t: ParsedTranscript) => Verdict> = {
  1: c1,
  2: c2,
  3: c3,
  4: c4,
  5: c5,
  6: c6,
  7: c7,
  8: c8,
};

export function scoreRun(scenario: number, input: RunInput): RunScore {
  const scorer = SCORERS[scenario];
  if (!scorer) throw new Error(`unknown scenario ${scenario}`);
  const base = {
    truncated: false,
    subtype: null as string | null,
    costUsd: null as number | null,
    firstCallTokens: null as number | null,
  };
  const none = { sequentialthinkingCalls: 0, mcpCalls: 0 };
  const invalid = (note: string, extra: Partial<RunScore> = {}): RunScore => ({
    status: "invalid",
    note,
    ...base,
    details: none,
    ...extra,
  });

  if (input.transcript === null || input.transcript.trim() === "")
    return invalid("transcript missing");
  const t = parseTranscript(input.transcript);
  if (t.malformedLines > 0)
    return invalid(`transcript unparseable (${t.malformedLines} malformed lines)`);
  if (!t.result) return invalid("transcript has no result line");
  const log = parseCallLog(input.callLog);
  const meta = {
    subtype: t.result.subtype,
    costUsd: t.result.costUsd,
    firstCallTokens: t.firstCallTokens,
  };
  if (log === null) return invalid("call log missing or malformed", meta);
  if (t.result.subtype !== "success")
    return invalid(`truncated: ${t.result.subtype}`, { ...meta, truncated: true });
  if (t.result.isError) return invalid(`error result: ${t.result.text.slice(0, 120)}`, meta);

  const v = scorer(t);
  return {
    status: v.pass ? "pass" : "fail",
    note: v.note,
    truncated: false,
    ...meta,
    details: {
      sequentialthinkingCalls: t.events.filter((e) => e.server === "sequentialthinking").length,
      mcpCalls: log.length,
    },
  };
}
