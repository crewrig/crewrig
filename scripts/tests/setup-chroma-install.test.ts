// Tests of scripts/lib/setup/chroma-install.ts (spec 0256 requirement 25, delta-01 deviation (n)):
// the launchd and systemd branches through the service seams, the health poll on a fake clock, the
// pre-flight failures, the Windows dispatch. No service manager is ever run: a recording Spawner stands in.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { installChromaDaemon } from "../lib/setup/chroma-install.ts";
import type { ChromaInstallSeams } from "../lib/setup/chroma-install.ts";
import type { ChromaInstallArgs } from "../lib/setup/chroma-types.ts";
import type { SpawnResult, Spawner } from "../lib/setup/context.ts";

const realRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const posix = process.platform !== "win32";
const LABEL = "com.mempalace.chroma-server";
const UNIT = "mempalace-chroma-server";
let root: string;
let repoDir: string;

before(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "chroma-install-"));
  repoDir = path.join(root, "repo");
  for (const rel of [`config/systemd/${UNIT}.service`, `config/launchd/${LABEL}.plist`]) {
    mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
    writeFileSync(path.join(repoDir, rel), readFileSync(path.join(realRepo, rel)));
  }
  mkdirSync(path.join(repoDir, "scripts", "lib"), { recursive: true });
  writeFileSync(path.join(repoDir, "scripts", "lib", "tls-exec.sh"), "#!/bin/sh\n");
});
after(() => rmSync(root, { recursive: true, force: true }));

interface Run {
  readonly args: ChromaInstallArgs;
  readonly out: string[];
  readonly err: string[];
  readonly calls: string[][];
  readonly home: string;
}

/** A sandbox home, a venv, a recording spawner and the platform seam. `listing` is `launchctl list`. */
function setup(
  opts: { platform?: string; chroma?: boolean; listing?: string; fail?: string } = {},
): Run {
  const home = mkdtempSync(path.join(root, "home-"));
  const venv = path.join(root, `venv-${path.basename(home)}`, "bin");
  mkdirSync(venv, { recursive: true });
  const python = path.join(venv, "python");
  if (opts.chroma !== false) {
    writeFileSync(path.join(venv, "chroma"), "#!/bin/sh\n");
    chmodSync(path.join(venv, "chroma"), 0o755);
  }
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[][] = [];
  const spawn: Spawner = (argv): SpawnResult => {
    calls.push([...argv]);
    const failing = opts.fail !== undefined && argv.includes(opts.fail);
    const stdout = argv[1] === "list" ? (opts.listing ?? "") : "";
    return { status: failing ? 1 : 0, stdout, stderr: "" };
  };
  const env: Record<string, string> = {};
  if (opts.platform !== undefined) env["CREWRIG_TEST_SERVICE_PLATFORM"] = opts.platform;
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: () => {},
  };
  const ctx = { io, env, platform: process.platform, home, repoDir };
  return { args: { ctx, spawn, python }, out, err, calls, home };
}

/** A fake clock: every sleep advances it; `probes` counts the health calls. */
function clock(healthyAfter: number) {
  let t = 0;
  let probes = 0;
  const seams: ChromaInstallSeams = {
    now: () => t,
    sleep: async (ms) => void (t += ms),
    health: async (sink) => {
      probes += 1;
      const ok = probes > healthyAfter;
      sink.out(ok ? "chroma server: HEALTHY" : "chroma server: NOT RUNNING (no PID file)");
      return ok;
    },
  };
  return { seams, probes: () => probes };
}

const HEADER = ["", "Installing shared ChromaDB HTTP daemon supervisor (issue #98)..."];
const posixTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !posix }, fn);

