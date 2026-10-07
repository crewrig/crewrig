// session-check-config.ts — the hook entries of the MemPalace session-start
// check, and the backup-first, atomic, 0600 edits of each CLI's user-level hook
// file (spec 0246 R8, R9, R11). The CLI entry is scripts/session-check-hooks.ts.
//
// The check's entry is identified by its CONTENT, never by its position: a
// handler whose whole command is the hook template below, with an installed
// path ending in `/session-check/mempalace-session-check.ts` and this CLI's
// argument (plus, on Gemini CLI, the hook name; on Antigravity CLI, the
// named-hook key). Every other hook and every non-hook key is preserved.
// Pure: no I/O (the file edits live in scripts/session-check-hooks.ts).

import path from "node:path";
import type { Cli } from "./mempalace-registration.ts";

/** Gemini hook name and Antigravity named-hook key of the check. */
export const HOOK_NAME = "crewrig-mempalace-session-check";

/** Where setup installs the check, relative to the user's home (R9). */
export const INSTALL_DIR = path.join(".crewrig", "hooks", "session-check");
export const CHECK_FILE = "mempalace-session-check.ts";
const CHECK_SUFFIX = `/session-check/${CHECK_FILE}`;

/** Repository sources of the installed tree, relative to `scripts/`. */
export const INSTALLED_SOURCES: readonly string[] = [
  CHECK_FILE,
  "lib/mempalace-registration.ts",
  "lib/session-check-throttle.ts",
];

// --- hook command ---------------------------------------------------------------

const PREFIX = '{ N="';
const MID_NODE = '"; command -v "$N" >/dev/null 2>&1 || N=node; F="';
const MID_CHECK = '"; [ -f "$F" ] && command -v "$N" >/dev/null 2>&1 && "$N" --no-warnings "$F" ';
const SUFFIX = "; } 2>/dev/null; exit 0";

