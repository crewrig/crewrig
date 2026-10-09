// chroma-lifecycle.test.ts — black-box oracle of the ChromaDB trio (spec 0252
// requirements 13, 14, 22): start-, stop- and status-chroma-server run as
// `node scripts/<name>.ts` and, in a second block, through their `bash` shims,
// under an isolated HOME with a stub interpreter (tests/lib/chroma-stand-in.ts),
// a loopback heartbeat stub and MEMPALACE_CHROMA_HOST/PORT. Both blocks assert
// the same shell contract. Parts that spawn the daemon (a python3 stand-in) or
// signal it are POSIX-only and skip on win32; the rest run on every platform.
// The 15 s heartbeat deadline has no test seam, so that outcome is not tested.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  alive,
  daemonRecord,
  deadPid,
  dispose,
  heartbeatStub,
  hostPython,
  makeSandbox,
  run,
  sleeper,
  writePidFile,
  type Entry,
  type Sandbox,
} from "./lib/chroma-stand-in.ts";

const posix = process.platform !== "win32";
const python = hostPython();
const canSpawn = posix && python !== null;
const SKIP_SPAWN = canSpawn ? false : "needs a POSIX host with python3 on PATH";

const ENTRIES: Array<[string, Entry, boolean]> = [
  ["TypeScript entries", (n) => [process.execPath, [`scripts/${n}.ts`]], false],
  ["bash shims", (n) => ["bash", [`scripts/${n}.sh`]], !posix],
];

