// setup-mcp-claude-gemini-fixtures.ts — the step environment, the scripted prompter and the fake
// `claude mcp` Spawner shared by the Claude and Gemini MCP step tests (not a test file itself).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type { ChromaInstallArgs } from "../lib/setup/chroma-types.ts";
import type { Cli, SpawnResult, Spawner } from "../lib/setup/context.ts";
import type { FlowDeps, FlowState, StepEnv } from "../lib/setup/descriptor.ts";
import type { EnsureRc } from "../lib/setup/mempalace-callsite.ts";
import type { PromptSession } from "../lib/setup/prompt.ts";
import { descriptor } from "./setup-flow-fixtures.ts";

export const PYTHON = "/venv/bin/python";
export const CHROMA_HEADER = "Installing shared ChromaDB HTTP daemon supervisor (issue #98)...";

export interface Harness {
  readonly env: StepEnv;
  readonly out: string[];
  readonly err: string[];
  /** The ids of the questions asked, in order. */
  readonly asked: string[];
  readonly home: string;
  readonly repo: string;
  readonly calls: string[][];
  readonly servers: Map<string, string>;
  cleanup(): void;
}

export interface HarnessOptions {
  readonly cli: Cli;
  readonly answers?: Readonly<Record<string, string>>;
  readonly seams?: Record<string, unknown>;
  /** The interpreter the detector finds, one entry per call (the last repeats); none by default. */
  readonly python?: readonly (string | undefined)[];
  readonly version?: string;
  readonly ensure?: EnsureRc;
  readonly chromaOk?: boolean;
  /** Server names whose `claude mcp add` fails. */
  readonly addFails?: readonly string[];
  readonly preRegistered?: readonly string[];
}

function result(status: number, stdout = ""): SpawnResult {
  return { status, stdout, stderr: "" };
}

/** A Spawner that models `claude mcp list|add|remove` and `python -c <version>`; anything else exits 0. */
export function fakeSpawner(
  servers: Map<string, string>,
  calls: string[][],
  version: string,
  addFails: readonly string[],
): Spawner {
  return (argv) => {
    calls.push([...argv]);
    if (argv[0] === "claude" && argv[1] === "mcp") {
      if (argv[2] === "list")
        return result(0, [...servers.keys()].map((n) => `${n}: x - Connected`).join("\n"));
      if (argv[2] === "remove") return result(servers.delete(argv[5] ?? "") ? 0 : 1);
      const dash = argv.indexOf("--");
      const name = argv[dash === -1 ? argv.length - 1 : dash - 1] ?? "";
      if (addFails.includes(name)) return result(1);
      servers.set(name, argv.slice(dash + 1).join(" "));
      return result(0);
    }
    if (argv.includes("-c")) return result(0, `${version}\n`);
    return result(0);
  };
}

export function harness(options: HarnessOptions): Harness {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-mcp-step-")));
  const repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, "config", "claude"), { recursive: true });
  fs.mkdirSync(path.join(repo, "config", "gemini"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(repo, "config", "claude", "settings.json.template"), "{}\n");
  fs.copyFileSync(
    path.join(import.meta.dirname, "..", "..", "config", "gemini", "settings.json"),
    path.join(repo, "config", "gemini", "settings.json"),
  );
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const calls: string[][] = [];
  const servers = new Map((options.preRegistered ?? []).map((n) => [n, "prior"]));
  const session: PromptSession = {
    choose: async (q) => {
      asked.push(q.id);
      return options.answers?.[q.id] ?? q.options[0];
    },
    confirm: async (id, _header, choices) => {
      asked.push(id);
      return options.answers?.[id] ?? choices?.[0];
    },
    close: () => undefined,
  };
  let detections = 0;
  const python = options.python ?? [];
  const seams: Record<string, unknown> = {
    detect: {
      detect: () => {
        const found = python[Math.min(detections, python.length - 1)];
        detections += 1;
        return found;
      },
    },
    offer: { pin: () => ({ min: "3.6.0", maxExclusive: "3.7" }) },
    installChroma: async (args: ChromaInstallArgs) => {
      args.ctx.io.out("");
      args.ctx.io.out(CHROMA_HEADER);
      args.ctx.io.out("  Installed: unit");
      return { ok: options.chromaOk ?? true };
    },
    ensure: async () => options.ensure ?? 0,
    now: () => new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
    ...options.seams,
  };
  const spawn = fakeSpawner(servers, calls, options.version ?? "3.6.0", options.addFails ?? []);
  const state: FlowState = {
    env: { HOME: home },
    skipRules: false,
    mempalaceInstalled: false,
    tlsVars: {},
    tlsWrote: false,
    srTranscriptWired: false,
    srAllHooksDisabled: false,
    agentsMdLines: 0,
    outcomes: [],
  };
  const deps: FlowDeps = {
    argv: [],
    stdin: new PassThrough(),
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
    env: state.env,
    platform: "linux",
    home,
    repoDir: repo,
    seams,
  };
  const d = descriptor(["mcp"], options.cli);
  const env: StepEnv = {
    descriptor: {
      ...d,
      strategies: { ...d.strategies, mcp: options.cli === "gemini" ? "geminiMcp" : "claudeMcp" },
    },
    ctx: {
      io: {
        out: (line) => void out.push(line),
        err: (line) => void err.push(line),
        errRaw: (text) => void err.push(text),
      },
      env: state.env,
      platform: "linux",
      home,
      repoDir: repo,
      cli: options.cli,
      link: false,
    },
    state,
    session,
    spawn,
    deps,
  };
  return {
    env,
    out,
    err,
    asked,
    home,
    repo,
    calls,
    servers,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}