posixTest("linux: systemd unit installed, reloaded, enabled, health checked", async () => {
  const r = setup({ platform: "linux" });
  const c = clock(2);
  const res = await installChromaDaemon(r.args, c.seams);
  const unit = path.join(r.home, ".config", "systemd", "user", `${UNIT}.service`);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(r.out, [
    ...HEADER,
    `  Installed: ${unit}`,
    `  Enabled and started: ${UNIT}.service`,
  ]);
  assert.deepEqual(
    r.calls.map((a) => a.slice(1)),
    [
      ["--user", "daemon-reload"],
      ["--user", "enable", "--now", UNIT],
    ],
  );
  assert.ok(existsSync(unit) && !/__[A-Z]/.test(readFileSync(unit, "utf8")));
  assert.equal(c.probes(), 3);
  assert.ok(existsSync(path.join(r.home, ".mempalace", "palace")));
});

posixTest("darwin: LaunchAgent installed and loaded with `launchctl load -w`", async () => {
  const r = setup({ platform: "darwin" });
  const res = await installChromaDaemon(r.args, clock(0).seams);
  const plist = path.join(r.home, "Library", "LaunchAgents", `${LABEL}.plist`);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(r.out, [...HEADER, `  Installed: ${plist}`, `  Loaded launchd agent: ${LABEL}`]);
  assert.deepEqual(
    r.calls.map((a) => a.slice(1)),
    [["list"], ["load", "-w", plist]],
  );
  assert.equal(r.calls[0]?.[0], "/bin/launchctl");
});

posixTest("the CREWRIG_TEST_SERVICE_BIN_DIR stub is the executable that is named", async () => {
  const r = setup({ platform: "linux" });
  const bin = path.join(root, "stubs");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "systemctl"), "#!/bin/sh\n");
  const args = {
    ...r.args,
    ctx: { ...r.args.ctx, env: { ...r.args.ctx.env, CREWRIG_TEST_SERVICE_BIN_DIR: bin } },
  };
  assert.equal((await installChromaDaemon(args, clock(0).seams)).ok, true);
  assert.deepEqual(
    r.calls.map((a) => a[0]),
    [path.join(bin, "systemctl"), path.join(bin, "systemctl")],
  );
});

posixTest("darwin: an already loaded agent is not loaded again (idempotent re-run)", async () => {
  const r = setup({ platform: "darwin", listing: `123\t0\t${LABEL}\n` });
  const res = await installChromaDaemon(r.args, clock(0).seams);
  assert.equal(res.ok, true);
  assert.equal(r.out.at(-1), "  launchd agent already loaded — skipping load.");
  assert.deepEqual(
    r.calls.map((a) => a[1]),
    ["list"],
  );
});

posixTest("linux: a second run converges on the same unit and the same lines", async () => {
  const r = setup({ platform: "linux" });
  await installChromaDaemon(r.args, clock(0).seams);
  const first = readFileSync(path.join(r.home, ".config/systemd/user", `${UNIT}.service`), "utf8");
  const before = r.out.length;
  assert.equal((await installChromaDaemon(r.args, clock(0).seams)).ok, true);
  assert.deepEqual(r.out.slice(before), r.out.slice(0, before));
  assert.equal(
    readFileSync(path.join(r.home, ".config/systemd/user", `${UNIT}.service`), "utf8"),
    first,
  );
});

posixTest(
  "darwin: a failed `launchctl load` ends with the ERROR line, no health check",
  async () => {
    const r = setup({ platform: "darwin", fail: "load" });
    const c = clock(0);
    assert.deepEqual(await installChromaDaemon(r.args, c.seams), { ok: false });
    assert.equal(r.out.at(-1), "  ERROR: launchctl load failed.");
    assert.equal(c.probes(), 0);
  },
);

posixTest("linux: a failed `systemctl enable --now` ends with the ERROR line", async () => {
  const r = setup({ platform: "linux", fail: "enable" });
  const c = clock(0);
  assert.deepEqual(await installChromaDaemon(r.args, c.seams), { ok: false });
  assert.equal(r.out.at(-1), "  ERROR: systemctl --user enable --now failed.");
  assert.equal(c.probes(), 0);
});

