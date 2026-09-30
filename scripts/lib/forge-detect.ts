// forge-detect.ts — forge detection, repository parsing, wire helpers, the
// GitLab note grammar and the Gitea version probe of the ticket-pickup adapters (spec 0244 R12; PLAN v2 step 2).
//
// Standard library only. `detectForge` ports `_detect_forge` from
// artifacts/library/skills/harness-curator/scripts/apply.py; the JSON guards
// keep every forge payload `unknown` until checked (no unsafe `any`).

import { norm } from "./ticket-ownership.ts";

export type Forge = "github" | "gitlab" | "gitea";

/** Outcome of one forge CLI invocation. */
export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * The single seam every adapter goes through: run `argv[0]` (gh, glab or tea)
 * with the remaining arguments. The CLI entry spawns the real tool; a test
 * injects a fake forge that answers each `api` argv in the forge's wire shape.
 */
export type Run = (argv: readonly string[]) => Promise<RunResult>;

/** A forge read or write that failed: the pickup maps it to exit 2 (R13). */
export class ForgeError extends Error {}

/** A repository location parsed from a git remote URL. */
export interface RepoRef {
  host: string;
  /** `owner/repo`, or `group/subgroup/project` on GitLab. */
  path: string;
  /** Git remote name the repository was resolved from; binds the `tea` login (i1-F2). */
  remote?: string;
}

/** `github.com` → github; `gitlab.com`, `gitlab.*` or a `CREWRIG_GITLAB_HOSTS` host → gitlab; else gitea. */
export function detectForge(host: string, env: NodeJS.ProcessEnv): Forge {
  const h = host.toLowerCase();
  if (h === "github.com") return "github";
  if (h === "gitlab.com" || h.startsWith("gitlab.")) return "gitlab";
  const allow = (env.CREWRIG_GITLAB_HOSTS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x !== "");
  return allow.includes(h) ? "gitlab" : "gitea";
}

/** Parse `https://host/o/r(.git)`, `ssh://git@host:22/o/r`, or scp-like `git@host:o/r.git`. */
export function parseRemote(url: string): RepoRef | null {
  const u = url.trim();
  let host: string;
  let rest: string;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u);
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(u);
  if (scheme?.[1] !== undefined && scheme[2] !== undefined) [host, rest] = [scheme[1], scheme[2]];
  else if (scp?.[1] !== undefined && scp[2] !== undefined) [host, rest] = [scp[1], scp[2]];
  else return null;
  const path = rest.replace(/\/+$/, "").replace(/\.git$/, "");
  if (!/^[^/]+(\/[^/]+)+$/.test(path)) return null;
  return { host: host.toLowerCase(), path };
}

// --- JSON guards -----------------------------------------------------------

export type Json = Record<string, unknown>;

export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ForgeError(`${what}: response is not JSON`);
  }
}

/** Parse newline-delimited JSON (the output of `gh api --paginate --jq '.[]'`). */
export function parseJsonLines(text: string, what: string): unknown[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => parseJson(l, what));
}

export function obj(v: unknown, what: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ForgeError(`${what}: expected an object`);
  }
  return v as Json;
}

export function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new ForgeError(`${what}: expected an array`);
  return v as unknown[];
}

export function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v === "") throw new ForgeError(`${what}: expected a string`);
  return v;
}

export function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new ForgeError(`${what}: expected a number`);
  return v;
}

export function time(v: unknown, what: string): number {
  const t = Date.parse(str(v, what));
  if (Number.isNaN(t)) throw new ForgeError(`${what}: not a timestamp`);
  return t;
}

/** Run a forge CLI call; a non-zero exit is a ForgeError naming the call. */
export async function call(run: Run, argv: readonly string[]): Promise<string> {
  let res: RunResult;
  try {
    res = await run(argv);
  } catch (err) {
    throw new ForgeError(`${argv.slice(0, 3).join(" ")}: ${(err as Error).message}`);
  }
  if (res.status !== 0) {
    const detail = res.stderr.trim().split("\n")[0] ?? "";
    throw new ForgeError(`${argv.slice(0, 4).join(" ")} failed (exit ${res.status}): ${detail}`);
  }
  return res.stdout;
}

