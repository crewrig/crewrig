// setup-ensure-http-probes.test.ts — the probe sequence and the wait budget of ensureMempalaceHttp
// (scripts/lib/setup/ensure-http.ts) against a daemon that NEVER becomes healthy: the shell oracle
// (`ensure_mempalace_http`, scripts/lib/common.sh:1947) probes `/mcp` once with the real bearer,
// installs the supervisor, polls `/healthz` for ONE 15 s budget (`install_daemon_supervisor`,
// common.sh:914, step 0.3 s), then returns 1 without a second `/mcp` probe. The flow runs on fakes
// and a fake clock, with the production readiness loop (`installDaemon` of
// scripts/lib/service/install.ts) in the install seam, so a double poll (the install layer polling,
// then the flow polling again) or a second install shows up here as extra requests or extra time.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { ServiceBackend } from "../lib/service/backend.ts";
import { HEALTH_DEADLINE_MS, HEALTH_STEP_MS, installDaemon } from "../lib/service/install.ts";
import type { Spawner } from "../lib/setup/context.ts";
import { ensureMempalaceHttp } from "../lib/setup/ensure-http.ts";
import type { EnsureHttpDeps } from "../lib/setup/ensure-http.ts";

const TOKEN = "T".repeat(48);

/** One request the fake daemon saw: its path, the bearer class and the fake time it arrived at. */
interface Request {
  readonly path: "/mcp" | "/healthz";
  readonly bearer: "real" | "none";
  readonly at: number;
}

let dir: string;
let out: string[];
let clock: number;
let requests: Request[];
let installs: number;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-ensure-http-probes-")));
  out = [];
  clock = 0;
  requests = [];
  installs = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = () => ({
  io: { out: (l: string) => out.push(l), err: () => undefined, errRaw: () => undefined },
  env: {},
  platform: process.platform,
  home: dir,
  repoDir: dir,
});
const noSpawn: Spawner = () => ({ status: 0, stdout: "", stderr: "" });

const unused = (): never => {
  throw new Error("not used by the readiness loop");
};
/** A supervisor whose `install` succeeds; the daemon it starts never answers `/healthz`. */
const backend: ServiceBackend = {
  kind: "systemd",
  install: () => ({ ok: true }),
  start: unused,
  stop: unused,
  status: unused,
  uninstall: unused,
  supervisorPid: unused,
};

/**
 * The production install seam on a fake clock: the readiness loop of `installDaemon` with the
 * daemon answering `/healthz` from `healthyFrom` on (never when `Infinity`). Every poll is one
 * `/healthz` request, as one stub `curl` call is on the shell side.
 */
function install(healthyFrom: number): EnsureHttpDeps["installDaemon"] {
  return async () => {
    installs += 1;
    const result = await installDaemon({
      backend,
      names: { kind: "mcp", label: "com.crewrig.mempalace-mcp", unit: "crewrig-mempalace-mcp" },
      definitionPath: path.join(dir, "unit", "mcp.service"),
      materialise: () => ({ ok: true }),
      health: () => {
        requests.push({ path: "/healthz", bearer: "none", at: clock });
        return clock >= healthyFrom;
      },
      logHint: path.join(dir, "mcp-server.log"),
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    });
    return { ok: result.ok, lines: result.lines };
  };
}

/** Seams: the probe answers from `acceptFrom` on (never when `Infinity`), on the same clock. */
function deps(acceptFrom: number, healthyFrom: number): EnsureHttpDeps {
  return {
    readToken: () => TOKEN,
    probeAccepts: async (_host, _port, token) => {
      requests.push({ path: "/mcp", bearer: token === TOKEN ? "real" : "none", at: clock });
      return clock >= acceptFrom;
    },
    installDaemon: install(healthyFrom),
    backup: () => undefined,
    register: () => undefined,
    arrangement: () => "http",
    present: () => true,
  };
}

const run = (d: EnsureHttpDeps) =>
  ensureMempalaceHttp({ ctx: ctx(), cli: "claude", spawn: noSpawn, deps: d });

/** The sequence as the golden comparison sees it: consecutive identical records collapse to one. */
function collapsed(): string[] {
  return requests
    .map((r) => `${r.path} ${r.bearer}`)
    .filter((line, i, all) => i === 0 || line !== all[i - 1]);
}

describe("ensureMempalaceHttp: a daemon that never becomes healthy", () => {
  it("probes /mcp once, polls /healthz for one budget, then returns 1 without probing again", async () => {
    const rc = await run(deps(Infinity, Infinity));

    assert.equal(rc, 1);
    assert.deepEqual(collapsed(), ["/mcp real", "/healthz none"]);
    assert.equal(installs, 1, "the daemon is installed once");
    assert.equal(requests.filter((r) => r.path === "/mcp").length, 1, "no second /mcp probe");
    assert.equal(requests[0]?.at, 0);
  });

  it("waits one 15 s budget in steps of 0.3 s, not two", async () => {
    await run(deps(Infinity, Infinity));

    const polls = requests.filter((r) => r.path === "/healthz");
    // 50 polls in the loop, then the diagnostic poll of the failure path (the shell's `|| true`).
    assert.equal(polls.length, HEALTH_DEADLINE_MS / HEALTH_STEP_MS + 1);
    assert.equal(clock, HEALTH_DEADLINE_MS, "the whole wait is the install layer's one budget");
    assert.equal(polls.at(-1)?.at, HEALTH_DEADLINE_MS);
    assert.equal(polls.at(-2)?.at, HEALTH_DEADLINE_MS - HEALTH_STEP_MS);
    for (let i = 1; i < HEALTH_DEADLINE_MS / HEALTH_STEP_MS; i += 1) {
      assert.equal((polls[i]?.at ?? 0) - (polls[i - 1]?.at ?? 0), HEALTH_STEP_MS);
    }
  });

  it("reports the shell's refusal lines and the repair hint, once", async () => {
    await run(deps(Infinity, Infinity));

    const text = out.join("\n");
    assert.match(text, /Daemon not accepting on 127\.0\.0\.1:41893 — installing and starting it/);
    assert.equal(out.filter((l) => l.includes("did not become healthy")).length, 1);
    assert.equal(out.filter((l) => l.includes("the daemon supervisor refused")).length, 1);
    assert.equal(out.filter((l) => l.includes("Repair: run 'task mempalace:status'")).length, 1);
  });
});

describe("ensureMempalaceHttp: the probe sequence of the other arms", () => {
  it("a serving daemon is probed once and never installed", async () => {
    const rc = await run(deps(0, 0));

    assert.equal(rc, 0);
    assert.deepEqual(collapsed(), ["/mcp real"]);
    assert.equal(installs, 0);
    assert.equal(clock, 0);
  });

  it("a daemon that becomes healthy mid-budget stops the wait and is probed once more", async () => {
    const rc = await run(deps(900, 900));

    assert.equal(rc, 0);
    assert.deepEqual(collapsed(), ["/mcp real", "/healthz none", "/mcp real"]);
    assert.equal(installs, 1);
    assert.equal(clock, 900, "the wait ends at the first healthy poll, not at the budget");
    assert.equal(requests.filter((r) => r.path === "/mcp").length, 2);
  });

  it("a healthy daemon that still refuses the bearer ends with 1 after one budget, no re-install", async () => {
    const rc = await run(deps(Infinity, 0));

    assert.equal(rc, 1);
    assert.deepEqual(collapsed(), ["/mcp real", "/healthz none", "/mcp real"]);
    assert.equal(installs, 1);
    assert.equal(clock, 0);
    assert.ok(out.some((l) => l.includes("still refuses authenticated requests (R19)")));
  });
});
