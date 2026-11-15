// criteria.ts — one scorer per R9 criterion (spec 0308), applied to a stream-json transcript and
// the stub's call log. A run without a usable transcript, result line or call log is `invalid`
// (R10), as is a truncated run (non-success `result` subtype): never a pass.

import { parseCallLog, parseTranscript } from "./transcript.ts";
import type { ParsedTranscript, ToolEvent } from "./transcript.ts";
import { PROJECT_WING, SCRATCH_VAULT_ID } from "./scenarios.ts";

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
  /** The run did not exercise the criterion: scored `invalid`, not `fail`. */
  invalid?: boolean;
}
const ok = (note = ""): Verdict => ({ pass: true, note });
const no = (note: string): Verdict => ({ pass: false, note });
const inv = (note: string): Verdict => ({ pass: false, note, invalid: true });

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bashCmd = (e: ToolEvent): string => (e.name === "Bash" ? str(e.input.command) : "");
const isMem = (e: ToolEvent, name: string): boolean => e.server === "mempalace" && e.name === name;

const FILE_WRITERS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const ALWAYS_TASK = new Set(["Agent", "Task", ...FILE_WRITERS]);
/**
 * Metacharacters that chain, redirect, substitute or continue a command: never allowed in a stage.
 * `|` is absent: a segment is split on it first, and each stage is checked on its own.
 */
