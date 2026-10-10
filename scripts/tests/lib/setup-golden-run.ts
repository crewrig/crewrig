// setup-golden-run.ts — run one golden case in a fresh sandbox and capture its observable result
// (spec 0256 requirement 7, plan v2 step A5). The shell setups only ever run through
// `createSetupSandbox(...).run(...)`: HOME and USERPROFILE point into the sandbox, PATH is the
// sandbox `bin` (stubs first, then the real tools a case names).

import fs from "node:fs";
import path from "node:path";

import type { Cli, GoldenCase } from "./setup-golden-types.ts";
import type { FzfRecord } from "./setup-stubs.ts";
import { installStubs, PLACEHOLDER_BEARER } from "./setup-stubs.ts";
import {
  baseStubs,
  commonTools,
  seedMempalaceVenv,
  startChromaHeartbeat,
} from "./setup-golden-common.ts";
import { DEFAULT_MCP_PORT, startGoldenDaemon } from "./setup-golden-daemon.ts";
import { translateAnswers, unusedIds, withoutIds } from "./setup-golden-answers.ts";
import { createSetupSandbox } from "./setup-sandbox.ts";
import type { Leg } from "./setup-sandbox.ts";
import { bakCountOf, normalize, readTokens, snapshot, treeOf } from "./setup-golden-tree.ts";
import type { Roots, TreeEntry } from "./setup-golden-tree.ts";

/** One call of the stub `curl`: the URL probed and the bearer sent (`<TOKEN>`, `<PLACEHOLDER>` or empty). */
export interface CurlRecord {
  readonly url: string;
  readonly bearer: string;
}

/** Everything a golden fixture stores for one case on one leg; text is already placeholdered. */
export interface CaseResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly tree: readonly TreeEntry[];
  /** `.bak.<STAMP>` files per backed-up target. */
  readonly bakCount: Readonly<Record<string, number>>;
  readonly fzfRecords: readonly FzfRecord[];
  /** The stub `curl` calls, oldest first (the daemon probes). */
  readonly curlRecords: readonly CurlRecord[];
}

/** The real tools exposed by default; a case adds more (`python3`) through `GoldenCase.tools`. */
export const DEFAULT_TOOLS: readonly string[] = ["jq", "git"];

/** The entry name of a setup: `setup-claude-interactive`. */
export const entryOf = (cli: Cli): string => `setup-${cli}-interactive`;

