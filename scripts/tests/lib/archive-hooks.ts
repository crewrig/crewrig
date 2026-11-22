// archive-hooks.ts — the hook scripts of the framework archive, run from an extracted version directory under a
// hostile ancestor `package.json` (spec 0243 delta-05 R40; spec 0315 R11, R14). Shared by
// crewrig-module-type.test.ts and usage-archive-scopes.test.ts.
//
// A failed `import()` does not show: the entries catch it and exit as if there were nothing to do. Exit status and
// silence cannot prove the work was done, so every observer below checks what only a loaded module graph produces:
// journal records, the shim's prior line, the daemon diagnostics, the worktree guard's claim decision. An observer
// returns `good: false` with the reasons, so a test can demand success in one layout and failure in another.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, type Archive, type Rig } from "./launcher-rig.ts";
import { readTarGz } from "./tar-reader.ts";
import { payload as guardPayload, refusal } from "./guard-asserts.ts";
import { makeFixture, writeClaim } from "./worktree-fixtures.ts";

export const ANCESTORS = ["commonjs", "module", "typeless", "absent"] as const;
export type Ancestor = (typeof ANCESTORS)[number];

/** What a module-type problem looks like on a stream: an error or a warning of Node.js about `type`. */
export const MODULE_TYPE_NOISE =
  /MODULE_TYPELESS_PACKAGE_JSON|ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND|require is not defined|exports is not defined|__filename is not defined|Cannot use import statement|Unexpected token 'export'|Module type of file|Reparsing as ES module/;

/** The extracted archive: `<base>/.crewrig/versions/<version>`, under an ancestor package.json of the given type. */
export interface Cell {
  readonly rig: Rig;
  /** The version directory, the root of the archive. */
  readonly root: string;
  readonly ancestor: Ancestor;
  /** A fresh HOME for the run (no token file, no usage root). */
  readonly home: string;
}

export function extractArchive(archive: Archive, root: string): void {
  for (const record of readTarGz(archive.file)) {
    if (record.type !== "file") continue;
    const target = path.join(root, ...record.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, record.data, { mode: record.mode & 0o777 });
  }
}

const ANCESTOR_FILE: Record<Ancestor, string | null> = {
  commonjs: '{"type":"commonjs"}\n',
  module: '{"type":"module"}\n',
  typeless: '{"name":"hostile-ancestor"}\n',
  absent: null,
};

/** Extract `archive` under a version directory whose nearest ancestor package.json has the given type. */
export function makeCell(rig: Rig, archive: Archive, ancestor: Ancestor): Cell {
  const base = rig.newDir(`cell-${ancestor}`);
  const versions = path.join(base, ".crewrig", "versions");
  const root = path.join(versions, archive.version);
  fs.mkdirSync(root, { recursive: true });
  const text = ANCESTOR_FILE[ancestor];
  if (text !== null) fs.writeFileSync(path.join(versions, "package.json"), text);
  extractArchive(archive, root);
  const home = rig.newDir(`cell-home-${ancestor}`);
  return { rig, root, ancestor, home };
}

export interface Observation {
  /** Every observable of the delta-05 scenario holds. */
  readonly good: boolean;
  /** The observables that do not hold, for a failure message. */
  readonly why: string;
  /** A module-type error or warning (MODULE_TYPE_NOISE) reached a stream. */
  readonly noisy: boolean;
}

class Checks {
  readonly failures: string[] = [];
  noisy = false;
  /** Note whether a stream carries a module-type message. */
  stream(...texts: string[]): void {
    if (texts.some((text) => MODULE_TYPE_NOISE.test(text))) this.noisy = true;
  }
  check(condition: boolean, message: string): void {
    if (!condition) this.failures.push(message);
  }
  done(): Observation {
    return { good: this.failures.length === 0, why: this.failures.join("; "), noisy: this.noisy };
  }
}

