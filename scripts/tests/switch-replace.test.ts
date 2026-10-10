// switch-replace.test.ts — scripts/lib/service/daemon-replace.ts (spec 0252
// requirement 18): the replacement-window warning, the loopback-only bearer probe,
// the squatter eviction and the Windows restart. Split from switch-transaction.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceDaemonProcess } from "../lib/service/daemon-replace.ts";
import type { ProbeRequest } from "../lib/service/probe.ts";
import { serviceNames } from "../lib/service/names.ts";
import { backend } from "./lib/switch-fixture.ts";

function replaceFixture(accept: (n: number) => boolean) {
  const out: string[] = [];
  const err: string[] = [];
  const probes: ProbeRequest[] = [];
  const calls: string[] = [];
  let t = 0;
  const opts = {
    backend: { ...backend, stop: () => (calls.push("stop"), { ok: true } as const) },
    names: serviceNames("mcp", {}),
    host: "127.0.0.1",
    port: "41893",
    token: "SECRETTOKEN",
    env: {},
    home: "/h",
    io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) },
    probeFn: async (req: ProbeRequest) => (
      probes.push(req),
      accept(probes.length) ? { status: 200, body: "{}" } : { status: 401, body: "" }
    ),
    listener: () => null,
    parents: () => new Map<number, number>(),
    sleep: async (ms: number) => void (t += ms),
    now: () => t,
  };
  return { opts, out, err, probes, calls };
}

test("replacement: an already-accepting daemon is left alone and no warning is shown", async () => {
  const r = replaceFixture(() => true);
  assert.equal(await replaceDaemonProcess(r.opts), true);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.out, []);
});

test("replacement: the window warning precedes the restart; the probe carries the bearer to loopback only", async () => {
  const r = replaceFixture((n) => n >= 3);
  assert.equal(await replaceDaemonProcess(r.opts), true);
  assert.ok(r.out.some((l) => l.includes("WARNING: replacing the daemon frees 127.0.0.1:41893")));
  assert.deepEqual(r.calls, ["stop"]);
  for (const p of r.probes) {
    assert.equal(p.url, "http://127.0.0.1:41893/mcp");
    assert.equal(p.headers?.["authorization"], "Bearer SECRETTOKEN");
    assert.equal(p.method, "POST");
    assert.match(p.body ?? "", /"method":"tools\/list"/);
  }
});

test("replacement: expiry is reported as a failure", async () => {
  const r = replaceFixture(() => false);
  assert.equal(
    await replaceDaemonProcess({ ...r.opts, env: { MCP_DAEMON_REPLACE_DEADLINE: "1" } }),
    false,
  );
  assert.ok(r.err.some((l) => l.includes("did not accept the current token within 1s")));
});

test("replacement: a squatter is evicted with MEMPALACE_MCP_EVICT_CMD", async () => {
  const r = replaceFixture((n) => n >= 3);
  let listener: number | null = 999;
  const evicted: string[] = [];
  const ok = await replaceDaemonProcess({
    ...r.opts,
    env: { MEMPALACE_MCP_EVICT_CMD: "kill-it" },
    backend: { ...r.opts.backend, supervisorPid: () => ({ state: "pid", pid: 111 }) },
    listener: () => listener,
    evict: (c) => {
      evicted.push(c);
      listener = 111;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(evicted, ["kill-it"]);
  assert.ok(r.err.some((l) => l.includes("squatter PID 999 detected")));
});

test("replacement: a listener that descends from the supervised PID is the daemon, never evicted", async () => {
  const r = replaceFixture((n) => n >= 2);
  const kills: number[] = [];
  const ok = await replaceDaemonProcess({
    ...r.opts,
    backend: { ...r.opts.backend, supervisorPid: () => ({ state: "pid", pid: 200 }) },
    listener: () => 300,
    parents: () =>
      new Map([
        [300, 200],
        [200, 1],
      ]),
    kill: (pid) => void kills.push(pid),
  });
  assert.equal(ok, true);
  assert.deepEqual(kills, []);
  assert.equal(
    r.err.some((l) => l.includes("squatter")),
    false,
  );
});

test("replacement: an unreadable process table never makes a listener a squatter", async () => {
  const r = replaceFixture((n) => n >= 2);
  const kills: number[] = [];
  const ok = await replaceDaemonProcess({
    ...r.opts,
    backend: { ...r.opts.backend, supervisorPid: () => ({ state: "pid", pid: 200 }) },
    listener: () => 300,
    parents: () => null,
    kill: (pid) => void kills.push(pid),
  });
  assert.equal(ok, true);
  assert.deepEqual(kills, []);
});

test("replacement: on Windows the ended task is run again at once", async () => {
  const r = replaceFixture((n) => n >= 3);
  const calls: string[] = [];
  const ok = await replaceDaemonProcess({
    ...r.opts,
    backend: {
      ...r.opts.backend,
      kind: "schtasks",
      status: () => ({ registered: true, running: false }),
      stop: () => (calls.push("stop"), { ok: true } as const),
      start: () => (calls.push("start"), { ok: true } as const),
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["stop", "start"]);
});

test("replacement: a refused stop or start is reported, not left to the generic timeout", async () => {
  const r = replaceFixture((n) => n >= 3);
  const ok = await replaceDaemonProcess({
    ...r.opts,
    backend: {
      ...r.opts.backend,
      kind: "schtasks",
      status: () => ({ registered: true, running: false }),
      stop: () => ({ ok: false, reason: "stop refused" }),
      start: () => ({ ok: false, reason: "run refused" }),
    },
  });
  assert.equal(ok, true);
  assert.ok(r.err.some((l) => l.includes("the restart request failed: stop refused")));
  assert.ok(r.err.some((l) => l.includes("could not be run again: run refused")));
});

test("replacement: a daemon relaunched during the eviction is judged on a fresh table and PID", async () => {
  const r = replaceFixture((n) => n >= 3);
  let phase: "squatting" | "relaunched" = "squatting";
  const ok = await replaceDaemonProcess({
    ...r.opts,
    backend: {
      ...r.opts.backend,
      supervisorPid: () => ({ state: "pid", pid: phase === "squatting" ? 111 : 500 }),
    },
    listener: () => (phase === "squatting" ? 999 : 501),
    parents: () => new Map(phase === "squatting" ? [[999, 1]] : [[501, 500]]),
    kill: () => {
      phase = "relaunched";
    },
  });
  assert.equal(ok, true);
  assert.equal(
    r.err.some((l) => l.includes("failed to evict")),
    false,
  );
});
