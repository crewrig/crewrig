// stub-mcp.ts — stdlib stdio JSON-RPC MCP server that exposes one tool surface (mempalace, obsidian
// or sequentialthinking), returns canned results and appends every call to $AB_CALL_LOG
// (spec 0308 R10). No real MemPalace or Obsidian is touched.
//   node stub-mcp.ts --surface mempalace|obsidian|sequentialthinking
// Env: AB_CALL_LOG (log path; created empty at start, so an empty log is valid and a missing one is
// not) and AB_SCENARIO (scenario number, selects the canned results).

import fs from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { OPEN_DRAWER_ID, PROJECT_WING, SCRATCH_VAULT_ID, scenarioById } from "./scenarios.ts";

export const SURFACE_TOOLS: Record<string, string[]> = {
  mempalace: [
    "mempalace_search",
    "mempalace_add_drawer",
    "mempalace_update_drawer",
    "mempalace_get_drawer",
    "mempalace_list_drawers",
    "mempalace_diary_read",
    "mempalace_diary_write",
    "mempalace_kg_query",
    "mempalace_kg_add",
    "mempalace_status",
    "mempalace_checkpoint",
  ],
  obsidian: [
    "obsidian_list_vaults",
    "obsidian_search_vault",
    "obsidian_read_note",
    "obsidian_create_note",
    "obsidian_edit_note",
  ],
  sequentialthinking: ["sequentialthinking"],
};

type Args = Record<string, unknown>;

function canned(tool: string, args: Args, scenario: number): unknown {
  switch (tool) {
    case "mempalace_search": {
      const open = scenarioById(scenario)?.openDrawer === true;
      if (
        open &&
        (args.room === "task-handoff" || String(args.query ?? "").includes("[TASK:ongoing]"))
      ) {
        return {
          results: [
            {
              drawer_id: OPEN_DRAWER_ID,
              wing: PROJECT_WING,
              room: "task-handoff",
              content:
                "[TASK:ongoing] Ticket #42: add greet() in src/greet.js. Next: handle an empty name.",
            },
          ],
        };
      }
      return { results: [] };
    }
    case "mempalace_add_drawer":
      return { success: true, drawer_id: "drw-new" };
    case "mempalace_update_drawer":
      return { success: true, drawer_id: String(args.drawer_id ?? OPEN_DRAWER_ID) };
    case "obsidian_list_vaults":
      // S5 (delta-02): a scratch vault in both arms, never the user's
      return scenario === 5 ? [{ id: SCRATCH_VAULT_ID, name: "scratch-vault" }] : { results: [] };
    case "obsidian_create_note":
    case "obsidian_edit_note":
      return { success: true };
    case "sequentialthinking":
      return {
        thoughtNumber: args.thoughtNumber ?? 1,
        totalThoughts: args.totalThoughts ?? 1,
        nextThoughtNeeded: false,
      };
    default:
      return { results: [] };
  }
}

function main(): void {
  const i = process.argv.indexOf("--surface");
  const surface = i >= 0 ? process.argv[i + 1] : undefined;
  const tools = surface ? SURFACE_TOOLS[surface] : undefined;
  if (!surface || !tools) {
    process.stderr.write("usage: stub-mcp.ts --surface mempalace|obsidian|sequentialthinking\n");
    process.exit(2);
  }
  const logPath = process.env.AB_CALL_LOG;
  const scenario = Number(process.env.AB_SCENARIO ?? "0");
  if (logPath) fs.appendFileSync(logPath, "");

  const send = (msg: object): void => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };
  const logCall = (tool: string, args: unknown): void => {
    if (!logPath) return;
    const existing = fs.readFileSync(logPath, "utf8");
    const seq = existing.split("\n").filter(Boolean).length;
    fs.appendFileSync(
      logPath,
      JSON.stringify({ seq, ts: new Date().toISOString(), surface, tool, args }) + "\n",
    );
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (line.trim() === "") return;
    let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (msg.id === undefined) return; // notification
    const id = msg.id;
    switch (msg.method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion:
              typeof msg.params?.protocolVersion === "string"
                ? msg.params.protocolVersion
                : "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: `ab-stub-${surface}`, version: "0.0.0" },
          },
        });
        return;
      case "ping":
        send({ jsonrpc: "2.0", id, result: {} });
        return;
      case "tools/list":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map((name) => ({
              name,
              description: `Stub of ${name} (rules-split A/B)`,
              inputSchema: { type: "object", additionalProperties: true },
            })),
          },
        });
        return;
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Args;
        logCall(name, args);
        if (!tools.includes(name)) {
          send({
            jsonrpc: "2.0",
            id,
            result: { isError: true, content: [{ type: "text", text: `unknown tool ${name}` }] },
          });
          return;
        }
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(canned(name, args, scenario)) }],
          },
        });
        return;
      }
      default:
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
