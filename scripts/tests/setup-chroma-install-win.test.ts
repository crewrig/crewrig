// Tests of scripts/lib/setup/chroma-install-win.ts (spec 0256 requirement 25, delta-01 deviation
// (n)): the Chroma daemon as a scheduled task. `schtasks` is the fake behind the exec.ts seam, the
// platform is injected as win32 on the host, and no real Windows call is made. The real Task
// Scheduler is exercised by the windows-setup-units job.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { installChromaDaemonWin } from "../lib/setup/chroma-install-win.ts";
import type { ChromaWinDeps } from "../lib/setup/chroma-install-win.ts";
import type { ChromaInstallArgs } from "../lib/setup/chroma-types.ts";
import type { ServiceBackend, ServiceOutcome } from "../lib/service/backend.ts";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import { installedPaths } from "../lib/service/program-install.ts";
import { decodeTaskFile, xmlUnescape } from "../lib/service/windows-task-xml.ts";
import { installFakeSchtasks, type FakeSchtasks } from "./lib/fake-schtasks.ts";

const skip = process.platform === "win32";
const PYTHON = "C:\\Users\\me\\pipx\\venvs\\mempalace\\Scripts\\python.exe";
const CHROMA = "C:\\Users\\me\\pipx\\venvs\\mempalace\\Scripts\\chroma.exe";
const TASK = "\\CrewRig\\mempalace-chroma-server";
const MOCKED = {
  CREWRIG_TEST_MOCK_CHROMA_BIN: "true",
  USERNAME: "me",
  USERDOMAIN: "BOX",
} as const;

let fake: FakeSchtasks;
let root: string;
let home: string;
let out: string[];

function args(env: Record<string, string> = MOCKED, python: string | undefined = PYTHON) {
  return {
    ctx: {
      io: { out: (l: string) => void out.push(l), err: () => {}, errRaw: () => {} },
      env,
      platform: "win32",
      home,
      repoDir: root,
    },
    spawn: () => {
      throw new Error("the Windows install spawns through the schtasks seam only");
    },
    python,
  } satisfies ChromaInstallArgs;
}

const healthy: ChromaWinDeps = { healthz: async () => true, nodePath: "C:\\node\\node.exe" };
const never: ChromaWinDeps = { ...healthy, healthz: async () => false, deadlineMs: 60, stepMs: 10 };
const taskXml = (): string =>
  xmlUnescape(
    decodeTaskFile(
      readFileSync(path.join(home, ".crewrig", "service", "mempalace-chroma-server.xml")),
    ),
  );
const wrapperOf = (): string => installedPaths(home, MOCKED).wrapper;
const verbs = (): string[] => fake.calls().map((c) => c[0] ?? "");

beforeEach(() => {
  fake = installFakeSchtasks();
  setInspectRunnerForTests(() => ({ ok: false, reason: "refused" }));
  root = mkdtempSync(path.join(os.tmpdir(), "chroma-win-"));
  home = path.join(root, "my home"); // a home path with a space
  mkdirSync(home);
  out = [];
});
afterEach(() => {
  fake.cleanup();
  setInspectRunnerForTests(undefined);
  rmSync(root, { recursive: true, force: true });
});

test(
  "success: the task is registered, the wrapper is installed and the heartbeat answers",
  { skip },
  async () => {
    const beats: string[] = [];
    const deps = {
      ...healthy,
      healthz: async (e: { host: string; port: string }) => (
        beats.push(`${e.host}:${e.port}`),
        true
      ),
    };
    const r = await installChromaDaemonWin(args(), deps);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(beats, ["127.0.0.1:8001"]);
    assert.equal(fake.has(TASK), true);
    assert.deepEqual(
      verbs().filter((v) => v === "/Create"),
      ["/Create"],
    );
    assert.equal(existsSync(wrapperOf()), true, "the trust wrapper program is on disk");
    assert.equal(out[0], "");
    assert.equal(out[1], "Installing shared ChromaDB HTTP daemon supervisor (issue #98)...");
    assert.ok(out.includes(`  Installed trust wrapper: ${wrapperOf()}`));
    assert.ok(out.some((l) => l.startsWith("  Installed: ")));
    assert.equal(
      out.some((l) => /unsupported OS/i.test(l)),
      false,
    );
    assert.equal(
      out.some((l) => l.includes("ERROR")),
      false,
    );
  },
);

test(
  "the registered task runs the wrapper, the chroma.exe of the venv and the palace, with a spaced home",
  { skip },
  async () => {
    await installChromaDaemonWin(args(), healthy);
    const xml = taskXml();
    assert.ok(xml.includes("C:\\node\\node.exe"));
    assert.ok(xml.includes(`"${wrapperOf()}"`), "the spaced wrapper path is quoted");
    assert.ok(xml.includes("--end-nonzero-on-child-exit"));
    assert.ok(xml.includes(CHROMA));
    assert.ok(xml.includes(PYTHON));
    assert.ok(
      xml.includes(`"${path.join(home, ".mempalace", "palace")}"`),
      "the spaced palace path is quoted",
    );
    assert.ok(xml.includes("BOX\\me"));
    assert.ok(xml.includes("--host 127.0.0.1 --port 8001"));
  },
);