// --- Record helpers shared by the adapters --------------------------------

export const PAGE = 50;

export function login(v: unknown, field: string, what: string): string {
  return norm(str(obj(v, what)[field], `${what}.${field}`));
}

export function logins(v: unknown, field: string, what: string): string[] {
  if (v === null || v === undefined) return [];
  return arr(v, what).map((u) => login(u, field, what));
}

export async function pages(
  run: Run,
  argv: (page: number) => string[],
  what: string,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= 200; page++) {
    const batch = arr(parseJson(await call(run, argv(page)), what), what);
    out.push(...batch);
    // Stop on an empty page only: a server may cap the page size below PAGE (i1-F3).
    if (batch.length === 0) return out;
  }
  throw new ForgeError(`${what}: more than 200 pages`);
}

// --- GitLab system-note grammar -------------------------------------------

const LIST = "@[\\w.-]+(?:(?:, | and |, and )@[\\w.-]+)*";
const NOTE_BOTH = new RegExp(`^assigned to (${LIST}) and unassigned (${LIST})$`);
const NOTE_ADD = new RegExp(`^assigned to (${LIST})$`);
const NOTE_REMOVE = new RegExp(`^unassigned (${LIST})$`);

/** System notes that embed user-chosen text, so "assign" in them says nothing about assignees. */
const QUOTING_NOTE =
  /^(?:changed (?:the )?(?:title|description|milestone)\b|(?:added|removed|scoped)\b[^\n]*~|added \d+ (?:new )?commits?\b|created branch\b|mentioned in\b)/i;

function handles(list: string): string[] {
  return [...list.matchAll(/@([\w.-]+)/g)].map((m) => norm(m[1] ?? ""));
}

/**
 * Parse one GitLab system note into assignment items. A note that mentions
 * assignment but fails the grammar is an unreadable record (R13): exit 2.
 */
export function parseGitlabNote(body: string): { user: string; op: "add" | "remove" }[] | null {
  const text = body.trim();
  const both = NOTE_BOTH.exec(text);
  if (both?.[1] !== undefined && both[2] !== undefined) {
    return [
      ...handles(both[2]).map((user) => ({ user, op: "remove" as const })),
      ...handles(both[1]).map((user) => ({ user, op: "add" as const })),
    ];
  }
  const add = NOTE_ADD.exec(text);
  if (add?.[1] !== undefined) return handles(add[1]).map((user) => ({ user, op: "add" as const }));
  const rm = NOTE_REMOVE.exec(text);
  if (rm?.[1] !== undefined) return handles(rm[1]).map((user) => ({ user, op: "remove" as const }));
  // Any other note that talks about assignment fails closed (i2-F1: `removed assignee`,
  // `removed all assignees`, `reassigned to @b`, …), except the notes whose wording
  // quotes free text — a title, label, milestone, commit or branch name (i1-F1).
  if (/assign/i.test(text) && !QUOTING_NOTE.test(text))
    throw new ForgeError(`unparsed GitLab assignment note: '${text}'`);
  return null;
}

// --- Gitea version probe (v2-F3) -------------------------------------------

/**
 * First Gitea release assumed to ship `POST`/`DELETE …/issues/{index}/assignees`
 * (v2-F3). Assumption from the 1.27-dev swagger, pending PLAN step 8.
 */
export const GITEA_ASSIGNEE_ENDPOINTS_MIN: readonly number[] = [1, 27, 0];

/** Gitea version of a `/version` payload; a Forgejo `x+gitea-1.22.0` string yields its Gitea part. */
export function giteaVersion(raw: string): number[] | null {
  const m = /gitea-(\d+)\.(\d+)\.(\d+)/.exec(raw) ?? /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function atLeast(v: readonly number[], min: readonly number[]): boolean {
  for (let i = 0; i < min.length; i++) {
    const a = v[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
