// setup-hooks-stale-harness.ts — helpers of setup-hooks-stale-migration.test.ts (temporary world, fixtures, runner).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import type { SpawnResult } from "../lib/setup/context.ts";
import type { SetupDescriptor, StepId } from "../lib/setup/descriptor.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import { runSetup } from "../lib/setup/flow.ts";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures", "hooks-stale");
const STEPS: readonly StepId[] = ["hooks-rewrite-installed", "session-recording", "usage-capture"];
const SCRIPTS = ["usage-capture", "mempalace-transcript", "worktree-git-guard"];
export const STALE =
  /(usage-capture|mempalace-transcript|worktree-git-guard|antigravity-statusline-shim)\.sh/;
export const FOREIGN_VIEWER = "/opt/other-team/bin/usage-capture-viewer --tail";

export type Cli = "claude" | "gemini" | "copilot" | "antigravity";
const DESCRIPTORS: Record<Cli, SetupDescriptor> = {
  claude: claudeDescriptor,
  gemini: geminiDescriptor,
  copilot: copilotDescriptor,
  antigravity: antigravityDescriptor,
};

interface Fixture {
  primary: string;
  files: Record<string, unknown>;
  userCopies?: string[];
}

export const world = { root: "", home: "", repo: "" };

beforeEach(() => {
  let { root, home, repo } = world;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-stale-"));
  home = path.join(root, "home");
  repo = path.join(root, "repo");
  Object.assign(world, { root, home, repo });
  fs.mkdirSync(path.join(repo, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(repo, "scripts", "lib"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "lib", "node-floor-guard.js"), "");
  const real = path.resolve(HERE, "..", "..", "hooks");
  for (const f of fs.readdirSync(real).filter((n) => n.endsWith("-usage-capture-hooks.json"))) {
    fs.copyFileSync(path.join(real, f), path.join(repo, "hooks", f));
  }
  for (const s of [...SCRIPTS, "antigravity-statusline-shim"]) {
    fs.writeFileSync(path.join(repo, "hooks", `${s}.ts`), "");
  }
});
afterEach(() => {
  const { root } = world;
  if (root !== "" && root.startsWith(path.join(os.tmpdir(), "hooks-stale-"))) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Write the fixture of `cli` into the temporary home; returns the primary hook file. */
export function install(cli: Cli): Fixture & { file: string } {
  const { home, repo } = world;
  const text = fs
    .readFileSync(path.join(FIXTURES, `${cli}.json`), "utf8")
    .replaceAll("@REPO@", repo)
    .replaceAll("@HOME@", home);
  const fixture = JSON.parse(text) as Fixture;
  for (const [rel, content] of Object.entries(fixture.files)) {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  }
  for (const rel of fixture.userCopies ?? []) {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "#!/bin/sh\n");
  }
  return { ...fixture, file: path.join(home, fixture.primary) };
}

export interface Result {
  status: number | string;
  text: string;
}

export async function run(
  cli: Cli,
  opts: { answers?: string[]; floorFails?: boolean } = {},
): Promise<Result> {
  const { home, repo } = world;
  const stdin = new PassThrough();
  stdin.end();
  const lines: string[] = [];
  const sink = { write: (t: string) => void lines.push(t) };
  const spawn = (argv: readonly string[]): SpawnResult =>
    opts.floorFails === true &&
    argv[0] === "node" &&
    String(argv[1]).endsWith("node-floor-guard.js")
      ? { status: 1, stdout: "", stderr: "crewrig: Node.js >= 24 is required (test).\n" }
      : { status: 0, stdout: "", stderr: "" };
  let status: number | string;
  try {
    status = await runSetup(
      { ...DESCRIPTORS[cli], steps: STEPS },
      {
        argv: (opts.answers ?? []).flatMap((a) => ["--answer", a]),
        stdin,
        stdout: sink,
        stderr: sink,
        env: {
          HOME: home,
          PATH: process.env["PATH"],
          CREWRIG_USAGE_ROOT: path.join(home, ".crewrig", "usage"),
        },
        platform: "darwin",
        home,
        repoDir: repo,
        spawn,
        steps: {},
      },
    );
  } catch (error) {
    status = `threw ${error instanceof Error ? error.message : String(error)}`;
  }
  return { status, text: lines.join("") };
}

/** Every file under the home, relative path -> bytes. */
export function snapshot(): Map<string, string> {
  const { home, repo } = world;
  const map = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else map.set(path.relative(home, p), fs.readFileSync(p, "latin1"));
    }
  };
  walk(home);
  return map;
}

/** Every string value of a JSON tree. */
export function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (typeof x === "object" && x !== null) Object.values(x).forEach((y) => strings(y, out));
  return out;
}

export const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

/** Every JSON file of the home, parsed, for the `.sh` scan. */
export function staleLeft(): string[] {
  const { home, repo } = world;
  const left: string[] = [];
  for (const rel of snapshot().keys()) {
    if (!rel.endsWith(".json") || rel.includes(".bak")) continue;
    try {
      left.push(...strings(readJson(path.join(home, rel))).filter((s) => STALE.test(s)));
    } catch {
      /* not JSON */
    }
  }
  return left;
}

/** Framework commands (`hooks/<script>.ts`) per event, flattened as `event|command`. */
export function frameworkEntries(file: string): string[] {
  const found: string[] = [];
  const walk = (x: unknown, event: string): void => {
    if (Array.isArray(x)) x.forEach((y) => walk(y, event));
    else if (typeof x === "object" && x !== null) {
      const o = x as Record<string, unknown>;
      if (
        typeof o["command"] === "string" &&
        /hooks\/(usage-capture|mempalace-transcript|worktree-git-guard)\.ts/.test(o["command"])
      ) {
        found.push(`${event}|${o["command"]}`);
      }
      for (const [k, v] of Object.entries(o))
        if (k !== "command") walk(v, Array.isArray(v) && k !== "hooks" ? k : event);
    }
  };
  walk(readJson(file), "");
  return found;
}

export const backupsOf = (file: string): string[] =>
  fs
    .readdirSync(path.dirname(file))
    .filter((n) => n !== path.basename(file) && n.startsWith(path.basename(file)));
