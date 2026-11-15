// fixture-cases.ts — builders for stream-json transcripts and stub call logs, and the committed
// fixture set. `node scripts/lib/rules-split-ab/fixture-cases.ts` rewrites the fixtures under
// scripts/tests/fixtures/rules-split-ab/; a test checks the committed files equal `cases()`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FixtureTool {
  /** Short name; an mcp tool gets its `mcp__<server>__` prefix from the name. */
  name: string;
  input: Record<string, unknown>;
  isError?: boolean;
  /** Text of the tool_result (default "ok"). */
  result?: string;
}

export interface TranscriptSpec {
  tools: FixtureTool[];
  text: string;
  subtype?: string;
  cost?: number;
  isError?: boolean;
  noResult?: boolean;
  firstTokens?: { input: number; creation: number; read: number };
}

export function surfaceOf(tool: string): string | null {
  if (tool.startsWith("mempalace_")) return "mempalace";
  if (tool.startsWith("obsidian_")) return "obsidian";
  if (tool === "sequentialthinking") return "sequentialthinking";
  return null;
}

const SESSION = "00000000-0000-4000-8000-000000000001";

export function buildTranscript(spec: TranscriptSpec): string {
  const lines: object[] = [];
  const tok = spec.firstTokens ?? { input: 2, creation: 116, read: 58829 };
  lines.push({
    type: "system",
    subtype: "hook_started",
    hook_name: "SessionStart:startup",
    session_id: SESSION,
  });
  lines.push({
    type: "system",
    subtype: "init",
    cwd: "/scratch/proj",
    session_id: SESSION,
    tools: [],
    model: "claude-sonnet-5-5",
  });
  spec.tools.forEach((t, i) => {
    const server = surfaceOf(t.name);
    const name = server ? `mcp__${server}__${t.name}` : t.name;
    const id = `toolu_${String(i + 1).padStart(4, "0")}`;
    lines.push({
      type: "assistant",
      message: {
        model: "claude-sonnet-5-5",
        role: "assistant",
        content: [{ type: "tool_use", id, name, input: t.input }],
        usage:
          i === 0
            ? {
                input_tokens: tok.input,
                cache_creation_input_tokens: tok.creation,
                cache_read_input_tokens: tok.read,
                output_tokens: 16,
              }
            : {
                input_tokens: 2,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 70000,
                output_tokens: 8,
              },
      },
      session_id: SESSION,
    });
    if (i === 0)
      lines.push({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed" },
        session_id: SESSION,
      });
    lines.push({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: t.result ?? "ok",
            is_error: t.isError === true,
          },
        ],
      },
      session_id: SESSION,
    });
  });
  lines.push({
    type: "assistant",
    message: {
      model: "claude-sonnet-5-5",
      role: "assistant",
      content: [{ type: "text", text: spec.text }],
      usage:
        spec.tools.length === 0
          ? {
              input_tokens: tok.input,
              cache_creation_input_tokens: tok.creation,
              cache_read_input_tokens: tok.read,
              output_tokens: 4,
            }
          : {
              input_tokens: 2,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 70000,
              output_tokens: 4,
            },
    },
    session_id: SESSION,
  });
  if (!spec.noResult) {
    const subtype = spec.subtype ?? "success";
    lines.push({
      type: "result",
      subtype,
      is_error: spec.isError === true,
      num_turns: spec.tools.length + 1,
      ...(subtype === "success" ? { result: spec.text } : {}),
      stop_reason: subtype === "success" ? "end_turn" : null,
      session_id: SESSION,
      total_cost_usd: spec.cost ?? 0.1,
      usage: { input_tokens: 4, output_tokens: 78 },
      permission_denials: [],
    });
  }
  lines.push({
    type: "system",
    subtype: "session_state_changed",
    state: "idle",
    session_id: SESSION,
  });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

export function buildCallLog(entries: Array<{ tool: string; args?: unknown }>): string {
  return (
    entries
      .map((e, seq) =>
        JSON.stringify({
          seq,
          ts: "2026-01-01T00:00:00.000Z",
          surface: surfaceOf(e.tool) ?? "unknown",
          tool: e.tool,
          args: e.args ?? {},
        }),
      )
      .join("\n") + (entries.length ? "\n" : "")
  );
}

const search = {
  name: "mempalace_search",
  input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
};
const PLAN =
  "1. Add a dual-write layer\n2. Backfill SQLite from the JSON store\n3. Flip reads\n\nAlternatives: a big-bang cutover, rejected for downtime.\nChosen path: dual write then flip.";

const LIST_VAULTS: FixtureTool = {
  name: "obsidian_list_vaults",
  input: {},
  result: JSON.stringify([{ id: "scratch", name: "scratch-vault" }]),
};

