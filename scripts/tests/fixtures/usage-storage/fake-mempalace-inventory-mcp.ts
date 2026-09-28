// fake-mempalace-inventory-mcp.ts — a hermetic stand-in for the MemPalace MCP
// HTTP daemon, used ONLY by
// scripts/tests/usage-inventory.test.ts (spec 0239, issue
// #1206; TypeScript port of the twice-reviewed fake-mempalace-inventory-mcp.js,
// PR #1361, forced by spec 0238's shell/JS ratchet — see
// scripts/lib/usage-store/inventory.ts's own header for the full rationale).
// Never the real daemon at 127.0.0.1:41893 — the test suite always binds
// this fixture to a caller-supplied ephemeral port.
//
// A DEDICATED fixture, not an extension of fake-mempalace-mcp.js: that
// file's own header comment scopes it to "exactly the two tools" mirror.js
// calls (mempalace_add_drawer / mempalace_delete_by_source), and its
// toolFailure/sourceToolFailure control surface is built around those two
// tools' specific success/dry-run semantics. This fixture answers the four
// DIFFERENT tools scripts/lib/usage-store/inventory.ts calls instead:
// mempalace_list_wings, mempalace_list_drawers, mempalace_get_drawer, and
// mempalace_delete_drawer — over the identical single bearer-authenticated
// `POST /mcp` JSON-RPC `tools/call` transport (no `initialize`, no session
// header, no SSE) mcp.js's own header comment documents.
//
// Response shapes mirror the ones confirmed EMPIRICALLY against the live,
// installed MemPalace daemon during DEV of issue #1206 (2026-09-27; see
// scripts/lib/usage-store/mcp.js's own header comment for the same
// citations):
//   - mempalace_list_wings        -> {wings: {<wingName>: <drawerCount>, ...}}
//     (an OBJECT keyed by wing name, never an array).
//   - mempalace_list_drawers      -> {drawers: [{drawer_id, wing, room,
//                                    content_preview, metadata: {filed_at}}],
//                                    total, count, offset, limit}
//   - mempalace_get_drawer        -> {drawer_id, content, wing, room, metadata}
//   - mempalace_delete_drawer     -> {success: true, drawer_id, deleted: true}
//     (this exact payload shape was NOT confirmed live — deleting a real
//     drawer to verify it was avoided as an irreversible side effect during
//     DEV. mcp.js's own deleteDrawer() wrapper is a thin pass-through with no
//     success-field requirement of its own, so this fixture's exact payload
//     for a successful delete is not load-bearing for anything inventory.ts
//     asserts — only that the call round-trips as a well-formed envelope.)
//
// This fixture's drawer store is seeded DIRECTLY via the /control endpoint,
// never through mempalace_add_drawer (which this fixture does not even
// implement): the whole premise of spec 0239 R1 is that inventory.ts works
// from MemPalace's OWN listing and content alone, independent of anything
// mirror.js or a local journal ever wrote — so the suite never needs a local
// usage root, a journal entry, or a mirror marker to exist for any drawer it
// seeds here.
//
// Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON fake-mempalace-inventory-mcp.ts <port> <token>
//
// Test control (POST /control, fixture-only, never a real MemPalace
// endpoint):
//   {"reset": true}
//       clears every seeded wing and drawer.
//   {"seedDrawer": {"wing": "<wing>", "content": "<string>", "drawerId": "<id>"?}}
//       adds one drawer directly to the "usage-records" room of <wing>.
//       drawerId is optional; a deterministic content-addressed one is
//       generated if omitted. Returns {ok:true, drawerId}.
//   {"countDrawers": {"wing": "<wing>"}}
//       returns {ok:true, count: <n>, drawerIds: [...]} for that wing's
//       current usage-records room — lets the suite assert survivors after a
//       delete run without needing a separate drawers file.
//   {"toolFailure": {"tool": "<mempalace_list_wings|mempalace_list_drawers|
//                    mempalace_get_drawer|mempalace_delete_drawer>",
//                    "shape": "<shape>"|null, "code": <int>?}}
//       while a shape is armed, every call to that tool answers with the
//       named malformed shape instead of its real payload. Shapes:
//         not-json-text  — raw result {content: [text 'not json']}.
//         no-text-content — raw result {content: []}.
//         is-error        — raw result {content: [...], isError: true}.
//         no-result       — whole response {jsonrpc, id}: no result, no error.
//         jsonrpc-error   — {jsonrpc, id, error: {code, message}}; code is
//                           REQUIRED (an integer) when this shape is armed.
//         transport-500   — answers HTTP 500, which mcp.js's call()
//                           classifies as `transport` — simulates an
//                           unreachable daemon WITHOUT killing this process,
//                           so the fixture's in-memory store survives the
//                           simulated outage (unlike actually stopping and
//                           restarting this process, which would lose it).
//         success-false   — a well-formed 200 envelope whose PAYLOAD (not
//                           the JSON-RPC envelope) is
//                           `{success:false, error:"..."}"}` — the exact
//                           shape confirmed against the installed MemPalace
//                           server source for mempalace_delete_drawer's
//                           "not found"/already-deleted case (i1-F1, PR
//                           #1361). Used against mempalace_delete_drawer.
//         no-content-error — a well-formed 200 envelope whose PAYLOAD is
//                           `{error:"..."}"}` with no `content` key and no
//                           `success` key — mempalace_get_drawer's own only
//                           failure shape, confirmed against the installed
//                           server source (i1-F2, PR #1361). Used against
//                           mempalace_get_drawer.
//       An unknown tool or shape, or a jsonrpc-error with no integer code,
//       answers HTTP 400.
//   {"latency": {"tool": "<any tool name>", "ms": <int>}}
//       delays that tool's response by <ms> milliseconds (0 clears the
//       delay). Lets the suite demonstrate that sweep()'s per-drawer
//       confirmation loop runs with real concurrency (i1-F3, PR #1361)
//       rather than one drawer at a time, by timing a seeded batch under a
//       constrained CREWRIG_USAGE_INVENTORY_CONCURRENCY=1 vs. a higher one.

