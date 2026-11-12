// skill-evals-fixtures.ts — shared fixtures of the skill eval runner suites (spec 0290 R25).
//
// Builds throwaway git repositories (never the real checkout) holding skills under
// `artifacts/core/skills/<name>/`, a fake `origin/main` ref, a stub `claude` binary that fails any
// model call, and a recording sink for the runner's output. No test using these touches the network
// or a model: credentials are unset, `fetch` is a throwing stub, the stub `claude` exits 99.
//
// Usage: const repo = makeRepo(); writeSkill(repo, "demo"); commitAll(repo, "x"); markOrigin(repo);

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findSkill, describeSkill, mergeBase } from "../../lib/skill-evals/select.ts";
import type { Selection } from "../../lib/skill-evals/select.ts";

export interface Repo {
  readonly root: string;
  git(...args: string[]): string;
  cleanup(): void;
}

export function makeRepo(): Repo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/acme/widgets.git");
  fs.writeFileSync(path.join(root, ".gitignore"), "__pycache__/\n.DS_Store\n.skill-evals/\n");
  return { root, git, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export const skillRel = (name: string, layer = "core"): string =>
  `artifacts/${layer}/skills/${name}`;

export function evalsJson(name: string, overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      skill_name: name,
      evals: [
        {
          id: 1,
          prompt: "Do the thing described in in.txt.",
          expected_output: "An answer file.",
          files: ["evals/files/in.txt"],
          expectations: ["The answer says it is a mock answer"],
          checks: [{ type: "file_exists", path: "answer.md" }],
        },
      ],
      trigger_probes: [{ query: "do the thing", should_trigger: true }],
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

export interface FileSpec {
  readonly content: string;
  readonly exec?: boolean;
}

/** Write a skill (defaults: SKILL.md, scripts/run.sh executable, references/ref.md, evals/) and stage it. */
export function writeSkill(
  repo: Repo,
  name: string,
  files: Record<string, string | FileSpec | null> = {},
  opts: { evals?: boolean } = {},
): void {
  const base = skillRel(name);
  const defaults: Record<string, string | FileSpec> = {
    "SKILL.md": `---\nname: ${name}\ndescription: A test skill.\n---\n\n# ${name}\n`,
    "scripts/run.sh": { content: "#!/bin/sh\necho hello\n", exec: true },
    "references/ref.md": "reference\n",
  };
  if (opts.evals !== false) {
    defaults["evals/evals.json"] = evalsJson(name);
    defaults["evals/files/in.txt"] = "input\n";
  }
  for (const [rel, spec] of Object.entries({ ...defaults, ...files })) {
    const abs = path.join(repo.root, base, rel);
    if (spec === null) {
      fs.rmSync(abs, { force: true });
      continue;
    }
    const f = typeof spec === "string" ? { content: spec } : spec;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
    fs.chmodSync(abs, f.exec === true ? 0o755 : 0o644);
  }
  repo.git("add", "-A");
  // the index mode follows the intended mode even on filesystems without permission bits
  for (const [rel, spec] of Object.entries({ ...defaults, ...files })) {
    if (spec === null) continue;
    const exec = typeof spec === "object" && spec.exec === true;
    repo.git("update-index", exec ? "--chmod=+x" : "--chmod=-x", `${base}/${rel}`);
  }
}

export function commitAll(repo: Repo, message: string): string {
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", message, "--allow-empty");
  return repo.git("rev-parse", "HEAD").trim();
}

/** Point `origin/main` at HEAD so the merge-base of later commits is this one. */
export function markOrigin(repo: Repo): void {
  repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

export function selectionOf(repo: Repo, name: string): Selection {
  const found = findSkill(repo.root, name);
  if ("error" in found) throw new Error(found.error);
  return describeSkill(repo.root, found.skill, mergeBase(repo.root, "origin/main"));
}

/** Account fields a real `claude auth status --json` prints and the runner must never keep (R41). */
export const DECOY_EMAIL = "decoy.person@example.invalid";
export const DECOY_ORG = "Decoy Organisation Name";

/** How the stub answers `claude auth status --json` (it always logs argv and environment first). */
export interface AuthStub {
  readonly loggedIn: boolean;
  /** Default: 0 when logged in, 1 otherwise. */
  readonly exitCode?: number;
  /** Replaces the JSON document (junk output, an array...). */
  readonly raw?: string;
  /** Never answers (the probe's timeout path). */
  readonly hang?: boolean;
}

/** One recorded invocation of a stub: `auth` (the probe), `executor`, `judge` or `model` (default body). */
export interface StubCall {
  readonly kind: "auth" | "executor" | "judge" | "model";
  readonly argv: string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly input?: string;
  /** Executor only: every path of the workspace at start, relative, recursive. */
  readonly listing?: string[];
}

const authPrelude = (auth: AuthStub): string => `
const __fs = require("fs");
const __argv = process.argv.slice(2);
const __log = (rec) => __fs.appendFileSync(__filename + ".calls.jsonl", JSON.stringify(rec) + "\\n");
if (__argv[0] === "auth" && __argv[1] === "status") {
  __log({ kind: "auth", argv: __argv, env: process.env, cwd: process.cwd() });
  ${
    auth.hang === true
      ? "setInterval(() => {}, 1000);"
      : `const __out = ${JSON.stringify(
          auth.raw ??
            JSON.stringify({
              loggedIn: auth.loggedIn,
              email: DECOY_EMAIL,
              orgName: DECOY_ORG,
              authMethod: "claude.ai",
            }),
        )};
  process.stdout.write(__out + "\\n", () => process.exit(${auth.exitCode ?? (auth.loggedIn ? 0 : 1)}));`
  }
} else {`;

const defaultModelBody = `
__log({ kind: "model", argv: __argv, env: process.env, cwd: process.cwd() });
process.stderr.write("model call is forbidden in tests\\n");
process.exit(99);`;

/**
 * A stub `claude`: `auth status --json` is answered per `auth` (default: not logged in, decoy
 * account fields) and logged to `<bin>.calls.jsonl`; any other invocation runs `body` (default: log a
 * `model` call and exit 99, so any model call fails).
 */
export function writeStubClaude(
  dir: string,
  body?: string,
  name = "claude-stub.js",
  auth: AuthStub = { loggedIn: false },
): string {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node${authPrelude(auth)}\n${(body ?? defaultModelBody).replace(/^#!.*\n/, "")}\n}\n`,
    { mode: 0o755 },
  );
  return file;
}

/** How the session stub behaves beyond its defaults (all optional). */
export interface SessionStubOptions {
  /** Executor and probe runs emit a `Skill` tool_use naming this skill (default: no tool call, text only). */
  readonly loadSkill?: string;
  /** Probe runs end with an `error_max_turns` result after their first message (the one-turn bound). */
  readonly probeMaxTurns?: boolean;
  /** 0-based indices of the judge process calls that exit non-zero (the transport failure the driver retries once). */
  readonly judgeFailCalls?: readonly number[];
  /** Replaces the judge's answer; the default is one PASS line per listed expectation. */
  readonly judgeAnswer?: string;
}

/**
 * A stub that plays all three children of the runner: the probe (per `auth`), the executor (argv holds
 * `stream-json`: writes answer.md, answers "the quick brown fox") and the judge (one numbered PASS line
 * per listed expectation, quoting it). A probe run is an executor run whose `--tools` is `Skill`. Every
 * call is recorded in `<bin>.calls.jsonl` (see `readCalls`).
 */
export function writeSessionStub(
  dir: string,
  auth: AuthStub,
  name = "claude-session.js",
  opts: SessionStubOptions = {},
): string {
  return writeStubClaude(
    dir,
    `
const __opts = ${JSON.stringify(opts)};
let __input = "";
process.stdin.on("data", (d) => (__input += d));
process.stdin.on("end", () => {
  const __exec = __argv.includes("stream-json");
  const __probe = __exec && __argv[__argv.indexOf("--tools") + 1] === "Skill";
  __log({ kind: __exec ? "executor" : "judge", argv: __argv, env: process.env, cwd: process.cwd(), input: __input, listing: __exec ? __fs.readdirSync(".", { recursive: true }).map(String).sort() : undefined });
  if (__exec) {
    if (!__probe) __fs.writeFileSync("answer.md", "x");
    const __content = [{ type: "text", text: "the quick brown fox" }];
    if (__opts.loadSkill) __content.push({ type: "tool_use", id: "t1", name: "Skill", input: { skill: __opts.loadSkill } });
    process.stdout.write(JSON.stringify({ type: "assistant", message: { id: "m1", content: __content } }) + "\\n");
    const __maxTurns = __probe && __opts.probeMaxTurns;
    process.stdout.write(JSON.stringify({ type: "result", subtype: __maxTurns ? "error_max_turns" : "success", is_error: __maxTurns ? true : false, total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 }, num_turns: 1, result: "done" }) + "\\n");
  } else {
    const __cf = __filename + ".judgecount";
    const __n = __fs.existsSync(__cf) ? Number(__fs.readFileSync(__cf, "utf8")) : 0;
    __fs.writeFileSync(__cf, String(__n + 1));
    if ((__opts.judgeFailCalls || []).includes(__n)) { process.stderr.write("transient judge failure\\n"); process.exit(1); }
    const __block = /EXPECTATIONS:\\n([\\s\\S]*?)\\n\\nTRANSCRIPT:/.exec(__input);
    const __count = __block ? __block[1].split("\\n").filter((l) => /^\\d+\\. /.test(l)).length : 1;
    process.stdout.write(__opts.judgeAnswer !== undefined ? __opts.judgeAnswer : Array.from({ length: __count }, (_, i) => (i + 1) + ' VERDICT=PASS EVIDENCE="the quick brown fox"').join("\\n") + "\\n");
  }
});`,
    name,
    auth,
  );
}

/** The calls a stub recorded, in order (empty when it was never run). */
export function readCalls(bin: string, kind?: StubCall["kind"]): StubCall[] {
  const file = `${bin}.calls.jsonl`;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as StubCall)
    .filter((c) => kind === undefined || c.kind === kind);
}

/** A sibling pair of directories: a temporary root for workspaces and a fake HOME that does not contain it. */
export function isolatedDirs(): { tempRoot: string; home: string; cleanup(): void } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-iso-"));
  const tempRoot = path.join(parent, "troot");
  const home = path.join(parent, "home");
  fs.mkdirSync(tempRoot);
  fs.mkdirSync(home);
  return { tempRoot, home, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

export function sink(): {
  out: string;
  err: string;
  io: { stdout: (s: string) => void; stderr: (s: string) => void };
} {
  const s = {
    out: "",
    err: "",
    io: { stdout: (x: string) => void (s.out += x), stderr: (x: string) => void (s.err += x) },
  };
  return s;
}

export const throwingFetch = (() => {
  throw new Error("network access is forbidden in tests");
}) as unknown as typeof fetch;

let safetyBin: string | undefined;
/** The shared stub every `cleanEnv` points `SKILL_EVALS_CLAUDE_BIN` at: not logged in, any model call exits 99. */
function safetyStub(): string {
  if (safetyBin === undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-safety-"));
    safetyBin = writeStubClaude(dir, undefined, "claude-safety.js");
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return safetyBin;
}

/**
 * An environment with no credential variable and no real PATH leakage of tokens. `claude` is a stub
 * that is not logged in and fails any model call, so a test that forgets its own seam never reaches
 * the real binary.
 */
export const cleanEnv = (
  extra: Record<string, string> = {},
): Record<string, string | undefined> => ({
  PATH: process.env["PATH"],
  LANG: "C",
  SKILL_EVALS_CLAUDE_BIN: safetyStub(),
  ...extra,
});

export function tmpDir(prefix = "skill-evals-out-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
