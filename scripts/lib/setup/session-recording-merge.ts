// session-recording-merge.ts — the jq definitions of the session-recording merge as pure functions
// over JSON (`uc_all_handlers`, `uc_strip_by`, `uc_add`, `sr_merge`, `sr_report` of
// scripts/lib/usage-capture-optin.sh; spec 0256 requirement 30). The shape is `flat` (Copilot CLI:
// an event holds handlers) or grouped (Claude Code, Gemini CLI: an event holds groups). Layer 2.

import fs from "node:fs";

import { USAGE_CAPTURE, WORKTREE_GIT_GUARD, type WiredCli } from "../hook-descriptor.ts";
import { parseHandler } from "../hook-recognition.ts";
import { classifyHandler, foreignReason, OWN_CLASSES } from "../transcript-recognition.ts";

export type Json = Record<string, unknown>;
export type Pred = (handler: unknown) => boolean;
export interface Located {
  readonly event: string;
  readonly selector: Json | null;
  readonly handler: unknown;
}

export const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
export const flatOf = (cli: WiredCli): boolean => cli === "copilot";
export const withoutHooks = (group: Json): Json =>
  Object.fromEntries(Object.entries(group).filter(([key]) => key !== "hooks"));

/**
 * `sr_is_guard`: the merge owns the plain forms only. A guarded Windows command
 * (`GUARDED_PREFIX` then `node <abs>.ts`) belongs to the worktree-git-guard registration, so
 * the merge leaves it as an operator command beside the manifest's guard.
 */
export const isGuard: Pred = (h) => {
  const parsed = parseHandler(h, WORKTREE_GIT_GUARD);
  return parsed !== null && !parsed.guarded;
};
export const isTranscript: Pred = (h) => OWN_CLASSES.includes(classifyHandler(h));
export const isTranscriptAny: Pred = (h) => classifyHandler(h) !== "no";
export const isCapture: Pred = (h) =>
  parseHandler(h, USAGE_CAPTURE, { pathExists: isFile }) !== null;

/** `uc_all_handlers`: every handler as {event, selector, handler}, selector being the group minus `hooks`. */
export function allHandlers(doc: Json, flat: boolean): Located[] {
  const hooks = doc["hooks"];
  const found: Located[] = [];
  if (!isObj(hooks)) return found;
  for (const [event, value] of Object.entries(hooks)) {
    for (const entry of Array.isArray(value) ? value : []) {
      if (flat) found.push({ event, selector: null, handler: entry });
      else if (isObj(entry) && Array.isArray(entry["hooks"])) {
        const selector = withoutHooks(entry);
        for (const handler of entry["hooks"]) found.push({ event, selector, handler });
      }
    }
  }
  return found;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => deepEqual(x, b[i]))
    );
  }
  if (isObj(a) && isObj(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return a === b;
}

/** `uc_strip_by` with the R12 pruning rule: a group, an event and (grouped shapes) `.hooks` go only when this strip emptied them. */
export function stripBy(doc: Json, flat: boolean, own: Pred): Json {
  const hooks = doc["hooks"];
  if (!isObj(hooks)) return doc;
  const next: Json = {};
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      next[event] = value;
      continue;
    }
    const kept: unknown[] = flat
      ? value.filter((h: unknown) => !own(h))
      : value.flatMap((group: unknown): unknown[] => {
          if (!isObj(group) || !Array.isArray(group["hooks"])) return [group];
          const left = group["hooks"].filter((h) => !own(h));
          return group["hooks"].length > 0 && left.length === 0 ? [] : [{ ...group, hooks: left }];
        });
    if (value.length > 0 && kept.length === 0) continue;
    next[event] = kept;
  }
  const out: Json = { ...doc, hooks: next };
  if (!flat && Object.keys(hooks).length > 0 && Object.keys(next).length === 0) delete out["hooks"];
  return out;
}

/** `uc_add`: grouped shapes join the first group with the same selector, else open one; throws like jq's `error`. */
export function add(doc: Json, x: Located, flat: boolean): void {
  if (doc["hooks"] === undefined || doc["hooks"] === null) doc["hooks"] = {};
  else if (!isObj(doc["hooks"])) throw new Error("hooks is not an object");
  const hooks = doc["hooks"] as Json;
  if (hooks[x.event] === undefined || hooks[x.event] === null) hooks[x.event] = [];
  else if (!Array.isArray(hooks[x.event])) throw new Error("hook event is not an array");
  const entries = hooks[x.event] as unknown[];
  if (flat) {
    entries.push(x.handler);
    return;
  }
  const selector = x.selector ?? {};
  const group = entries.find(
    (g) => isObj(g) && Array.isArray(g["hooks"]) && deepEqual(withoutHooks(g), selector),
  ) as Json | undefined;
  if (group === undefined) entries.push({ ...selector, hooks: [x.handler] });
  else (group["hooks"] as unknown[]).push(x.handler);
}

/** `sr_merge`: refresh the guard and transcript handlers the manifest carries; spare the kinds it does not. */
export function srMerge(config: Json, manifest: Json, flat: boolean): Json {
  const incoming = allHandlers(manifest, flat);
  const guard = incoming.some((x) => isGuard(x.handler));
  const transcript = incoming.some((x) => isTranscript(x.handler));
  const doc = stripBy(
    structuredClone(config),
    flat,
    (h) => (guard && isGuard(h)) || (transcript && isTranscript(h)),
  );
  for (const x of incoming) {
    const held = allHandlers(doc, flat).some(
      (y) => y.event === x.event && isTranscriptAny(y.handler),
    );
    if (!(isTranscriptAny(x.handler) && held)) add(doc, x, flat);
  }
  return doc;
}

/** `sr_report`: one line per foreign-prefix transcript command left on an event the manifest registers one for. */
export function srReport(config: Json, manifest: Json, flat: boolean): string[] {
  const incoming = allHandlers(manifest, flat).filter((x) => isTranscript(x.handler));
  const lines: string[] = [];
  for (const event of [...new Set(incoming.map((x) => x.event))].sort()) {
    const here = allHandlers(config, flat)
      .filter((x) => x.event === event)
      .map((x) => x.handler);
    const own = here.filter(isTranscript).length;
    for (const h of here.filter((x) => classifyHandler(x) === "foreign-prefix")) {
      const command = (h as Json)["command"] as string;
      const match =
        /"[^"]*\/mempalace-transcript\.(?:sh|ts)"|'[^']*\/mempalace-transcript\.(?:sh|ts)'|[^\s"']*\/mempalace-transcript\.(?:sh|ts)/.exec(
          command,
        );
      if (match === null) continue;
      const script = match[0].replace(/^["']|["']$/g, "");
      lines.push(
        `  Session recording: left ${script} on ${event} (${foreignReason(command)}); removed ${own} own transcript command(s) there and added none.`,
      );
    }
  }
  return lines;
}