import { createHash } from "node:crypto";
import http from "node:http";

const [, , portArg, token] = process.argv;
if (!portArg || !token) {
  console.error("Usage: node fake-mempalace-inventory-mcp.ts <port> <token>");
  process.exit(2);
}
const PORT = Number(portArg);

const ROOM = "usage-records";

interface DrawerEntry {
  content: string;
  filedAt: string;
}

// wing -> Map(drawerId -> entry)
let store = new Map<string, Map<string, DrawerEntry>>();

function ensureWing(wing: string): Map<string, DrawerEntry> {
  let wingMap = store.get(wing);
  if (wingMap === undefined) {
    wingMap = new Map();
    store.set(wing, wingMap);
  }
  return wingMap;
}

function makeDrawerId(wing: string, content: string): string {
  const digest = createHash("sha256")
    .update(`${wing}|${ROOM}|${content}`)
    .digest("hex")
    .slice(0, 24);
  return `drawer_${wing}_${ROOM}_${digest}`;
}

type ToolName =
  | "mempalace_list_wings"
  | "mempalace_list_drawers"
  | "mempalace_get_drawer"
  | "mempalace_delete_drawer";

type Shape =
  | "not-json-text"
  | "no-text-content"
  | "is-error"
  | "no-result"
  | "jsonrpc-error"
  | "transport-500"
  | "success-false"
  | "no-content-error";

const SHAPES: Shape[] = [
  "not-json-text",
  "no-text-content",
  "is-error",
  "no-result",
  "jsonrpc-error",
  "transport-500",
  "success-false",
  "no-content-error",
];

const toolFailure: Record<ToolName, Shape | null> = {
  mempalace_list_wings: null,
  mempalace_list_drawers: null,
  mempalace_get_drawer: null,
  mempalace_delete_drawer: null,
};
const toolFailureCode: Record<ToolName, number | null> = {
  mempalace_list_wings: null,
  mempalace_list_drawers: null,
  mempalace_get_drawer: null,
  mempalace_delete_drawer: null,
};

// wing/room member calls' own response latency, keyed by tool name (ms; 0 or
// absent = no delay). See the header comment's {"latency": {...}} control op.
const toolLatency: Record<ToolName, number> = {
  mempalace_list_wings: 0,
  mempalace_list_drawers: 0,
  mempalace_get_drawer: 0,
  mempalace_delete_drawer: 0,
};

