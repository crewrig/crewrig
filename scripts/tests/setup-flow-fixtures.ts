// setup-flow-fixtures.ts — the fake descriptor, the fake steps and the runner shared by the
// setup-flow tests (not a test file itself).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach } from "node:test";

import type { Spawner } from "../lib/setup/context.ts";
import type {
  FlowDeps,
  SetupDescriptor,
  StepFn,
  StepId,
  StepRegistry,
} from "../lib/setup/descriptor.ts";
import { runSetup } from "../lib/setup/flow.ts";

const RULE = { src: "x", dest: "x", label: "x" };
export const NO_ANSWER =
  "Error: no answer for 'rules-action' (standard input is not a terminal); pass --answer rules-action=<value>";

export function descriptor(
  steps: readonly StepId[],
  cli: SetupDescriptor["cli"] = "claude",
): SetupDescriptor {
  return {
    cli,
    banner: "Fake Setup",
    steps,
    homes: { cliHome: ".fake", rulesDir: ".fake/rules", skillsDir: ".fake/skills" },
    rules: {
      existingGlob: "*.md",
      texts: {},
      sharedHeader: "",
      shared: [],
      store: RULE,
      pickOrder: ["team", "expertise", "level"],
      selections: { team: RULE, expertise: RULE, level: RULE },
      profile: { mode: "method", file: RULE },
    },
    hooks: {
      channel: "settings",
      file: "",
      src: "",
      envPatch: false,
      unusedCopy: "",
      leadingBlank: true,
    },
    strategies: { mcp: "claudeMcp", tiers: "standard", usageCapture: "settings" },
    storeGuidance: false,
    summary: {
      listHeader: "",
      listGlob: "",
      mcpHeader: "",
      mcpSource: "settings.json",
      extraLines: [],
    },
  };
}

/** The temporary home and repository of the running test (`useSandbox` creates and removes it). */
export const sandbox = { tmp: "" };

/**
 * The comparison form of printed text against a golden (a POSIX shell transcript): every `\\` is a
 * `/` and the sandbox root, in each spelling it can take (the temporary directory and its
 * `realpath.native`, which expands the 8.3 short names of Windows), is `<SANDBOX>`. Apply it to
 * BOTH sides, so the Linux-generated golden holds on a native Windows path.
 */
export function canon(text: string): string {
  const roots = new Set([
    sandbox.tmp,
    fs.realpathSync(sandbox.tmp),
    fs.realpathSync.native(sandbox.tmp),
  ]);
  let out = text.replaceAll("\\", "/");
  for (const root of [...roots]
    .map((r) => r.replaceAll("\\", "/"))
    .sort((a, b) => b.length - a.length))
    out = out.replaceAll(root, "<SANDBOX>");
  return out;
}

export function useSandbox(): void {
  beforeEach(() => void (sandbox.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "setup-flow-"))));
  afterEach(() => fs.rmSync(sandbox.tmp, { recursive: true, force: true }));
}

export interface Run {
  readonly status: number;
  readonly out: string;
  readonly err: string;
}

export async function run(
  d: SetupDescriptor,
  steps: StepRegistry,
  options: { argv?: string[]; stdin?: string; env?: Record<string, string>; spawn?: Spawner } = {},
): Promise<Run> {
  const stdin = new PassThrough();
  if (options.stdin !== undefined) stdin.write(options.stdin);
  stdin.end();
  const out: string[] = [];
  const err: string[] = [];
  const deps: FlowDeps = {
    argv: options.argv ?? [],
    stdin,
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    env: { HOME: sandbox.tmp, ...options.env },
    // The goldens are POSIX shell transcripts: the POSIX forms (the Windows ones are proven by the
    // Windows entry job).
    platform: "linux",
    home: sandbox.tmp,
    repoDir: sandbox.tmp,
    steps,
    ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
  };
  const status = await runSetup(d, deps);
  return { status, out: out.join(""), err: err.join("") };
}

/** A step that records its id and, when `ask` is set, asks the `rules-action` question. */
export function recorder(log: string[], id: string, ask = false): StepFn {
  return async ({ session }) => {
    log.push(id);
    if (ask)
      log.push(
        `${id}=${await session.choose({ id: "rules-action", header: "Rules?", options: ["keep", "refresh"], cancel: "abort" })}`,
      );
  };
}