test("the endpoint overrides reach the task and the heartbeat", { skip }, async () => {
  const seen: string[] = [];
  const env = { ...MOCKED, MEMPALACE_CHROMA_HOST: "127.0.0.2", MEMPALACE_CHROMA_PORT: "9001" };
  await installChromaDaemonWin(args(env), {
    ...healthy,
    healthz: async (e) => (seen.push(`${e.host}:${e.port}`), true),
  });
  assert.deepEqual(seen, ["127.0.0.2:9001"]);
  const xml = taskXml();
  assert.ok(xml.includes("--host 127.0.0.2 --port 9001"));
});

test("the wrapper is installed before the task is registered", async () => {
  const events: string[] = [];
  const backend: ServiceBackend = {
    kind: "schtasks",
    install: () => (events.push("register"), { ok: true }),
    start: () => ({ ok: true }),
    stop: () => ({ ok: true }),
    status: () => ({ registered: false, running: false }),
    uninstall: () => ({ ok: true }),
    supervisorPid: () => ({ state: "none" }),
  };
  const r = await installChromaDaemonWin(args(), {
    ...healthy,
    backend,
    installWrapper: (o) => void events.push(`wrapper:${o.paths.wrapper}`),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(events, [`wrapper:${wrapperOf()}`, "register"]);
});

test(
  "pre-flight failure: the Windows chroma.exe message, nothing installed or registered",
  { skip },
  async () => {
    const r = await installChromaDaemonWin(args({ USERNAME: "me" }), healthy);
    assert.deepEqual(r, { ok: false });
    assert.ok(
      out.includes(
        `  ERROR: chroma binary not found at ${CHROMA} — run: pipx inject mempalace 'chromadb>=1.5.9'`,
      ),
    );
    assert.deepEqual(fake.calls(), []);
    assert.equal(existsSync(wrapperOf()), false);
    assert.equal(
      out.some((l) => /unsupported OS/i.test(l)),
      false,
    );
  },
);

test("no interpreter: the shell's ERROR line and a failure", { skip }, async () => {
  for (const python of [undefined, ""]) {
    out = [];
    const r = await installChromaDaemonWin({ ...args(), python }, healthy);
    assert.deepEqual(r, { ok: false });
    assert.ok(
      out.includes("  ERROR: cannot detect mempalace pipx python — install mempalace first."),
    );
  }
  assert.deepEqual(fake.calls(), []);
});

test(
  "registration failure: no half-registered task, the rollback ran and the files are gone",
  { skip },
  async () => {
    fake.setMode({ createFail: "ERROR: Access is denied.\n" });
    const r = await installChromaDaemonWin(args(), healthy);
    assert.deepEqual(r, { ok: false });
    assert.ok(
      out.some((l) => l.includes("ERROR")),
      "the install's own ERROR line is printed",
    );
    assert.equal(fake.has(TASK), false);
    assert.ok(verbs().includes("/Delete"), "the unregister was recorded");
    assert.equal(
      existsSync(path.join(home, ".crewrig", "service", "mempalace-chroma-server.xml")),
      false,
    );
    assert.equal(existsSync(wrapperOf()), false, "the wrapper this install put there is removed");
  },
);

test("registration failure through a spy backend: installDaemon's rollback uninstalls the chroma task", async () => {
  const uninstalled: string[] = [];
  const refuse: ServiceOutcome = { ok: false, reason: "  ERROR: refused" };
  const backend: ServiceBackend = {
    kind: "schtasks",
    install: () => refuse,
    start: () => ({ ok: true }),
    stop: () => ({ ok: true }),
    status: () => ({ registered: false, running: false }),
    uninstall: (n) => (uninstalled.push(n.unit), { ok: true }),
    supervisorPid: () => ({ state: "none" }),
  };
  const r = await installChromaDaemonWin(args(), { ...healthy, backend });
  assert.deepEqual(r, { ok: false });
  assert.deepEqual(uninstalled, ["mempalace-chroma-server"]);
  assert.ok(out.includes("  ERROR: refused"));
});

test(
  "heartbeat timeout: the diagnostics, the failure and the task rolled back",
  { skip },
  async () => {
    const r = await installChromaDaemonWin(args(), never);
    assert.deepEqual(r, { ok: false });
    assert.ok(
      out.includes("  ERROR: daemon 'com.mempalace.chroma-server' did not become healthy."),
    );
    assert.ok(
      out.includes(
        `         Inspect logs at ${path.join(home, ".mempalace", "chroma-server.log")} and retry.`,
      ),
    );
    assert.equal(fake.has(TASK), false, "the task registered a moment ago is removed");
    assert.ok(verbs().includes("/Create") && verbs().includes("/Delete"));
    assert.equal(existsSync(wrapperOf()), false);
  },
);

test("a wrapper installed by an earlier run survives a rollback", { skip }, async () => {
  mkdirSync(path.dirname(wrapperOf()), { recursive: true });
  writeFileSync(wrapperOf(), "// earlier\n");
  const r = await installChromaDaemonWin(args(), { ...never, installWrapper: () => {} });
  assert.equal(r.ok, false);
  assert.equal(readFileSync(wrapperOf(), "utf8"), "// earlier\n");
  assert.equal(fake.has(TASK), false);
});

test("an unknown current user is a diagnosed failure, not a throw", { skip }, async () => {
  const r = await installChromaDaemonWin(args({ CREWRIG_TEST_MOCK_CHROMA_BIN: "true" }), healthy);
  assert.deepEqual(r, { ok: false });
  assert.ok(out.some((l) => l.includes("ERROR: cannot determine the current user")));
  assert.equal(fake.has(TASK), false);
});
