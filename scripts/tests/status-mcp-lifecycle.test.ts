// status-mcp-lifecycle.test.ts — black-box oracle of `status-mcp-server` (spec 0252
// requirements 15, 16, 22, 24), run as `node scripts/status-mcp-server.ts` and
// through its `bash` shim, against loopback stand-ins. The `MEMPALACE_MCP_HOST`,
// `MEMPALACE_MCP_PORT`, `MEMPALACE_MCP_LAUNCHER_PATH`, `MEMPALACE_MCP_LISTENER_PID`
// and `MEMPALACE_MCP_EXPECTED_PID` seams drive the POSIX legs (the owner seams keep
// their set-but-empty-means-undeterminable meaning). The Windows leg installs the
// MCP chain through the real installer under a throwaway task name, then asserts the
// owner verdict VERIFIED for the task's daemon and USURPED for a same-user listener
// the task did not start (real listener lookup, no seam), the `task:` line, the 5 s
// budget, and that `uninstall-mcp-daemon` leaves no task and no daemon. The POSIX
// legs skip on win32 and the Windows leg skips elsewhere.
// The Windows leg lives in status-mcp-lifecycle-windows.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { ENTRIES, newHome, runEntry, standIn } from "./lib/status-mcp-fixture.ts";
import { freePort } from "./lib/windows-service-fixture.ts";

for (const [label, entry, skip] of ENTRIES) {
  describe(`status-mcp-server, ${label}`, { skip }, () => {
    const seams = (home: string, port: number, extra: Record<string, string> = {}) => ({
      MEMPALACE_MCP_HOST: "127.0.0.1",
      MEMPALACE_MCP_PORT: String(port),
      MEMPALACE_MCP_LAUNCHER_PATH: path.join(home, "no-launcher.sh"),
      ...extra,
    });

    test("endpoint down: NOT SERVING, exit 1, the missing log is stated", async () => {
      const home = newHome("down");
      const port = await freePort();
      const r = await runEntry(entry, "status-mcp-server", home, seams(home, port));
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, new RegExp(`endpoint: http://127\\.0\\.0\\.1:${port}/mcp`));
      assert.match(r.out, /state:\s+NOT SERVING/);
      assert.match(r.out, /\(no log at .*mcp-server\.log\)/);
      assert.doesNotMatch(r.out, /^\s+auth:/m);
      assert.doesNotMatch(r.out, /^\s+owner:/m);
    });

    test("endpoint down with a log: the last lines are tailed", async () => {
      const home = newHome("tail");
      fs.mkdirSync(path.join(home, ".mempalace"), { recursive: true });
      fs.writeFileSync(path.join(home, ".mempalace", "mcp-server.log"), "probe log line\n");
      const port = await freePort();
      const r = await runEntry(entry, "status-mcp-server", home, seams(home, port));
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /probe log line/);
      assert.match(r.out, /--- last 20 lines of /);
    });

    test("healthz up with 401: authentication ENFORCED, no header carries a token", async () => {
      const home = newHome("auth");
      const s = await standIn(401);
      try {
        const r = await runEntry(
          entry,
          "status-mcp-server",
          home,
          seams(home, s.port, {
            MEMPALACE_MCP_LISTENER_PID: "4242",
            MEMPALACE_MCP_EXPECTED_PID: "4242",
          }),
        );
        assert.match(r.out, /state:\s+HEALTHY/);
        assert.match(r.out, /auth:\s+ENFORCED \(unauthenticated \/mcp refused\)/);
        assert.deepEqual(s.authSeen, [], "the probe sends no Authorization header");
      } finally {
        await s.close();
      }
    });

    test("healthz up with 200 on tools/list: NOT ENFORCED, exit 1", async () => {
      const home = newHome("open");
      const s = await standIn(200);
      try {
        const r = await runEntry(entry, "status-mcp-server", home, seams(home, s.port));
        assert.equal(r.status, 1, r.out);
        assert.match(
          r.out,
          /\*\*\* NOT ENFORCED \*\*\* \(unauthenticated \/mcp returned 200, expected 401\)/,
        );
        assert.doesNotMatch(r.out, /^\s+owner:/m, "the owner section only runs while healthy");
      } finally {
        await s.close();
      }
    });

    test("owner seams: VERIFIED, USURPED (exit 1) and UNVERIFIABLE when set but empty", async () => {
      const home = newHome("owner");
      const s = await standIn(401);
      try {
        const run = (listener: string, expected: string) =>
          runEntry(
            entry,
            "status-mcp-server",
            home,
            seams(home, s.port, {
              MEMPALACE_MCP_LISTENER_PID: listener,
              MEMPALACE_MCP_EXPECTED_PID: expected,
            }),
          );
        const verified = await run("4242", "4242");
        assert.match(verified.out, /owner:\s+VERIFIED/);
        const usurped = await run("4242", "4343");
        assert.equal(usurped.status, 1, usurped.out);
        assert.match(usurped.out, /owner:\s+\*\*\* USURPED LISTENER \*\*\*/);
        assert.match(usurped.out, /PID 4242 is answering/);
        const unknown = await run("4242", "");
        assert.equal(unknown.status, 1, unknown.out);
        assert.match(unknown.out, /owner:\s+UNVERIFIABLE/);
      } finally {
        await s.close();
      }
    });

    test("launcher section: NOT INSTALLED, drift UNKNOWN and DRIFTED", async () => {
      const home = newHome("drift");
      const s = await standIn(401);
      const owner = { MEMPALACE_MCP_LISTENER_PID: "7", MEMPALACE_MCP_EXPECTED_PID: "7" };
      try {
        const absent = await runEntry(entry, "status-mcp-server", home, seams(home, s.port, owner));
        assert.equal(absent.status, 1, absent.out);
        assert.match(absent.out, /launcher: NOT INSTALLED at /);

        const launcher = path.join(home, "launcher.sh");
        const withLauncher = { ...owner, MEMPALACE_MCP_LAUNCHER_PATH: launcher };
        fs.writeFileSync(launcher, "#!/usr/bin/env bash\nexit 0\n");
        const unknown = await runEntry(
          entry,
          "status-mcp-server",
          home,
          seams(home, s.port, withLauncher),
        );
        assert.match(unknown.out, /launcher: .*\(drift UNKNOWN/);

        fs.writeFileSync(launcher, '#!/usr/bin/env bash\nLAUNCHER_SOURCE_SHA="deadbeef"\nexit 0\n');
        const drifted = await runEntry(
          entry,
          "status-mcp-server",
          home,
          seams(home, s.port, withLauncher),
        );
        assert.equal(drifted.status, 1, drifted.out);
        assert.match(drifted.out, /\*\*\* DRIFTED \*\*\*/);
        assert.match(drifted.out, /built from deadbeef, repository now /);
        assert.match(drifted.out, /Re-run setup to refresh it\./);
      } finally {
        await s.close();
      }
    });

    test("the Assistant registrations section is printed, and the task: line is Windows only", async () => {
      const home = newHome("sections");
      const port = await freePort();
      const r = await runEntry(entry, "status-mcp-server", home, seams(home, port));
      assert.match(r.out, /^Assistant registrations:$/m);
      if (process.platform !== "win32") assert.doesNotMatch(r.out, /^\s+task:/m);
    });
  });
}