for (const [label, entry, skipBlock] of ENTRIES) {
  describe(
    `chroma trio, ${label}`,
    { skip: skipBlock ? "bash shims are POSIX-only" : false },
    () => {
      const boxes: Sandbox[] = [];
      afterEach(() => {
        for (const b of boxes.splice(0)) dispose(b);
      });
      const box = async (withChroma = true): Promise<Sandbox> => {
        const b = await makeSandbox(withChroma, python);
        boxes.push(b);
        return b;
      };
      const start = (b: Sandbox, extra = {}) => run(entry, "start-chroma-server", b, extra);
      const stop = (b: Sandbox) => run(entry, "stop-chroma-server", b);
      const status = (b: Sandbox) => run(entry, "status-chroma-server", b);
      const pidOf = (b: Sandbox) => Number(fs.readFileSync(b.pidFile, "utf8").trim());

      test(
        "start: starts, records the daemon's pid, appends to the log",
        { skip: SKIP_SPAWN },
        async () => {
          const b = await box();
          const r = start(b);
          assert.equal(r.status, 0, r.stderr);
          const pid = pidOf(b);
          assert.equal(daemonRecord(b).pid, pid, "PID file holds the daemon's pid");
          assert.match(
            r.stdout,
            new RegExp(`chroma server started \\(PID ${pid}, 127\\.0\\.0\\.1:${b.port}\\)`),
          );
          const log = fs.readFileSync(path.join(b.home, ".mempalace", "chroma-server.log"), "utf8");
          assert.match(log, /stand-in started/);
          const argv = daemonRecord(b).argv;
          assert.deepEqual(argv.slice(0, 1), ["run"]);
          assert.equal(argv[argv.indexOf("--path") + 1], path.join(b.home, ".mempalace", "palace"));
          assert.equal(argv[argv.indexOf("--port") + 1], String(b.port));
        },
      );

      test(
        "start: MEMPALACE_PALACE_PATH replaces the default palace",
        { skip: SKIP_SPAWN },
        async () => {
          const b = await box();
          const palace = path.join(b.home, "custom-palace");
          const r = start(b, { MEMPALACE_PALACE_PATH: palace });
          assert.equal(r.status, 0, r.stderr);
          const argv = daemonRecord(b).argv;
          assert.equal(argv[argv.indexOf("--path") + 1], palace);
        },
      );

      test("start: idempotent, same PID, exit 0", { skip: SKIP_SPAWN }, async () => {
        const b = await box();
        assert.equal(start(b).status, 0);
        const pid = pidOf(b);
        const again = start(b);
        assert.equal(again.status, 0);
        assert.match(again.stdout, new RegExp(`chroma server already running \\(PID ${pid}\\)`));
        assert.equal(pidOf(b), pid);
      });

      test(
        "start: a stale PID file is cleaned up with its message",
        { skip: SKIP_SPAWN },
        async () => {
          const b = await box();
          writePidFile(b, deadPid());
          const r = start(b);
          assert.equal(r.status, 0, r.stderr);
          assert.match(r.stdout, /Stale PID file detected — cleaning up\./);
          assert.equal(pidOf(b), daemonRecord(b).pid);
        },
      );

      test(
        "start: a daemon dying during startup ends with exit 1 and no PID file",
        { skip: SKIP_SPAWN },
        async () => {
          const b = await box();
          const r = start(b, { CHROMA_STUB_MODE: "die" });
          assert.equal(r.status, 1);
          assert.match(r.stderr, /ERROR: chroma server process died during startup\./);
          assert.match(r.stderr, /Check the log: .*chroma-server\.log/);
          assert.equal(fs.existsSync(b.pidFile), false);
        },
      );

      test("start: a missing interpreter is refused with exit 1", { skip: !posix }, async () => {
        const b = await box();
        const missing = path.join(b.home, "no-such-python");
        const r = start(b, { MEMPALACE_PYTHON: missing });
        assert.equal(r.status, 1);
        assert.match(r.stderr, new RegExp(`ERROR: Python interpreter not found at ${missing}`));
        assert.match(r.stderr, /Install MemPalace via pipx first\./);
      });

      test("start: a missing chroma binary is refused with exit 1", { skip: !posix }, async () => {
        const b = await box(false);
        fs.writeFileSync(b.python, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        const r = start(b);
        assert.equal(r.status, 1);
        assert.match(
          r.stderr,
          new RegExp(`ERROR: chroma binary not found at ${path.join(b.bin, "chroma")}`),
        );
        assert.match(r.stderr, /pipx inject mempalace 'chromadb>=/);
      });

      test("stop: graceful end removes the PID file", { skip: SKIP_SPAWN }, async () => {
        const b = await box();
        assert.equal(start(b).status, 0);
        const pid = pidOf(b);
        const r = stop(b);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, new RegExp(`chroma server stopped \\(was PID ${pid}\\)`));
        assert.equal(fs.existsSync(b.pidFile), false);
        assert.equal(alive(pid), false);
      });

      test(
        "stop: a daemon ignoring SIGTERM is forced after five seconds",
        { skip: SKIP_SPAWN },
        async () => {
          const b = await box();
          assert.equal(start(b, { CHROMA_STUB_MODE: "ignore-term" }).status, 0);
          const pid = pidOf(b);
          const t0 = Date.now();
          const r = stop(b);
          assert.equal(r.status, 0, r.stderr);
          assert.ok(Date.now() - t0 >= 4500, "waited for the five-second grace");
          assert.match(
            r.stderr,
            new RegExp(`WARN: chroma server \\(PID ${pid}\\) did not exit after SIGTERM`),
          );
          assert.match(r.stdout, new RegExp(`chroma server force-stopped \\(was PID ${pid}\\)`));
          assert.equal(fs.existsSync(b.pidFile), false);
          assert.equal(alive(pid), false);
        },
      );

      test("stop: nothing running, no PID file, heartbeat failed", async () => {
        const b = await box();
        const r = stop(b);
        assert.equal(r.status, 0);
        assert.match(
          r.stdout,
          new RegExp(
            `chroma server not running \\(no PID file, heartbeat failed at 127\\.0\\.0\\.1:${b.port}\\)`,
          ),
        );
      });

      test("stop: supervisor-managed daemon is reported and left alone", async () => {
        const b = await box();
        await heartbeatStub(b);
        const r = stop(b);
        assert.equal(r.status, 0, r.stderr);
        assert.match(
          r.stdout,
          new RegExp(
            `chroma server: RUNNING and supervisor-managed \\(127\\.0\\.0\\.1:${b.port}, no PID file\\)`,
          ),
        );
        assert.match(r.stdout, /Not stopped: a supervised daemon restarts immediately\./);
      });

      test("stop: a stale PID file is removed", async () => {
        const b = await box();
        writePidFile(b, deadPid());
        const r = stop(b);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /chroma server not running \(stale PID file removed\)/);
        assert.equal(fs.existsSync(b.pidFile), false);
      });

      test("status: HEALTHY with the PID, exit 0", { skip: SKIP_SPAWN }, async () => {
        const b = await box();
        assert.equal(start(b).status, 0);
        const r = status(b);
        assert.equal(r.status, 0);
        assert.match(
          r.stdout,
          new RegExp(`chroma server: HEALTHY \\(PID ${pidOf(b)}, 127\\.0\\.0\\.1:${b.port}\\)`),
        );
      });

      test("status: supervisor-managed daemon is HEALTHY, exit 0", async () => {
        const b = await box();
        await heartbeatStub(b);
        const r = status(b);
        assert.equal(r.status, 0);
        assert.match(
          r.stdout,
          new RegExp(`chroma server: HEALTHY \\(supervisor-managed, 127\\.0\\.0\\.1:${b.port}\\)`),
        );
      });

      test("status: no PID file and no heartbeat is NOT RUNNING, exit 1", async () => {
        const b = await box();
        const r = status(b);
        assert.equal(r.status, 1);
        assert.match(
          r.stdout,
          new RegExp(
            `chroma server: NOT RUNNING \\(no PID file, heartbeat failed at 127\\.0\\.0\\.1:${b.port}\\)`,
          ),
        );
      });

      test("status: a stale PID file is NOT RUNNING, exit 1", async () => {
        const b = await box();
        writePidFile(b, deadPid());
        const r = status(b);
        assert.equal(r.status, 1);
        assert.match(
          r.stdout,
          /chroma server: NOT RUNNING \(stale PID file: .*chroma-server\.pid\)/,
        );
      });

      test("status: a live process without a heartbeat is reported, exit 1", async () => {
        const b = await box();
        const pid = sleeper(b).pid ?? 0;
        writePidFile(b, pid);
        const r = status(b);
        assert.equal(r.status, 1);
        assert.match(
          r.stdout,
          new RegExp(
            `chroma server: PROCESS ALIVE \\(PID ${pid}\\) but heartbeat FAILED at 127\\.0\\.0\\.1:${b.port}`,
          ),
        );
      });
    },
  );
}