function jsonRpcResult(id: unknown, payload: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
}
function jsonRpcRawResult(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

interface HandlerResult {
  status: number;
  body: string;
}

// injected(shape, id, code) -> {status, body} — every handler below returns
// this same shape for both the normal and the injected-failure path, so the
// dispatcher can always do one uniform writeHead/end.
function injected(shape: Shape, id: unknown, code: number | null): HandlerResult {
  switch (shape) {
    case "not-json-text":
      return {
        status: 200,
        body: jsonRpcRawResult(id, { content: [{ type: "text", text: "not json" }] }),
      };
    case "no-text-content":
      return { status: 200, body: jsonRpcRawResult(id, { content: [] }) };
    case "is-error":
      return {
        status: 200,
        body: jsonRpcRawResult(id, { content: [{ type: "text", text: "{}" }], isError: true }),
      };
    case "no-result":
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id }) };
    case "jsonrpc-error":
      return {
        status: 200,
        body: jsonRpcError(id, code as number, "injected tool failure (test control)"),
      };
    case "transport-500":
      return {
        status: 500,
        body: JSON.stringify({ error: "injected transport failure (test control)" }),
      };
    case "success-false":
      // A well-formed tool result whose PAYLOAD is {success:false, ...} —
      // the real mempalace_delete_drawer shape for an already-deleted or
      // unknown drawer id (i1-F1). NOT a JSON-RPC-level error.
      return {
        status: 200,
        body: jsonRpcResult(id, {
          success: false,
          error: "injected success:false payload (test control)",
        }),
      };
    case "no-content-error":
      // A well-formed tool result whose PAYLOAD is {error: ...} with no
      // `content` key and no `success` key — mempalace_get_drawer's only
      // real failure shape (i1-F2). NOT a JSON-RPC-level error.
      return {
        status: 200,
        body: jsonRpcResult(id, { error: "injected content-less error payload (test control)" }),
      };
    default: {
      const exhaustive: never = shape;
      throw new Error(`unknown toolFailure shape: ${String(exhaustive)}`);
    }
  }
}

function handleListWings(id: unknown): HandlerResult {
  const shape = toolFailure.mempalace_list_wings;
  if (shape) return injected(shape, id, toolFailureCode.mempalace_list_wings);
  const wings: Record<string, number> = {};
  for (const [wing, drawers] of store.entries()) {
    wings[wing] = drawers.size;
  }
  return { status: 200, body: jsonRpcResult(id, { wings }) };
}

interface ListDrawersArgs {
  wing?: string;
  room?: string;
  limit?: number;
  offset?: number;
}

function handleListDrawers(id: unknown, args: ListDrawersArgs | undefined): HandlerResult {
  const shape = toolFailure.mempalace_list_drawers;
  if (shape) return injected(shape, id, toolFailureCode.mempalace_list_drawers);
  const { wing, room, limit, offset } = args ?? {};
  const effLimit = Number.isInteger(limit) ? (limit as number) : 20;
  const effOffset = Number.isInteger(offset) ? (offset as number) : 0;
  const wingMap =
    (wing !== undefined ? store.get(wing) : undefined) ?? new Map<string, DrawerEntry>();
  const all = room === ROOM ? [...wingMap.entries()] : [];
  const total = all.length;
  const page = all.slice(effOffset, effOffset + effLimit).map(([drawerId, entry]) => ({
    drawer_id: drawerId,
    wing,
    room: ROOM,
    content_preview: entry.content.slice(0, 200),
    metadata: { filed_at: entry.filedAt },
  }));
  return {
    status: 200,
    body: jsonRpcResult(id, {
      drawers: page,
      total,
      count: page.length,
      offset: effOffset,
      limit: effLimit,
    }),
  };
}

function handleGetDrawer(id: unknown, args: { drawer_id?: string } | undefined): HandlerResult {
  const shape = toolFailure.mempalace_get_drawer;
  if (shape) return injected(shape, id, toolFailureCode.mempalace_get_drawer);
  const drawerId = args?.drawer_id;
  if (drawerId !== undefined) {
    for (const [wing, wingMap] of store.entries()) {
      const entry = wingMap.get(drawerId);
      if (entry !== undefined) {
        return {
          status: 200,
          body: jsonRpcResult(id, {
            drawer_id: drawerId,
            content: entry.content,
            wing,
            room: ROOM,
            metadata: { filed_at: entry.filedAt },
          }),
        };
      }
    }
  }
  return { status: 200, body: jsonRpcError(id, -32000, `drawer not found: ${String(drawerId)}`) };
}

