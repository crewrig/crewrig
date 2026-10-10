// status-mcp-lifecycle-windows.test.ts — the Windows leg of the `status-mcp-server`
// oracle (spec 0252 requirements 15, 16, 22, 24), split from status-mcp-lifecycle.test.ts.
// It installs the MCP chain through the real installer under a throwaway task name, then
// asserts the owner verdict VERIFIED for the task's daemon and USURPED for a same-user
// listener the task did not start (real listener lookup, no seam), the `task:` line, the
// 5 s budget, and that `uninstall-mcp-daemon` leaves no task and no daemon. It skips
// elsewhere.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { parseLauncher } from "../lib/mempalace-registration.ts";
import { runManager } from "../lib/service/exec.ts";
import { createBackend } from "../lib/service/schtasks.ts";
import { newHome, root, runEntry, standIn } from "./lib/status-mcp-fixture.ts";
import type { Entry, Stand } from "./lib/status-mcp-fixture.ts";
import {
  alive,
  disposeChain,
  healthz,
  makeChain,
  readState,
  runId,
  waitFor,
} from "./lib/windows-service-fixture.ts";

/** The stand-in daemon of the MCP chain: as the fixture's, but POST /mcp answers 401. */
const DAEMON_401 = `const http = require("http"), fs = require("fs"), path = require("path");
const dir = __STATE_DIR__;
const state = path.join(dir, "state.json");
const a = process.argv, port = Number(a[a.indexOf("--port") + 1]);
const srv = http.createServer((q, r) => { q.resume(); r.statusCode = q.method === "POST" && q.url === "/mcp" ? 401 : q.url === "/healthz" ? 200 : 404; r.end("ok"); });
srv.listen(port, "127.0.0.1", () => fs.writeFileSync(state, JSON.stringify({ pid: process.pid, ppid: process.ppid, port })));
setInterval(() => {}, 1000);
`;

describe("status-mcp-server and uninstall-mcp-daemon against the installed MCP task", () => {
  test(
    "VERIFIED for the task's daemon, USURPED for a foreign listener, task: line, 5 s, uninstall",
    { skip: process.platform !== "win32" && "Windows Task Scheduler only" },
    async () => {
      const id = runId();
      const c = await makeChain("mcp", root, id, "status");
      // A second installed launcher record on another port: the endpoint a foreign
      // same-user listener holds, with no task behind it.
      const other = await makeChain("mcp", root, id, "squat");
      fs.writeFileSync(
        path.join(c.stateDir, "scripts", "lib", "mempalace-http-wrapper.py"),
        DAEMON_401.replace("__STATE_DIR__", JSON.stringify(c.stateDir)),
      );
      const backend = createBackend({ programPathOf: () => c.program });
      const home = newHome("win");
      const unit = c.names.unit;
      const envFor = (chain: typeof c): Record<string, string> => ({
        MEMPALACE_MCP_UNIT: unit,
        MEMPALACE_MCP_LAUNCHER_PATH: chain.paths.record,
        MEMPALACE_TLS_EXEC_PATH: chain.paths.wrapper,
      });
      const absent = (): boolean =>
        runManager("schtasks", ["/Query", "/TN", c.task]).kind === "nonzero";
      let squatter: Stand | null = null;
      try {
        const installed = backend.install(c.names, { definitionPath: c.definitionPath });
        assert.equal(installed.ok, true, JSON.stringify(installed));
        const state = await waitFor("daemon state", () => readState(c), 90_000);
        for (let i = 0; i < 60 && !(await healthz(state.port)); i++) {
          await new Promise((r) => setTimeout(r, 500));
        }

        const verified = await runEntry(entry0, "status-mcp-server", home, envFor(c));
        assert.match(verified.out, /owner:\s+VERIFIED/, verified.out);
        assert.match(verified.out, /^\s+task:\s+registered, /m, verified.out);
        assert.ok(verified.ms <= 5000, `status took ${verified.ms} ms, budget 5000 ms`);

        // The same-user listener the task did not start, on the endpoint the second
        // record names; the supervised task (this chain's) did not start it.
        const record = parseLauncher(fs.readFileSync(other.paths.record, "utf8"));
        assert.ok(record !== null, "the second launcher record parses");
        const otherPort = Number(record.port);
        squatter = await standIn(401, otherPort);
        const usurped = await runEntry(entry0, "status-mcp-server", home, {
          ...envFor(other),
          MEMPALACE_MCP_UNIT: unit,
        });
        assert.equal(usurped.status, 1, usurped.out);
        assert.match(usurped.out, /owner:\s+\*\*\* USURPED LISTENER \*\*\*/, usurped.out);

        const un = await runEntry(entry0, "uninstall-mcp-daemon", home, envFor(c));
        assert.equal(un.status, 0, un.out);
        assert.equal(absent(), true, "uninstall leaves no task");
        await waitFor("daemon gone", () => !alive(state.pid), 30_000);
        assert.equal(await healthz(state.port), false, "uninstall leaves no daemon");
      } finally {
        if (squatter !== null) await squatter.close();
        backend.uninstall(c.names);
        await disposeChain(c);
        await disposeChain(other);
      }
    },
  );
});

const entry0: Entry = (n) => [process.execPath, [`scripts/${n}.ts`]];
