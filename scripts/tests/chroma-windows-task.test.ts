// chroma-windows-task.test.ts — the Task Scheduler leg of spec 0252 requirement 24
// for the ChromaDB trio: the ChromaDB chain is installed through the real installer
// under a throwaway task name, then `node scripts/status-chroma-server.ts` and
// `node scripts/stop-chroma-server.ts` run from PowerShell against it. The daemon
// is supervisor-managed (no PID file), so status reports HEALTHY and stop reports it
// and ends nothing. Skipped off win32.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createBackend } from "../lib/service/schtasks.ts";
import {
  alive,
  disposeChain,
  healthz,
  makeChain,
  readState,
  runId,
  waitFor,
} from "./lib/windows-service-fixture.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-chroma-win-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const pwsh = (name: string, port: number, home: string) =>
  spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", `node scripts/${name}.ts; exit $LASTEXITCODE`],
    {
      cwd: REPO,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        MEMPALACE_CHROMA_HOST: "127.0.0.1",
        MEMPALACE_CHROMA_PORT: String(port),
      },
    },
  );

test(
  "status and stop from PowerShell against the installed ChromaDB task",
  { skip: process.platform !== "win32" && "Windows Task Scheduler only" },
  async () => {
    const c = await makeChain("chroma", root, runId(), "chroma-trio");
    const backend = createBackend({ programPathOf: () => c.program });
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    try {
      const installed = backend.install(c.names, { definitionPath: c.definitionPath });
      assert.equal(installed.ok, true, JSON.stringify(installed));
      const state = await waitFor("daemon state", () => readState(c), 90_000);
      for (let i = 0; i < 60 && !(await healthz(state.port)); i++) {
        await new Promise((r) => setTimeout(r, 500));
      }

      const status = pwsh("status-chroma-server", state.port, home);
      assert.equal(status.status, 0, status.stdout + status.stderr);
      assert.match(
        status.stdout,
        /chroma server: HEALTHY \(supervisor-managed, 127\.0\.0\.1:\d+\)/,
      );

      const stop = pwsh("stop-chroma-server", state.port, home);
      assert.equal(stop.status, 0, stop.stdout + stop.stderr);
      assert.match(stop.stdout, /RUNNING and supervisor-managed/);
      assert.equal(alive(state.pid), true, "a routine stop leaves the supervised daemon alone");
    } finally {
      backend.uninstall(c.names);
      await disposeChain(c);
    }
  },
);