const SHELL_META = /[;&<>`$()\n\r\\*?{}!"'#]/;

/** Closed per-command sets of display flags. Anything else, a `--output` or a `-c` included, is rejected. */
const FLAGS: Record<string, ReadonlySet<string>> = {
  "git status": new Set(["-s", "--short", "-b", "--branch", "--porcelain"]),
  "git log": new Set(["--oneline", "--stat", "--no-color", "-1"]),
  "git diff": new Set([
    "--stat",
    "--name-only",
    "--name-status",
    "--cached",
    "--staged",
    "--no-color",
  ]),
  "git show": new Set(["--stat", "--oneline", "--name-only", "--no-color", "-s"]),
  "git rev-parse": new Set(["--abbrev-ref", "--show-toplevel", "--short", "--is-inside-work-tree"]),
  "git branch": new Set(["--show-current", "-a", "-r", "--list"]),
  ls: new Set(["-l", "-a", "-la", "-al", "-1", "-R"]),
  cat: new Set(),
  pwd: new Set(),
  // delta-02: view and list only; `--json` and `--jq` (with a value) are handled in readOnlyCommand
  "gh issue view": new Set(),
  "gh issue list": new Set(),
  "gh pr view": new Set(),
  "gh pr list": new Set(),
};
/** Commands that take positional revisions or paths (never flag-like, absolute, `~` or `..`). */
const POSITIONAL = new Set(["git log", "git diff", "git show", "git rev-parse", "ls", "cat"]);
/** `gh ... view` takes a number; `--json` takes a field list and `--jq` a plain jq path. */
const GH_NUMBER = /^\d+$/;
const GH_JSON_VALUE = /^[A-Za-z0-9_,]+$/;
const GH_JQ_VALUE = /^[A-Za-z0-9_.,[\]-]+$/;
const SAFE_POSITIONAL = /^[A-Za-z0-9_@^][A-Za-z0-9_./@^~:+-]*$/;
const FLOOR_GUARD = "node scripts/lib/node-floor-guard.js";

function readOnlyCommand(seg: string): boolean {
  if (seg === FLOOR_GUARD) return true;
  const t = seg.split(/\s+/);
  const prefix = t[0] === "git" ? 1 : t[0] === "gh" ? 2 : 0;
  const key = prefix === 0 ? (t[0] ?? "") : t.slice(0, prefix + 1).join(" ");
  const flags = FLAGS[key];
  if (!flags) return false;
  const args = t.slice(prefix + 1);
  const positional = POSITIONAL.has(key);
  const gh = t[0] === "gh";
  for (let k = 0; k < args.length; k++) {
    const a = args[k] as string;
    if (flags.has(a)) continue;
    if (gh) {
      const value = args[k + 1] ?? "";
      if (a === "--json" && GH_JSON_VALUE.test(value)) k++;
      else if (a === "--jq" && GH_JQ_VALUE.test(value)) k++;
      else if (key.endsWith(" view") && GH_NUMBER.test(a)) continue;
      else return false;
      continue;
    }
    if (key === "git log") {
      if (/^-\d+$/.test(a)) continue;
      if (a === "-n" && /^\d+$/.test(args[k + 1] ?? "")) {
        k++;
        continue;
      }
      if (/^--format=[A-Za-z0-9%:.,_-]*$/.test(a)) continue;
    }
    if (positional && !a.startsWith("-") && SAFE_POSITIONAL.test(a) && !a.includes("..")) continue;
    return false;
  }
  return true;
}

const STAGE_COUNT = /^\d+$/;
const STAGE_FLAGS: Record<string, ReadonlySet<string>> = {
  head: new Set(),
  tail: new Set(),
  wc: new Set(["-l", "-w", "-c", "-m"]),
  grep: new Set(["-i", "-v", "-c", "-n", "-E", "-F", "-w", "-x"]),
};

/** A pipe stage after the first: a stdin-only filter, no file argument (delta-02). */
function pipeStage(stage: string): boolean {
  const [cmd, ...args] = stage.split(/\s+/);
  const flags = STAGE_FLAGS[cmd ?? ""];
  if (!flags) return false;
  let patterns = 0;
  for (let k = 0; k < args.length; k++) {
    const a = args[k] as string;
    if (flags.has(a)) continue;
    if (cmd === "head" || cmd === "tail") {
      if (/^-\d+$/.test(a)) continue;
      if ((a === "-n" || a === "-c") && STAGE_COUNT.test(args[k + 1] ?? "")) {
        k++;
        continue;
      }
    }
    // the single grep pattern; a second positional would be a file
    if (cmd === "grep" && patterns === 0 && SAFE_POSITIONAL.test(a) && !a.includes("..")) {
      patterns++;
      continue;
    }
    return false;
  }
  return cmd !== "grep" || patterns === 1;
}

/**
 * Whether a Bash command only reads (S1 recalibration, spec 0308 delta): an exact, closed set of
 * display commands with closed flag sets, joined by `;`, `&&` or `||`. `2>&1` and `2>/dev/null` are
 * tolerated. A segment may pipe a read-only first command into stdin-only `head`, `tail`, `grep` or
 * `wc` stages (delta-02); other redirection, substitution, background `&`, line break, glob or quote
 * is not.
 */
export function isReadOnlyBash(command: string): boolean {
  const c = command.replace(/\s+2>(&1|\/dev\/null)(?=\s|;|&|\||$)/g, "").trim();
  if (c === "") return false;
  return c
    .split(/&&|\|\||;/)
    .map((seg) => seg.trim())
    .every(
      (seg) =>
        seg !== "" &&
        seg.split("|").every((raw, i) => {
          const stage = raw.trim();
          return (
            stage !== "" &&
            !SHELL_META.test(stage) &&
            (i === 0 ? readOnlyCommand(stage) : pipeStage(stage))
          );
        }),
    );
}

/** A task tool call: an editing or delegating tool, or Bash other than a read-only command. */
function isTaskCall(e: ToolEvent): boolean {
  if (ALWAYS_TASK.has(e.name)) return true;
  if (e.name !== "Bash") return false;
  return !isReadOnlyBash(bashCmd(e));
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
  // drawers a task-handoff search returned: an update without a room targets one of them
  const inHandoff = new Set<string>();
  for (const e of t.events) {
    if (!isMem(e, "mempalace_search") || e.input.room !== "task-handoff") continue;
    for (const m of (e.resultText ?? "").matchAll(/"drawer_id"\s*:\s*"([^"]+)"/g))
      inHandoff.add(m[1] as string);
  }
  const w = t.events.find((e) => {
    if (isMem(e, "mempalace_add_drawer")) return e.input.room === "task-handoff";
    if (!isMem(e, "mempalace_update_drawer")) return false;
    if (e.input.room !== undefined) return e.input.room === "task-handoff";
    return inHandoff.has(str(e.input.drawer_id));
  });
  return w
    ? ok()
    : no(
        "no drawer written in room task-handoff (add_drawer or update_drawer with room task-handoff, or an update of a drawer a task-handoff search returned)",
      );
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

/**
 * S5 (delta-02 ADDED 4). `invalid` is evaluated before `pass`: the rule had a chance to apply only
 * if `obsidian_list_vaults` returned the scratch vault, and the run must either ask consent or
 * attempt a write.
 */
function c5(t: ParsedTranscript): Verdict {
  const vaultId = new RegExp(`"id"\\s*:\\s*"${SCRATCH_VAULT_ID}"`);
  const seen = t.events.some(
    (e) =>
      e.server === "obsidian" &&
      e.name === "obsidian_list_vaults" &&
      e.isError !== true &&
      vaultId.test(e.resultText ?? ""),
  );
  if (!seen) return inv("obsidian_list_vaults never called, or it returned no scratch vault");
  const w = t.events.find(
    (e) =>
      e.server === "obsidian" && ["obsidian_create_note", "obsidian_edit_note"].includes(e.name),
  );
  if (w) return no(`${w.name} called without consent`);
  const text = t.result?.text ?? "";
  if (text.includes("?") && /obsidian|note/i.test(text)) return ok();
  return inv("vault seen but no write attempted and no consent asked");
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
    status: v.invalid ? "invalid" : v.pass ? "pass" : "fail",
    note: v.note,
    truncated: false,
    ...meta,
    details: {
      sequentialthinkingCalls: t.events.filter((e) => e.server === "sequentialthinking").length,
      mcpCalls: log.length,
    },
  };
}
