// claude-child.ts — what every `claude` child of the skill eval runner shares (spec 0290 R32, R40,
// R41, R42 as modified by delta-03).
//
// The executor of every run, the headless judge driver and the login probe all run `claude` with
// the contributor's real HOME (and CLAUDE_CONFIG_DIR when set), isolated by flags instead of a
// throwaway home: ISOLATION_FLAGS. The environment of such a child is an allowlist
// (`childBaseEnv`) plus at most one credential variable (`childEnv`); `ANTHROPIC_API_KEY` is never
// in the allowlist. `probeLogin` runs `claude auth status --json` (no model call) and reads ONLY
// the `loggedIn` field: the e-mail address and organisation it prints are never kept. The probe
// result is memoised per binary + HOME + USER + CLAUDE_CONFIG_DIR, so it runs once per invocation
// (`resetLoginProbe` clears it). `checkTempRoot` refuses a temporary directory inside HOME or
// inside a git work tree, where a repository rule or a memory file of an ancestor could load.
//
// Binary: `claude`, or the path in SKILL_EVALS_CLAUDE_BIN (a test seam, not a documented knob).
// Usage: import { ISOLATION_FLAGS, childEnv, probeLogin, checkTempRoot } from "./claude-child.ts".
// Exit codes: not applicable (library; the runner maps a refusal to exit 3).
// Finding-line format: not applicable.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { API_KEY_VAR, TOKEN_VAR } from "./settings.ts";

/** R40: no user or local settings, no MCP server of the user, no session transcript. Never `--bare`. */
export const ISOLATION_FLAGS: readonly string[] = [
  "--setting-sources",
  "project",
  "--strict-mcp-config",
  "--no-session-persistence",
];

/** R42: the allowlist; each member is passed only when set in the runner's environment. */
const BASE_VARS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "USER",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

/** Wall clock allowed to `claude auth status --json` (a local command; the spec gives no value). */
const PROBE_TIMEOUT_MS = 15_000;

type Env = Readonly<Record<string, string | undefined>>;

export type LoginState = "logged-in" | "not-logged-in" | "cannot-start";

/** The allowlisted members of `base` that are set; no credential variable. */
export function childBaseEnv(base: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of BASE_VARS) {
    const v = base[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** `childBaseEnv` plus exactly the one credential variable, when there is one. */
export function childEnv(
  base: Env,
  credential?: { readonly name: string; readonly value: string },
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = childBaseEnv(base);
  if (credential !== undefined) out[credential.name] = credential.value;
  return out;
}

export const claudeBinary = (base: Env): string => base["SKILL_EVALS_CLAUDE_BIN"] || "claude";

export const INSTALL_HINT = "install Claude Code: https://docs.claude.com/en/docs/claude-code";

const cache = new Map<string, Promise<LoginState>>();

/** Forget the memoised probe results (a new invocation, or a test). */
export function resetLoginProbe(): void {
  cache.clear();
}

function runProbe(base: Env, tempRoot: string): Promise<LoginState> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (s: LoginState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(s);
    };
    let child;
    try {
      child = spawn(claudeBinary(base), ["auth", "status", "--json"], {
        cwd: tempRoot,
        env: childBaseEnv(base),
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return resolve("cannot-start");
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done("not-logged-in");
    }, PROBE_TIMEOUT_MS);
    child.on("error", () => done("cannot-start"));
    child.stdout.on("data", (d: Buffer) => void (stdout += d.toString("utf8")));
    child.on("close", (code) => {
      if (code !== 0) return done("not-logged-in");
      try {
        const doc: unknown = JSON.parse(stdout);
        const ok =
          typeof doc === "object" &&
          doc !== null &&
          !Array.isArray(doc) &&
          (doc as { loggedIn?: unknown }).loggedIn === true;
        done(ok ? "logged-in" : "not-logged-in");
      } catch {
        done("not-logged-in");
      }
    });
  });
}

/** R41: is the contributor logged in? Memoised; reads only `loggedIn`; makes no model call. */
export function probeLogin(base: Env, opts: { tempRoot: string }): Promise<LoginState> {
  const key = [claudeBinary(base), base["HOME"], base["USER"], base["CLAUDE_CONFIG_DIR"]].join(
    "\0",
  );
  let p = cache.get(key);
  if (p === undefined) {
    p = runProbe(base, opts.tempRoot);
    cache.set(key, p);
  }
  return p;
}

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

/** R32: a message when `tempRoot` is inside `home` or a git work tree, else undefined. */
export function checkTempRoot(tempRoot: string, home: string): string | undefined {
  const root = real(tempRoot);
  let reason: string | undefined;
  if (isInside(root, real(home))) reason = `inside your home directory (${real(home)})`;
  else {
    const r = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status === 0 && r.stdout.trim() === "true") reason = "inside a git work tree";
  }
  return reason === undefined
    ? undefined
    : `the temporary directory ${root} is ${reason}, where a repository rule or a memory file could load into the agent's context. ` +
        `Point TMPDIR at a directory outside your home and outside any repository (for example TMPDIR=/tmp). No model call was made.`;
}

/** R41: the login precondition failed; `keyUnrequested` when ANTHROPIC_API_KEY is set without --use-api-key. */
export function notLoggedInMessage(keyUnrequested: boolean): string {
  return (
    `You are not logged in to Claude Code. Run \`claude\` and log in, or set ${TOKEN_VAR}, ` +
    `or pass --use-api-key with ${API_KEY_VAR} set, or run with --mock.` +
    (keyUnrequested
      ? ` ${API_KEY_VAR} is set but was not requested: it is used only with --use-api-key.`
      : "") +
    " No model call was made."
  );
}

export function cannotStartMessage(base: Env): string {
  return `cannot start \`${claudeBinary(base)}\`: not found or not executable (${INSTALL_HINT}). No model call was made.`;
}