/** A character that would change the meaning of a double-quoted shell word. */
const UNSAFE = /["$\x60\\\x00-\x1f\x7f]/;
const SAFE_RUN = '[^"$\\x60\\\\\\x00-\\x1f\\x7f]';

/** True when `p` cannot be embedded in the double-quoted hook command. */
export function unsafePath(p: string): boolean {
  return UNSAFE.test(p);
}

/**
 * The POSIX hook command (plan v4 *Contracts*). It exits 0 with no output when
 * the recorded runtime, any `node` on PATH, or the installed check is missing.
 */
export function hookCommand(nodePath: string, checkPath: string, cli: Cli): string {
  for (const p of [nodePath, checkPath]) {
    if (p === "" || unsafePath(p)) {
      throw new Error(
        `the path ${JSON.stringify(p)} contains a character (" $ \` \\ or a control character) that cannot be wired safely into a hook command`,
      );
    }
  }
  return `${PREFIX}${nodePath}${MID_NODE}${checkPath}${MID_CHECK}${cli}${SUFFIX}`;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Content identity of the check's command for one CLI. */
export function isCheckCommand(command: unknown, cli: Cli): boolean {
  if (typeof command !== "string") return false;
  const re = new RegExp(
    `^${escapeRe(PREFIX)}${SAFE_RUN}+${escapeRe(MID_NODE)}${SAFE_RUN}*${escapeRe(CHECK_SUFFIX)}` +
      `${escapeRe(MID_CHECK)}${escapeRe(cli)}${escapeRe(SUFFIX)}$`,
  );
  return re.test(command);
}

// --- per-CLI location and entry -------------------------------------------------

/** The user-level hook file that carries the check's entry. */
export function hookFilePath(cli: Cli, home: string): string {
  switch (cli) {
    case "claude":
      return path.join(home, ".claude", "settings.json");
    case "gemini":
      return path.join(home, ".gemini", "settings.json");
    case "copilot":
      // A dedicated file: merge_session_recording_hooks replaces
      // copilot-transcript-hooks.json whole (usage-capture-optin.sh).
      return path.join(home, ".copilot", "hooks", `${HOOK_NAME}.json`);
    case "antigravity":
      return path.join(home, ".gemini", "config", "hooks.json");
  }
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = { [k: string]: Json };

export const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The handler the check registers, each with its CLI's own timeout key and
 * unit at 5 s (plan v3 *Contracts*, v1-F8).
 */
export function checkHandler(cli: Cli, command: string): Obj {
  switch (cli) {
    case "claude":
      return { type: "command", command, timeout: 5 };
    case "gemini":
      return { name: HOOK_NAME, type: "command", command, timeout: 5000 };
    case "copilot":
      return { type: "command", command, timeoutSec: 5 };
    case "antigravity":
      // Unit per agy's hooks.md, confirmed by plan step 1(a); the committed
      // hooks/antigravity-transcript-hooks.json uses the same key and scale.
      return { type: "command", command, timeout: 5 };
  }
}

function isOurHandler(h: unknown, cli: Cli): boolean {
  if (!isObj(h) || !isCheckCommand(h.command, cli)) return false;
  return cli !== "gemini" || h.name === HOOK_NAME;
}

/** Remove handlers matching `pred` from a flat event array; null when emptied by it. */
function stripFlat(list: Json[], pred: (h: unknown) => boolean): Json[] | null {
  const kept = list.filter((h) => !pred(h));
  return kept.length === 0 && list.length > 0 ? null : kept;
}

/** Same for a grouped event array (`[{matcher?, hooks: [handler…]}]`). */
function stripGrouped(list: Json[], pred: (h: unknown) => boolean): Json[] | null {
  const out: Json[] = [];
  for (const g of list) {
    if (isObj(g) && Array.isArray(g.hooks)) {
      const kept = g.hooks.filter((h) => !pred(h));
      if (kept.length === 0 && g.hooks.length > 0) continue; // emptied by the strip
      out.push(kept.length === g.hooks.length ? g : { ...g, hooks: kept });
    } else {
      out.push(g);
    }
  }
  return out.length === 0 && list.length > 0 ? null : out;
}

/** Remove the check's handlers from every event of a `hooks` map. */
function stripEvents(hooks: Obj, grouped: boolean, cli: Cli): Obj {
  const pred = (h: unknown): boolean => isOurHandler(h, cli);
  const out: Obj = {};
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) {
      out[event] = list;
      continue;
    }
    const kept = grouped ? stripGrouped(list, pred) : stripFlat(list, pred);
    if (kept === null) continue;
    out[event] = kept.length === list.length ? list : kept;
  }
  return out;
}

/** The document without any check entry of this CLI. Pure. */
export function stripEntry(cli: Cli, doc: Obj): Obj {
  const out = stripInPlace(cli, doc);
  // A `hooks` map this strip alone emptied goes too, so register-then-unregister
  // restores the original document. Copilot's dedicated file keeps `hooks: {}`.
  if (cli === "claude" || cli === "gemini") {
    const before = doc.hooks;
    if (
      isObj(before) &&
      Object.keys(before).length > 0 &&
      isObj(out.hooks) &&
      Object.keys(out.hooks).length === 0
    ) {
      const { hooks: _emptied, ...rest } = out;
      return rest;
    }
  }
  return out;
}

/** How many check handlers of this CLI the document's `hooks` map holds. */
function countOurs(cli: Cli, doc: Obj): number {
  if (!isObj(doc.hooks)) return 0;
  let n = 0;
  for (const list of Object.values(doc.hooks)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      // The same shapes stripEvents walks.
      const handlers = cli === "copilot" ? [e] : isObj(e) && Array.isArray(e.hooks) ? e.hooks : [];
      n += handlers.filter((h) => isOurHandler(h, cli)).length;
    }
  }
  return n;
}

/** The strip, keeping every key where it was (so a re-add does not reorder). */
function stripInPlace(cli: Cli, doc: Obj): Obj {
  if (cli === "antigravity") {
    const { [HOOK_NAME]: _ours, ...rest } = doc;
    return rest;
  }
  if (!isObj(doc.hooks)) return doc;
  return { ...doc, hooks: stripEvents(doc.hooks, cli !== "copilot", cli) };
}

/** The document with exactly one check entry of this CLI. Pure. */
export function addEntry(cli: Cli, doc: Obj, command: string): Obj {
  const handler = checkHandler(cli, command);
  // Replacing a named hook keeps its key where it was.
  if (cli === "antigravity") return { ...doc, [HOOK_NAME]: { PreInvocation: [handler] } };
  const event = cli === "copilot" ? "sessionStart" : "SessionStart";
  const element: Obj =
    cli === "claude"
      ? { matcher: "", hooks: [handler] }
      : cli === "gemini"
        ? { hooks: [handler] }
        : handler;
  // Already exactly one entry, in the expected form: leave the document as it
  // is, wherever the operator's own entries sit around it.
  const current = isObj(doc.hooks) ? doc.hooks[event] : undefined;
  const wanted = JSON.stringify(element);
  if (
    Array.isArray(current) &&
    current.filter((e) => JSON.stringify(e) === wanted).length === 1 &&
    countOurs(cli, doc) === 1
  ) {
    return doc;
  }
  const base = stripInPlace(cli, doc);
  const hooks: Obj = isObj(base.hooks) ? { ...base.hooks } : {};
  const prior = Array.isArray(hooks[event]) ? (hooks[event] as Json[]) : [];
  hooks[event] = [...prior, element];
  const next: Obj = { ...base, hooks };
  if (cli === "copilot" && !("version" in next)) return { version: 1, ...next };
  return next;
}
