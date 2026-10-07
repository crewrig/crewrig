// mcp.d.ts — hand-written declaration file for the CommonJS
// baseline scripts/lib/usage-store/mcp.js (spec 0238 TypeScript rewrite of
// issue #1206; see scripts/lib/usage-store/inventory.ts's own header for the
// JS-interop rationale this file implements).
//
// mcp.js is NOT converted to TypeScript — out of scope; spec 0247 only added
// its `tokenPathNoCreate` export. This file declares the four read/delete
// inventory wrappers scripts/lib/usage-store/inventory.ts calls (listWings,
// listDrawers, getDrawer, deleteDrawer), plus `tokenPath` — read by
// scripts/tests/usage-inventory.test.ts, which computes the SAME hardcoded
// `$HOME/.mempalace/server/<hash>/token` path mcp.js's own call() reads, to
// seed a fake bearer token for its fixture daemon. `endpoint` and
// `tokenPathNoCreate` are read by the MemPalace transcript hook
// (scripts/lib/mempalace-transcript/, spec 0247 R13-R14, decision Q3), so
// endpoint and token path keep one definition. mcp.js's remaining exports
// (call, addDrawer, deleteBySource) are deliberately left undeclared — a
// partial declaration file is valid TypeScript.
//
// `McpResult`'s `result` field is typed `unknown`, never `any`: mcp.js's own
// header comment is explicit that these four wrappers are "thin
// pass-throughs with no invented success-field contract" — call()'s
// envelope decoder resolves a well-formed response to `{ok:true,
// result:<parsed payload>}` with NO validated shape, so inventory.ts (the
// domain-shape validator per that same header) is responsible for narrowing
// `result` defensively before trusting any of its fields. Typing it `unknown`
// enforces that narrowing at compile time instead of silently trusting an
// unverified shape (which `any` would do) — this is the reason a `.d.ts` was
// chosen at all: nothing here leaks an unsafe `any` into inventory.ts's own
// type surface (task lint-ts's oxlint-ts step forbids exactly that).

/** The outcome of one call() through mcp.js — see that module's own header for the three not-ok `kind`s (`transport`, `tool-error`, `tool-unavailable`). */
export type McpResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; kind: string; message?: string };

export interface ListDrawersArgs {
  wing?: string;
  room?: string;
  limit?: number;
  offset?: number;
}

export function listWings(): Promise<McpResult>;
export function listDrawers(args?: ListDrawersArgs): Promise<McpResult>;
export function getDrawer(drawerId: string): Promise<McpResult>;
export function deleteDrawer(drawerId: string): Promise<McpResult>;

/** The hardcoded `$HOME/.mempalace/server/<hash>/token` path call() reads its bearer token from; creates the palace's parent directory as a side effect (see this file's own header). */
export function tokenPath(): string;

/** The shared MemPalace MCP daemon endpoint: `MEMPALACE_MCP_HOST`/`MEMPALACE_MCP_PORT`, defaulting to `127.0.0.1`/`41893` (common.sh's own defaults). */
export function endpoint(): { host: string; port: string };

/** `tokenPath()` without its mkdir side effect: resolving it creates no file and no directory (spec 0247 R14). */
export function tokenPathNoCreate(): string;
