// service-launcher-child.test.ts — the pure core of scripts/lib/service/
// launcher/launcher-child.ts with fakes, no real process (spec 0252
// requirement 11; plan v3 D6 cases 1 to 6, 10a).

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  endStatus,
  logLine,
  signalExitCode,
  stamp,
  superviseChild,
  type ChildLike,
  type StopSignal,
  type SuperviseOptions,
} from "../lib/service/launcher/launcher-child.ts";

class FakeChild extends EventEmitter implements ChildLike {
  readonly kills: string[] = [];
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.kills.push(signal);
    return true;
  }
}

function rig(extra: Partial<SuperviseOptions> = {}) {
  const child = new FakeChild();
  const handlers = new Map<StopSignal, () => void>();
  const exits: number[] = [];
  const logs: string[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  superviseChild({
    spawn: () => child,
    onSignal: (s, h) => handlers.set(s, h),
    exit: (c) => exits.push(c),
    log: (l) => logs.push(l),
    stopGraceMs: 0,
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => (t.cancelled = true);
    },
    ...extra,
  });
  return { child, handlers, exits, logs, timers };
}

test("1: a clean child exit while no stop was asked ends non-zero and says so", () => {
  const r = rig();
  r.child.emit("exit", 0, null);
  assert.deepEqual(r.exits, [1]);
  assert.match(r.logs.join("\n"), /child ended \(status 0\).*supervisor restarts it/);
});

test("2: a non-zero child status is kept", () => {
  const r = rig();
  r.child.emit("exit", 3, null);
  assert.deepEqual(r.exits, [3]);
});

test("3: a signal death maps to 128+signal", () => {
  const r = rig();
  r.child.emit("exit", null, "SIGKILL");
  assert.deepEqual(r.exits, [137]);
  assert.equal(signalExitCode("SIGTERM"), 143);
  assert.equal(endStatus(null, null, true), 1);
});

test("4: SIGTERM and SIGINT are forwarded; the stop then exits 0", () => {
  const r = rig();
  r.handlers.get("SIGTERM")?.();
  r.handlers.get("SIGINT")?.();
  assert.deepEqual(r.child.kills, ["SIGTERM", "SIGINT"]);
  assert.equal(r.timers.length, 1, "one escalation timer, not one per signal");
  assert.deepEqual(r.exits, []);
  r.child.emit("exit", null, "SIGTERM");
  assert.deepEqual(r.exits, [0]);
  assert.equal(r.timers[0]?.cancelled, true);
  assert.deepEqual(r.logs, [], "a requested stop logs no restart request");
});

test("5: a stop that exits the child with a non-zero status still exits 0", () => {
  const r = rig();
  r.handlers.get("SIGTERM")?.();
  r.child.emit("exit", 2, null);
  assert.deepEqual(r.exits, [0]);
});

test("6: a child that ignores SIGTERM is escalated to SIGKILL after the bound", () => {
  const r = rig({ killAfterMs: 1234 });
  r.handlers.get("SIGTERM")?.();
  assert.equal(r.timers[0]?.ms, 1234);
  r.timers[0]?.fn();
  assert.deepEqual(r.child.kills, ["SIGTERM", "SIGKILL"]);
  r.child.emit("exit", null, "SIGKILL");
  assert.deepEqual(r.exits, [0]);
});

test("unflagged wrapper: exits with the child's own status, status 0 included, silently", () => {
  const a = rig({ endNonzeroOnChildExit: false });
  a.child.emit("exit", 0, null);
  assert.deepEqual(a.exits, [0]);
  assert.deepEqual(a.logs, []);
  const b = rig({ endNonzeroOnChildExit: false });
  b.child.emit("exit", 7, null);
  assert.deepEqual(b.exits, [7]);
  const c = rig({ endNonzeroOnChildExit: false });
  c.child.emit("exit", null, "SIGTERM");
  assert.deepEqual(c.exits, [143]);
});

test("a spawn failure ends the process: 127 for a missing command, 126 otherwise", () => {
  const r = rig();
  r.child.emit("error", Object.assign(new Error("spawn x ENOENT"), { code: "ENOENT" }));
  assert.deepEqual(r.exits, [127]);
  const exits: number[] = [];
  superviseChild({
    spawn: () => {
      throw new Error("boom");
    },
    onSignal: () => {},
    exit: (c) => exits.push(c),
    log: () => {},
  });
  assert.deepEqual(exits, [126]);
});

test("log lines carry the shell's timestamp format", () => {
  assert.match(stamp(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d{4}$/);
  assert.match(logLine("x"), /^\S+ x$/);
});

test("a stop request that arrives within the grace after the child's end still counts as requested", () => {
  const r = rig({ stopGraceMs: 250 });
  r.child.emit("exit", null, "SIGTERM");
  assert.deepEqual(r.exits, [], "judged after the grace, not at once");
  assert.equal(r.timers[0]?.ms, 250);
  r.handlers.get("SIGTERM")?.();
  assert.equal(r.timers.length, 1, "no escalation timer for a child that already ended");
  r.timers[0]?.fn();
  assert.deepEqual(r.exits, [0]);
  assert.deepEqual(r.logs, [], "a requested stop logs no restart request");
});

test("without a stop request the end is judged after the grace, as before", () => {
  const r = rig({ stopGraceMs: 250 });
  r.child.emit("exit", null, "SIGTERM");
  assert.deepEqual(r.exits, []);
  r.timers[0]?.fn();
  assert.deepEqual(r.exits, [143]);
  assert.match(r.logs.join("\n"), /child ended \(signal SIGTERM\); ending with status 143/);
});