function hookEnvironment(cell: Cell, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(crewrig_|mempalace_|node_options$|git_)/i.test(key)) env[key] = value;
  }
  env["HOME"] = cell.home;
  env["USERPROFILE"] = cell.home;
  return { ...env, ...extra };
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function node(
  cell: Cell,
  script: string,
  args: readonly string[],
  input: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Run {
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? cell.root,
    env: hookEnvironment(cell, options.env),
    input,
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** The journal records of a usage root: `journal/<cli>/<month>/<sha-256>.json` (not the attr and wing sidecars). */
export function journalRecords(usageRoot: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (/^[0-9a-f]{64}\.json$/.test(entry.name)) count += 1;
    }
  };
  walk(path.join(usageRoot, "journal"));
  return count;
}

const CLAUDE_TRANSCRIPT = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-capture",
  "claude-code",
  "2.1.x-jsonl",
  "session.jsonl",
);
const AGY_PAYLOAD = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-capture",
  "antigravity",
  "statusline-payload",
  "payload.json",
);

const PRIOR_LINE = "prior-status-line-known";

/** delta-05 R40: `usage-capture.ts` records the transcript once, and the second run records nothing. */
export function observeUsageCapture(cell: Cell): Observation {
  const checks = new Checks();
  const usage = cell.rig.newDir("usage-capture-root");
  const transcript = path.join(cell.rig.newDir("transcript"), "session.jsonl");
  fs.copyFileSync(CLAUDE_TRANSCRIPT, transcript);
  const script = path.join(cell.root, "hooks", "usage-capture.ts");
  const env = { CREWRIG_USAGE_ROOT: usage };
  const input = JSON.stringify({ transcript_path: transcript });

  const first = node(cell, script, ["claude-code", "Stop"], input, { env });
  const afterFirst = journalRecords(usage);
  const second = node(cell, script, ["claude-code", "Stop"], input, { env });

  checks.stream(first.stderr, second.stderr);
  for (const [label, run] of [
    ["first", first],
    ["second", second],
  ] as const) {
    checks.check(run.status === 0, `${label} run exits ${String(run.status)}`);
    checks.check(run.stderr === "", `${label} run writes to stderr: ${run.stderr.slice(0, 200)}`);
  }
  checks.check(afterFirst === 2, `the first run wrote ${afterFirst} journal records, not 2`);
  checks.check(journalRecords(usage) === afterFirst, "the second run wrote a record");
  return checks.done();
}

