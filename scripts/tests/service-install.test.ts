// service-install.test.ts — scripts/lib/service/install.ts (spec 0252
// requirements 8 and 9): the 15-second health poll in 0.3 second steps, the
// shell's error text, and the rollback hook.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ServiceBackend, ServiceOutcome } from "../lib/service/backend.ts";
import { backendRollback, ensureMempalaceHome, installDaemon } from "../lib/service/install.ts";
import type { InstallOptions } from "../lib/service/install.ts";
import { serviceNames } from "../lib/service/names.ts";

const names = serviceNames("mcp", {});

function fakeBackend(log: string[], install: ServiceOutcome = { ok: true }): ServiceBackend {
  const ok = { ok: true } as const;
  return {
    kind: "systemd",
    install: () => (log.push("install"), install),
    start: () => ok,
    stop: () => ok,
    status: () => ({ registered: true, running: true }),
    uninstall: () => (
      log.push("uninstall"),
      { ok: true, detail: "  Supervisor was not loaded: x" }
    ),
    supervisorPid: () => ({ state: "none" }),
  };
}

function clock() {
  let t = 1_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

function options(dir: string, over: Partial<InstallOptions>): InstallOptions {
  return {
    backend: fakeBackend([]),
    names,
    definitionPath: path.join(dir, "units", "a.service"),
    materialise: (_t, dst) => (writeFileSync(dst, "unit"), { ok: true }),
    health: () => true,
    logHint: "~/.mempalace/mcp-server.log",
    ...over,
  };
}

function withDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "svc-install-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("a healthy daemon passes on the first poll with the shell's lines", () =>
  withDir(async (dir) => {
    const log: string[] = [];
    const c = clock();
    const r = await installDaemon(
      options(dir, {
        backend: fakeBackend(log, { ok: true, detail: "  Enabled and started: u.service" }),
        now: c.now,
        sleep: c.sleep,
      }),
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.lines, [
      `  Installed: ${path.join(dir, "units", "a.service")}`,
      "  Enabled and started: u.service",
    ]);
    assert.deepEqual(c.sleeps, []);
  }));

test("the poll sleeps 0.3 s between tries and succeeds when health turns true", () =>
  withDir(async (dir) => {
    const c = clock();
    let calls = 0;
    const r = await installDaemon(
      options(dir, { health: () => ++calls >= 4, now: c.now, sleep: c.sleep }),
    );
    assert.equal(r.ok, true);
    assert.equal(calls, 4);
    assert.deepEqual(c.sleeps, [300, 300, 300]);
  }));

test("an unhealthy daemon fails at the 15 s deadline with a diagnostic pass and the shell's text", () =>
  withDir(async (dir) => {
    const c = clock();
    let calls = 0;
    const log: string[] = [];
    const r = await installDaemon(
      options(dir, {
        backend: fakeBackend(log),
        health: () => (calls++, false),
        now: c.now,
        sleep: c.sleep,
        rollback: backendRollback(fakeBackend(log), names),
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(c.sleeps.length, 50);
    assert.equal(
      c.sleeps.reduce((a, b) => a + b, 0),
      15_000,
    );
    assert.equal(calls, 51, "50 polls plus the diagnostic call");
    assert.ok(r.lines.includes(`  ERROR: daemon '${names.label}' did not become healthy.`));
    assert.ok(r.lines.includes("         Inspect logs at ~/.mempalace/mcp-server.log and retry."));
    assert.ok(r.lines.includes("  Supervisor was not loaded: x"), "the rollback ran and said so");
    assert.deepEqual(log, ["install", "uninstall"]);
  }));

test("without a rollback the legacy shell behaviour stays: nothing is undone", () =>
  withDir(async (dir) => {
    const log: string[] = [];
    const c = clock();
    const r = await installDaemon(
      options(dir, {
        backend: fakeBackend(log),
        health: () => false,
        now: c.now,
        sleep: c.sleep,
        deadlineMs: 600,
      }),
    );
    assert.equal(r.ok, false);
    assert.deepEqual(log, ["install"]);
  }));

test("a failed registration prints its reason and rolls back", () =>
  withDir(async (dir) => {
    const log: string[] = [];
    const be = fakeBackend(log, { ok: false, reason: "  ERROR: launchctl load failed." });
    const r = await installDaemon(
      options(dir, { backend: be, rollback: backendRollback(be, names) }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.lines[1], "  ERROR: launchctl load failed.");
    assert.deepEqual(log, ["install", "uninstall"]);
  }));

test("a missing template stops before anything is written", () =>
  withDir(async (dir) => {
    const log: string[] = [];
    const r = await installDaemon(
      options(dir, { backend: fakeBackend(log), templatePath: path.join(dir, "nope.service") }),
    );
    assert.equal(r.ok, false);
    assert.match(
      r.lines[0] ?? "",
      /^ {2}ERROR: .*nope\.service missing — daemon supervisor unit not shipped\.$/,
    );
    assert.deepEqual(log, []);
    assert.equal(existsSync(path.join(dir, "units")), false);
  }));

test("a refused materialisation prints its reason and registers nothing", () =>
  withDir(async (dir) => {
    const log: string[] = [];
    const r = await installDaemon(
      options(dir, {
        backend: fakeBackend(log),
        materialise: () => ({ ok: false, reason: "  ERROR: refused." }),
      }),
    );
    assert.deepEqual(r, { ok: false, lines: ["  ERROR: refused."] });
    assert.deepEqual(log, []);
  }));

test("ensureMempalaceHome creates the home and the default palace, not an overridden one", () =>
  withDir((dir) => {
    assert.deepEqual(ensureMempalaceHome(dir, {}), { ok: true });
    assert.equal(existsSync(path.join(dir, ".mempalace", "palace")), true);
  }));

test("ensureMempalaceHome skips the palace with an override and fails on a file in the way", () =>
  withDir((dir) => {
    assert.deepEqual(ensureMempalaceHome(dir, { MEMPALACE_PALACE_PATH: "/elsewhere" }), {
      ok: true,
    });
    assert.equal(existsSync(path.join(dir, ".mempalace", "palace")), false);
    const blocked = path.join(dir, "blocked");
    writeFileSync(blocked, "file");
    const r = ensureMempalaceHome(blocked, {});
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.reason.includes("could not create the MemPalace home directory"));
  }));