function handleDeleteDrawer(id: unknown, args: { drawer_id?: string } | undefined): HandlerResult {
  const shape = toolFailure.mempalace_delete_drawer;
  if (shape) return injected(shape, id, toolFailureCode.mempalace_delete_drawer);
  const drawerId = args?.drawer_id;
  if (drawerId !== undefined) {
    for (const wingMap of store.values()) {
      if (wingMap.has(drawerId)) {
        wingMap.delete(drawerId);
        return {
          status: 200,
          body: jsonRpcResult(id, { success: true, drawer_id: drawerId, deleted: true }),
        };
      }
    }
  }
  return { status: 200, body: jsonRpcError(id, -32000, `drawer not found: ${String(drawerId)}`) };
}

const TOOLS: Record<ToolName, (id: unknown, args: unknown) => HandlerResult> = {
  mempalace_list_wings: (id) => handleListWings(id),
  mempalace_list_drawers: (id, args) => handleListDrawers(id, args as ListDrawersArgs | undefined),
  mempalace_get_drawer: (id, args) =>
    handleGetDrawer(id, args as { drawer_id?: string } | undefined),
  mempalace_delete_drawer: (id, args) =>
    handleDeleteDrawer(id, args as { drawer_id?: string } | undefined),
};

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(toolFailure, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function handleControl(req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (isRecord(parsed)) body = parsed;
    } catch {
      // treat an unparseable control body as a no-op
    }

    if (body.reset) {
      store = new Map();
    }

    if (isRecord(body.seedDrawer)) {
      const seed = body.seedDrawer;
      const wing = String(seed.wing);
      const content = String(seed.content);
      const explicitId = typeof seed.drawerId === "string" ? seed.drawerId : undefined;
      const wingMap = ensureWing(wing);
      const drawerId = explicitId ?? makeDrawerId(wing, content);
      wingMap.set(drawerId, { content, filedAt: new Date().toISOString() });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, drawerId }));
      return;
    }

    if (isRecord(body.countDrawers)) {
      const wing = String(body.countDrawers.wing);
      const wingMap = store.get(wing) ?? new Map<string, DrawerEntry>();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: wingMap.size, drawerIds: [...wingMap.keys()] }));
      return;
    }

    if (Object.prototype.hasOwnProperty.call(body, "toolFailure")) {
      const tf = isRecord(body.toolFailure) ? body.toolFailure : {};
      const tool = tf.tool;
      const shape = tf.shape;
      if (!isToolName(tool) || (shape !== null && !SHAPES.includes(shape as Shape))) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: `unknown toolFailure tool/shape: ${String(tool)}/${String(shape)}`,
          }),
        );
        return;
      }
      if (shape === "jsonrpc-error" && !Number.isInteger(tf.code)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: `jsonrpc-error requires an integer code, got: ${String(tf.code)}`,
          }),
        );
        return;
      }
      toolFailure[tool] = (shape ?? null) as Shape | null;
      toolFailureCode[tool] = shape === "jsonrpc-error" ? (tf.code as number) : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, "latency")) {
      const lt = isRecord(body.latency) ? body.latency : {};
      const tool = lt.tool;
      const ms = lt.ms;
      if (!isToolName(tool) || !Number.isInteger(ms) || (ms as number) < 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: `unknown latency tool or non-negative-integer ms: ${String(tool)}/${String(ms)}`,
          }),
        );
        return;
      }
      toolLatency[tool] = ms as number;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, toolFailure, toolLatency }));
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "POST" && req.url === "/control") {
    handleControl(req, res);
    return;
  }

  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(404);
    res.end();
    return;
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${token}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    if (!isRecord(parsedBody) || parsedBody.method !== "tools/call") {
      const id = isRecord(parsedBody) ? parsedBody.id : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        jsonRpcError(
          id,
          -32000,
          `unsupported method: ${isRecord(parsedBody) ? String(parsedBody.method) : "unknown"}`,
        ),
      );
      return;
    }

    const params = isRecord(parsedBody.params) ? parsedBody.params : {};
    const toolName = params.name;
    const handler = isToolName(toolName) ? TOOLS[toolName] : undefined;
    if (!handler || !isToolName(toolName)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(jsonRpcError(parsedBody.id, -32000, `unknown tool: ${String(toolName)}`));
      return;
    }
    const { status, body: respBody } = handler(parsedBody.id, params.arguments);
    const delayMs = toolLatency[toolName] || 0;
    const send = (): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(respBody);
    };
    if (delayMs > 0) {
      setTimeout(send, delayMs);
    } else {
      send();
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake-mempalace-inventory-mcp listening on 127.0.0.1:${PORT}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
