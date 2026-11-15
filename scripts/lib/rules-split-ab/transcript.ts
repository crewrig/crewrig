// transcript.ts — parse a `claude -p --output-format stream-json --verbose` transcript and the stub
// MCP call log (spec 0308 R10). Pure: no I/O, no model call.

export interface ToolEvent {
  /** Position among the tool_use events of the run. */
  seq: number;
  id: string;
  /** Tool name with the `mcp__<server>__` prefix stripped. */
  name: string;
  /** MCP server name, or null for a built-in tool. */
  server: string | null;
  input: Record<string, unknown>;
  /** `is_error` of the matching tool_result, null when none was seen. */
  isError: boolean | null;
  /** Text of the matching tool_result, null when none was seen. */
  resultText: string | null;
}

export interface ResultLine {
  subtype: string;
  isError: boolean;
  text: string;
  costUsd: number | null;
  numTurns: number | null;
}

export interface ParsedTranscript {
  events: ToolEvent[];
  result: ResultLine | null;
  /** input + cache creation + cache read tokens of the first assistant call carrying usage. */
  firstCallTokens: number | null;
  malformedLines: number;
  lineCount: number;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function resultTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (isObj(c) && typeof c.text === "string" ? c.text : "")).join("\n");
}

export function parseTranscript(jsonl: string): ParsedTranscript {
  const events: ToolEvent[] = [];
  const byId = new Map<string, ToolEvent>();
  let result: ResultLine | null = null;
  let firstCallTokens: number | null = null;
  let malformedLines = 0;
  let lineCount = 0;

  for (const raw of jsonl.split("\n")) {
    if (raw.trim() === "") continue;
    lineCount++;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isObj(o)) {
      malformedLines++;
      continue;
    }
    if (o.type === "assistant" && isObj(o.message)) {
      const msg = o.message;
      if (firstCallTokens === null && isObj(msg.usage)) {
        const u = msg.usage;
        const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
        firstCallTokens =
          n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (isObj(block) && block.type === "tool_use" && typeof block.name === "string") {
            const m = /^mcp__(.+?)__(.+)$/.exec(block.name);
            const ev: ToolEvent = {
              seq: events.length,
              id: String(block.id ?? ""),
              name: m ? (m[2] as string) : block.name,
              server: m ? (m[1] as string) : null,
              input: isObj(block.input) ? block.input : {},
              isError: null,
              resultText: null,
            };
            events.push(ev);
            byId.set(ev.id, ev);
          }
        }
      }
    } else if (o.type === "user" && isObj(o.message) && Array.isArray(o.message.content)) {
      for (const block of o.message.content) {
        if (isObj(block) && block.type === "tool_result") {
          const ev = byId.get(String(block.tool_use_id ?? ""));
          if (ev) {
            ev.isError = block.is_error === true;
            ev.resultText = resultTextOf(block.content);
          }
        }
      }
    } else if (o.type === "result") {
      result = {
        subtype: typeof o.subtype === "string" ? o.subtype : "unknown",
        isError: o.is_error === true,
        text: typeof o.result === "string" ? o.result : "",
        costUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : null,
        numTurns: typeof o.num_turns === "number" ? o.num_turns : null,
      };
    }
  }
  return { events, result, firstCallTokens, malformedLines, lineCount };
}

export interface CallLogEntry {
  seq: number;
  ts: string;
  surface: string;
  tool: string;
  args: unknown;
}

/** Parse the stub's `$AB_CALL_LOG`. Null (unusable) for a missing log or a malformed line; "" is a valid empty log. */
export function parseCallLog(text: string | null): CallLogEntry[] | null {
  if (text === null) return null;
  const out: CallLogEntry[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const o: unknown = JSON.parse(raw);
      if (!isObj(o) || typeof o.tool !== "string" || typeof o.surface !== "string") return null;
      out.push({
        seq: Number(o.seq),
        ts: String(o.ts ?? ""),
        surface: o.surface,
        tool: o.tool,
        args: o.args,
      });
    } catch {
      return null;
    }
  }
  return out;
}
