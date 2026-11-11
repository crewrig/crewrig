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

export const skillRel = (name: string, layer = "core"): string => `artifacts/${layer}/skills/${name}`;

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

/** A stub `claude` that records its invocation in $STUB_LOG and exits 99 (any model call fails). */
export function writeStubClaude(dir: string, body?: string): string {
  const file = path.join(dir, "claude-stub.js");
  fs.writeFileSync(
    file,
    body ??
      `#!/usr/bin/env node\nrequire("fs").appendFileSync(process.env.STUB_LOG || "/dev/null", "called\\n");\nprocess.stderr.write("model call is forbidden in tests\\n");\nprocess.exit(99);\n`,
    { mode: 0o755 },
  );
  return file;
}

export function sink(): { out: string; err: string; io: { stdout: (s: string) => void; stderr: (s: string) => void } } {
  const s = { out: "", err: "", io: { stdout: (x: string) => void (s.out += x), stderr: (x: string) => void (s.err += x) } };
  return s;
}

export const throwingFetch = (() => {
  throw new Error("network access is forbidden in tests");
}) as unknown as typeof fetch;

/** An environment with no credential variable and no real PATH leakage of tokens. */
export const cleanEnv = (extra: Record<string, string> = {}): Record<string, string | undefined> => ({
  PATH: process.env["PATH"],
  LANG: "C",
  ...extra,
});

export function tmpDir(prefix = "skill-evals-out-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