posixTest(
  "a daemon that never answers: the status line then two ERROR lines, 15 s of polling",
  async () => {
    const r = setup({ platform: "linux" });
    const c = clock(Infinity);
    assert.deepEqual(await installChromaDaemon(r.args, c.seams), { ok: false });
    assert.equal(c.probes(), 51); // 50 steps of 0.3 s in the 15 s budget, then the diagnostic call
    assert.deepEqual(r.out.slice(-3), [
      "chroma server: NOT RUNNING (no PID file)",
      `  ERROR: daemon '${LABEL}' did not become healthy.`,
      `         Inspect logs at ${path.join(r.home, ".mempalace", "chroma-server.log")} and retry.`,
    ]);
  },
);

posixTest(
  "the chroma binary missing: the pre-flight ERROR is the last line, nothing spawned",
  async () => {
    const r = setup({ platform: "linux", chroma: false });
    const res = await installChromaDaemon(r.args, clock(0).seams);
    const chroma = `${path.dirname(r.args.python ?? "")}/chroma`;
    assert.equal(res.ok, false);
    assert.equal(
      r.out.at(-1),
      `  ERROR: chroma binary not found at ${chroma} — run: pipx inject mempalace 'chromadb>=1.5.9'`,
    );
    assert.deepEqual(r.calls, []);
    assert.ok(existsSync(path.join(r.home, ".config", "systemd", "user")));
  },
);

posixTest("no interpreter: the shell's message, not ok", async () => {
  const r = setup({ platform: "linux" });
  const res = await installChromaDaemon({ ...r.args, python: undefined }, clock(0).seams);
  assert.equal(res.ok, false);
  assert.equal(
    r.out.at(-1),
    "  ERROR: cannot detect mempalace pipx python — install mempalace first.",
  );
});

posixTest("a template that is not shipped stops before any directory or spawn", async () => {
  const r = setup({ platform: "linux" });
  const args = { ...r.args, ctx: { ...r.args.ctx, repoDir: path.join(root, "empty-repo") } };
  assert.equal((await installChromaDaemon(args, clock(0).seams)).ok, false);
  assert.equal(
    r.out.at(-1),
    `  ERROR: ${path.join(root, "empty-repo", "config", "systemd", `${UNIT}.service`)} missing — daemon supervisor unit not shipped.`,
  );
  assert.deepEqual(r.calls, []);
  assert.equal(existsSync(path.join(r.home, ".config")), false);
});

test("win32 dispatches to the Windows installer and prints no `unsupported OS`", async () => {
  const r = setup();
  const seen: ChromaInstallArgs[] = [];
  const args = { ...r.args, ctx: { ...r.args.ctx, platform: "win32" as const } };
  const res = await installChromaDaemon(args, { installWin: (a) => (seen.push(a), { ok: true }) });
  assert.deepEqual(res, { ok: true });
  assert.equal(seen.length, 1);
  assert.deepEqual(r.calls, []);
  const failed = await installChromaDaemon(args, { installWin: () => ({ ok: false }) });
  assert.deepEqual(failed, { ok: false });
  assert.equal(r.out.length, 0); // no `unsupported OS` line, nothing printed by the dispatcher
});

posixTest("an unsupported OS keeps the shell's message with the uname spelling", async () => {
  const r = setup({ platform: "freebsd" });
  assert.equal((await installChromaDaemon(r.args)).ok, false);
  assert.equal(r.out.at(-1), "  ERROR: unsupported OS 'FreeBSD' — install the daemon manually.");
});

posixTest("the default health probe reads the heartbeat of the configured endpoint", async () => {
  const server = createServer((req, res) => {
    res.statusCode = req.url === "/api/v2/heartbeat" ? 200 : 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    const r = setup({ platform: "linux" });
    const env = {
      ...r.args.ctx.env,
      MEMPALACE_CHROMA_HOST: "127.0.0.1",
      MEMPALACE_CHROMA_PORT: String(port),
    };
    const res = await installChromaDaemon({ ...r.args, ctx: { ...r.args.ctx, env } });
    assert.deepEqual(res, { ok: true });
  } finally {
    server.close();
  }
});