/** delta-05 R40: the shim runs the prior status-line command, then captures the snapshot. */
export function observeShim(cell: Cell): Observation {
  const checks = new Checks();
  const usage = cell.rig.newDir("shim-root");
  fs.mkdirSync(path.join(usage, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(usage, "state", "antigravity-statusline.json"),
    JSON.stringify({ priorStatusLineCommand: `echo ${PRIOR_LINE}` }),
  );
  const script = path.join(cell.root, "hooks", "antigravity-statusline-shim.ts");

  const run = node(cell, script, [], fs.readFileSync(AGY_PAYLOAD, "utf8"), {
    env: { CREWRIG_USAGE_ROOT: usage },
  });

  checks.stream(run.stderr, run.stdout);
  checks.check(run.status === 0, `exit ${String(run.status)}`);
  checks.check(run.stderr === "", `stderr: ${run.stderr.slice(0, 200)}`);
  checks.check(run.stdout.includes(PRIOR_LINE), "the prior command's line was not printed");
  checks.check(
    journalRecords(usage) === 1,
    `the statusline snapshot wrote ${journalRecords(usage)} records, not 1`,
  );
  return checks.done();
}

/** delta-05 R40: the transcript hook reaches its daemon call (two diagnostics) and exits 0. */
export function observeTranscript(cell: Cell): Observation {
  const checks = new Checks();
  const script = path.join(cell.root, "hooks", "mempalace-transcript.ts");

  const run = node(
    cell,
    script,
    ["claude-code"],
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" }),
    { env: { MEMPALACE_TRANSCRIPT_ENABLED: "1" } },
  );

  checks.stream(run.stderr);
  checks.check(run.status === 0, `exit ${String(run.status)}`);
  checks.check(
    /DAEMON_UNREACHABLE: token file not found at /.test(run.stderr),
    "no DAEMON_UNREACHABLE diagnostic",
  );
  checks.check(
    run.stderr.includes("mempalace-transcript: FAILED to persist user-prompt (rc=4): "),
    "no FAILED to persist diagnostic",
  );
  return checks.done();
}

/** delta-05 R40: the worktree guard refuses without a claim and allows with one (process cwd = the worktree, s8-F1). */
export function observeGuard(cell: Cell): Observation {
  const checks = new Checks();
  const fixture = makeFixture({ ticket: "T-1" });
  try {
    const script = path.join(cell.root, "hooks", "worktree-git-guard.ts");
    const input = guardPayload("git reset --hard", fixture.wt);
    const run = (): Run => node(cell, script, ["claude"], input, { cwd: fixture.wt });

    const unclaimed = run();
    checks.stream(unclaimed.stderr);
    checks.check(unclaimed.status === 1, `unclaimed exit ${String(unclaimed.status)}`);
    checks.check(unclaimed.stderr === refusal("T-1"), "unclaimed: not the refusal line");
    writeClaim(fixture, { holder: "alice" });
    const claimed = run();
    checks.check(
      claimed.status === 0 && claimed.stdout === "" && claimed.stderr === "",
      `claimed: exit ${String(claimed.status)}, output ${JSON.stringify(claimed.stdout + claimed.stderr).slice(0, 160)}`,
    );
  } finally {
    fixture.cleanup();
  }
  return checks.done();
}

/** `session-check-hooks.ts register claude`: the check is installed and one SessionStart entry written. */
export function observeSessionCheck(cell: Cell): Observation {
  const checks = new Checks();
  const script = path.join(cell.root, "scripts", "session-check-hooks.ts");

  const run = node(cell, script, ["register", "claude", "--platform", "linux"], "");

  checks.stream(run.stderr);
  checks.check(run.status === 0, `exit ${String(run.status)}: ${run.stderr.slice(0, 200)}`);
  const settings = path.join(cell.home, ".claude", "settings.json");
  checks.check(fs.existsSync(settings), "no settings.json was written");
  checks.check(
    fs.existsSync(path.join(cell.home, ".crewrig", "hooks", "session-check")),
    "the check was not installed",
  );
  return checks.done();
}

/** `node scripts/lib/node-floor-guard.js`: exit 0, silent. */
export function observeFloorGuard(cell: Cell): Observation {
  const checks = new Checks();

  const run = node(cell, path.join(cell.root, "scripts", "lib", "node-floor-guard.js"), [], "");

  checks.stream(run.stderr);
  checks.check(run.status === 0, `exit ${String(run.status)}: ${run.stderr.slice(0, 200)}`);
  checks.check(run.stdout === "" && run.stderr === "", "the guard is not silent");
  return checks.done();
}

export interface Item {
  readonly name: string;
  readonly observe: (cell: Cell) => Observation;
  /** Whether the item reaches an ECMAScript file the archive root must scope as a module. */
  readonly reachesEsm: boolean;
}

export const HOOK_ITEMS: readonly Item[] = [
  { name: "usage-capture.ts", observe: observeUsageCapture, reachesEsm: true },
  { name: "antigravity-statusline-shim.ts", observe: observeShim, reachesEsm: true },
  { name: "mempalace-transcript.ts", observe: observeTranscript, reachesEsm: true },
  { name: "worktree-git-guard.ts", observe: observeGuard, reachesEsm: true },
  { name: "session-check-hooks.ts", observe: observeSessionCheck, reachesEsm: true },
  { name: "node-floor-guard.js", observe: observeFloorGuard, reachesEsm: false },
];