/** First executable regular file named `name` on the real PATH, or undefined. */
function realTool(name: string): string | undefined {
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/**
 * Symlink the named real tools into `bin`. A name already present (a stub) wins, so a symlink is
 * never written through; a tool absent from the host PATH is skipped (the suite guards on `jq`).
 */
function exposeTools(bin: string, names: readonly string[]): void {
  for (const name of names) {
    const target = path.join(bin, name);
    if (fs.existsSync(target)) continue;
    const real = realTool(name);
    if (real !== undefined) fs.symlinkSync(real, target);
  }
}

/**
 * Run the case on `leg` and return the normalised observable result. The TypeScript leg gets the
 * translated `--answer` arguments (setup-golden-answers.ts); the translation answers every question
 * the setup can ask, so a run that reports unused answers is run again without them and the
 * stderr compared is the setup's own.
 */
export function runCase(c: GoldenCase, leg: Leg, mcpPort?: McpPortMap): CaseResult {
  if (leg !== "ts") return runOnce(c, leg, [], mcpPort);
  const answers = translateAnswers(c);
  const first = runOnce(c, leg, answers, mcpPort);
  const unused = unusedIds(first.stderr);
  return unused.length === 0 ? first : runOnce(c, leg, withoutIds(answers, unused), mcpPort);
}

/** The port the ts leg's daemon stand-in really listens on, and the one the shell fixtures record for it. */
export interface McpPortMap {
  readonly actual: string;
  readonly shown: string;
}

/** Build a sandbox for the case, run its setup on `leg` with `extra` appended to its args. */
function runOnce(
  c: GoldenCase,
  leg: Leg,
  extra: readonly string[],
  mcpPort?: McpPortMap,
): CaseResult {
  const sb = createSetupSandbox(c.sandbox);
  try {
    const chromaPort = c.env?.["MEMPALACE_CHROMA_PORT"] ?? "";
    const stubs = installStubs(sb.bin, c.stubs);
    exposeTools(sb.bin, c.tools ?? DEFAULT_TOOLS);
    const before = snapshot(sb);
    c.seed?.(sb);
    const res = sb.run(entryOf(c.cli), [...(c.args ?? []), ...extra], {
      leg,
      ...(c.stdin === undefined ? {} : { stdin: c.stdin }),
      // The TypeScript service layer runs `/usr/bin/systemctl` (not the PATH stub) unless this test seam names
      // the stub directory: a runner with a real systemd would otherwise be driven for real.
      env: { ...c.env, ...(leg === "ts" ? { CREWRIG_TEST_SERVICE_BIN_DIR: sb.bin } : {}) },
    });
    const roots: Roots = {
      root: sb.root,
      repo: sb.repo,
      home: sb.home,
      secrets: readTokens(sb.home, PLACEHOLDER_BEARER),
      literals: [
        ...(/^\d+$/.test(chromaPort) ? ([[chromaPort, "<CHROMA_PORT>"]] as const) : []),
        // The suites of the four CLIs run in parallel: the stand-in takes a free port, shown as the fixtures' one.
        ...(mcpPort === undefined || mcpPort.actual === mcpPort.shown
          ? []
          : ([[mcpPort.actual, mcpPort.shown]] as const)),
      ],
    };
    const tree = treeOf(roots, before);
    const text = (value: string): string => normalize(value, roots);
    const bearerOf = (value: unknown): string => {
      const raw = typeof value === "string" ? value : "";
      return raw === PLACEHOLDER_BEARER ? "<PLACEHOLDER>" : text(raw);
    };
    return {
      status: res.status,
      stdout: text(res.stdout),
      stderr: text(res.stderr),
      tree,
      bakCount: bakCountOf(tree),
      fzfRecords: stubs.fzfRecords().map((r) => ({
        ...r,
        header: text(r.header),
        options: r.options.map(text),
        answer: text(r.answer),
      })),
      // A readiness poll repeats the same probe as often as the wall clock allows: keep one.
      curlRecords: stubs
        .records("curl")
        .map((r) => ({ url: text(String(r["url"] ?? "")), bearer: bearerOf(r["bearer"]) }))
        .filter((r, i, all) => i === 0 || JSON.stringify(r) !== JSON.stringify(all[i - 1])),
    };
  } finally {
    sb.dispose();
  }
}

/**
 * Run a real setup cell: the default stubs of the CLI under the case's own (a case's fzf answers
 * override the defaults per header), the common real tools, the pipx venv seed unless MemPalace is
 * declared missing, and a loopback Chroma heartbeat for `install_chroma_daemon`.
 */
export async function runSetupCase(c: GoldenCase, leg: Leg): Promise<CaseResult> {
  const base = baseStubs(c.cli);
  const stubs = { ...base, ...c.stubs, fzf: { ...base.fzf, ...c.stubs?.fzf } };
  const beat = await startChromaHeartbeat();
  // The TypeScript leg probes the daemon over real HTTP: a loopback stand-in takes the stub
  // `curl`'s decisions (setup-golden-daemon.ts, deviation tag (l)).
  const daemon =
    leg === "ts" ? await startGoldenDaemon({ probe: stubs.probe ?? 0, port: "0" }) : undefined;
  const shown = c.env?.["MEMPALACE_MCP_PORT"] ?? DEFAULT_MCP_PORT;
  try {
    return runCase(
      {
        ...c,
        stubs,
        tools: [...commonTools, ...(c.tools ?? [])],
        env: {
          MEMPALACE_CHROMA_PORT: String(beat.port),
          ...c.env,
          ...(daemon === undefined ? {} : { MEMPALACE_MCP_PORT: String(daemon.port) }),
        },
        seed: (sb) => {
          if (stubs.mempalaceMissing !== true) seedMempalaceVenv(sb);
          c.seed?.(sb);
        },
      },
      leg,
      daemon === undefined ? undefined : { actual: String(daemon.port), shown },
    );
  } finally {
    beat.stop();
    daemon?.stop();
  }
}