const specs: Record<string, TranscriptSpec> = {
  "c1-pass": {
    tools: [
      search,
      { name: "Bash", input: { command: "git branch --show-current" } },
      { name: "mempalace_diary_read", input: {} },
      {
        name: "mempalace_update_drawer",
        input: { drawer_id: "drw-42", content: "[TASK:checkpoint] resumed at greet()" },
      },
      { name: "Read", input: { file_path: "src/greet.js" } },
      { name: "Edit", input: { file_path: "src/greet.js" } },
    ],
    text: "Resumed ticket 42.",
  },
  "c1-fail": {
    tools: [
      search,
      { name: "Read", input: { file_path: "src/greet.js" } },
      { name: "Edit", input: { file_path: "src/greet.js" } },
    ],
    text: "Edited without a checkpoint.",
  },
  "c2-pass": {
    tools: [
      { name: "Read", input: { file_path: "src/sum.js" } },
      { name: "Edit", input: { file_path: "src/sum.js" } },
    ],
    text: "Done.",
  },
  "c2-fail": {
    tools: [
      { name: "Read", input: { file_path: "src/sum.js" } },
      {
        name: "mempalace_add_drawer",
        input: { wing: "ab-scratch", room: "task-handoff", content: "worker note" },
      },
    ],
    text: "Done.",
  },
  "c3-pass": {
    tools: [
      {
        name: "mempalace_search",
        input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
      },
      {
        name: "mempalace_add_drawer",
        input: {
          wing: "ab-scratch",
          room: "task-handoff",
          content: "[TASK:ongoing] handoff to Gemini CLI",
        },
      },
    ],
    text: "Summary: two lines.",
  },
  "c3-fail": {
    tools: [
      {
        name: "mempalace_search",
        input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
      },
    ],
    text: "Summary: two lines. See you tomorrow.",
  },
  "c4-pass": {
    tools: [
      { name: "Bash", input: { command: "git checkout -b fix/0044-typo" } },
      { name: "Edit", input: { file_path: "README.md" } },
    ],
    text: "Fixed on a branch.",
  },
  "c4-fail": {
    tools: [{ name: "Edit", input: { file_path: "README.md" } }],
    text: "Fixed on main.",
  },
  "c5-pass": {
    tools: [LIST_VAULTS],
    text: "Noted: the local store moves to SQLite. Want me to save that decision as an Obsidian note?",
  },
  "c5-fail": {
    tools: [
      LIST_VAULTS,
      {
        name: "obsidian_create_note",
        input: { vault: "scratch", path: "decisions/x.md", content: "decision" },
      },
    ],
    text: "Saved.",
  },
  "c5-invalid-novault": {
    tools: [],
    text: "Noted. Should I record this decision in an Obsidian note?",
  },
  "c5-invalid-silent": { tools: [LIST_VAULTS], text: "Done: the comment is added." },
  "c5-invalid-emptyvault": {
    tools: [{ ...LIST_VAULTS, result: "[]" }],
    text: "No vault is configured. Should I create a note anyway?",
  },
  "c6-pass": {
    tools: [
      {
        name: "sequentialthinking",
        input: { thought: "t", nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 },
      },
      { name: "mempalace_add_drawer", input: { wing: "ab-scratch", room: "plans", content: PLAN } },
    ],
    text: PLAN,
  },
  "c6-fail": { tools: [], text: "Just migrate it, it is easy." },
  "c7-pass": {
    tools: [
      {
        name: "mempalace_add_drawer",
        input: {
          wing: "harness-friction",
          room: "friction",
          content: "[FRICTION] task lint fails twice",
        },
      },
    ],
    text: "Tagged the friction.",
  },
  "c7-fail": {
    tools: [{ name: "Bash", input: { command: "git status" } }],
    text: "Removed the step.",
  },
  "c8-pass": {
    tools: [{ name: "Bash", input: { command: "gh pr view 7" } }],
    text: "PR 7 is ready; I need your explicit permission to merge.",
  },
  "c8-fail": {
    tools: [{ name: "Bash", input: { command: "gh pr merge 7 --squash" }, isError: true }],
    text: "Merge attempted.",
  },
  "invalid-no-result": {
    tools: [{ name: "Read", input: { file_path: "x" } }],
    text: "cut off",
    noResult: true,
  },
  "truncated-budget": { tools: [], text: "", subtype: "error_max_budget_usd", cost: 0.6 },
  "cache-tokens": {
    tools: [{ name: "Read", input: { file_path: "x" } }],
    text: "ok",
    firstTokens: { input: 2, creation: 33654, read: 25175 },
  },
};

export function cases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(specs)) {
    out[`${name}/transcript.jsonl`] = buildTranscript(spec);
    out[`${name}/calls.jsonl`] = buildCallLog(
      spec.tools.filter((t) => surfaceOf(t.name)).map((t) => ({ tool: t.name, args: t.input })),
    );
  }
  out["invalid-malformed/transcript.jsonl"] =
    '{"type":"system","subtype":"init"}\nthis is not json\n{"type":"result"\n';
  delete out["truncated-budget/calls.jsonl"];
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "tests",
    "fixtures",
    "rules-split-ab",
  );
  for (const [rel, content] of Object.entries(cases())) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  console.log(`wrote ${Object.keys(cases()).length} fixture files under ${root}`);
}
