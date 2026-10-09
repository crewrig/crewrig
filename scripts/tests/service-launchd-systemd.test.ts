// service-launchd-systemd.test.ts — scripts/lib/service/{launchd,systemd}.ts
// (spec 0252 requirements 5, 8, 9): the exact argument lists and the shell's
// messages, driven through the exec.ts executable-path seam with a recording
// fake launchctl / systemctl. POSIX only.

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setExecutableOverride } from "../lib/service/exec.ts";
import { createBackend as createLaunchd, plistPathFor } from "../lib/service/launchd.ts";
import { serviceNames } from "../lib/service/names.ts";
import { createBackend as createSystemd, unitPathFor } from "../lib/service/systemd.ts";

const names = serviceNames("mcp", {});
const FAKE = `#!/bin/sh
echo "$*" >> "$FAKE_DIR/calls.log"
verb=""
for a in "$@"; do case "$a" in --user) ;; *) verb="$a"; break;; esac; done
[ -f "$FAKE_DIR/out.$verb" ] && cat "$FAKE_DIR/out.$verb"
[ -f "$FAKE_DIR/fail.$verb" ] && exit 1
exit 0
`;

let dir = "";
let home = "";
let savedDir: string | undefined;

function script(tool: "launchctl" | "systemctl"): void {
  const file = path.join(dir, tool);
  writeFileSync(file, FAKE);
  chmodSync(file, 0o755);
  setExecutableOverride(tool, file);
}
const set = (name: string, body = ""): void => writeFileSync(path.join(dir, name), body);
function calls(): string[] {
  const file = path.join(dir, "calls.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "svc-fake-"));
  home = path.join(dir, "home");
  mkdirSync(home);
  savedDir = process.env["FAKE_DIR"];
  process.env["FAKE_DIR"] = dir;
  script("launchctl");
  script("systemctl");
});
afterEach(() => {
  setExecutableOverride("launchctl", null);
  setExecutableOverride("systemctl", null);
  if (savedDir === undefined) delete process.env["FAKE_DIR"];
  else process.env["FAKE_DIR"] = savedDir;
  rmSync(dir, { recursive: true, force: true });
});

const opts = process.platform === "win32" ? { skip: "POSIX only" } : {};

describe("launchd backend", opts, () => {
  const plist = (): string => plistPathFor(names, home);
  const label = names.label;

  it("install loads with -w when the label is not listed", () => {
    const out = createLaunchd(home).install(names, { definitionPath: "/x/a.plist" });
    assert.deepEqual(out, { ok: true, detail: `  Loaded launchd agent: ${label}` });
    assert.deepEqual(calls(), ["list", "load -w /x/a.plist"]);
  });

  it("install skips the load when the label is listed", () => {
    set("out.list", `123\t0\t${label}\n`);
    const out = createLaunchd(home).install(names, { definitionPath: "/x/a.plist" });
    assert.deepEqual(out, { ok: true, detail: "  launchd agent already loaded — skipping load." });
    assert.deepEqual(calls(), ["list"]);
  });

  it("install reports the shell's error when load fails", () => {
    set("fail.load");
    const out = createLaunchd(home).install(names, { definitionPath: "/x/a.plist" });
    assert.deepEqual(out, { ok: false, reason: "  ERROR: launchctl load failed." });
  });

  it("stop is a restart request, never unload -w", () => {
    set("out.list", `-\t0\t${label}\n`);
    const out = createLaunchd(home).stop(names);
    assert.deepEqual(calls(), ["list", `stop ${label}`]);
    assert.ok(out.ok && out.detail?.startsWith(`MCP daemon: restart requested (${label})`));
    assert.ok(
      out.ok && out.detail?.includes("  Under KeepAlive the supervisor brings it straight back."),
    );
  });

  it("stop without a loaded unit says so and spawns nothing else", () => {
    const out = createLaunchd(home).stop(names);
    assert.deepEqual(out, { ok: true, detail: `MCP daemon: no supervisor unit loaded (${label})` });
    assert.deepEqual(calls(), ["list"]);
  });

  it("status parses the list row", () => {
    set("out.list", `4321\t0\t${label}\n`);
    assert.deepEqual(createLaunchd(home).status(names), {
      registered: true,
      running: true,
      detail: `4321\t0\t${label}`,
    });
    set("out.list", `-\t0\t${label}\n`);
    assert.equal(createLaunchd(home).status(names).running, false);
    set("out.list", "");
    assert.deepEqual(createLaunchd(home).status(names), { registered: false, running: false });
  });

  it("uninstall unloads -w when the plist exists, then removes it", () => {
    mkdirSync(path.dirname(plist()), { recursive: true });
    writeFileSync(plist(), "x");
    set("out.list", `-\t0\t${label}\n`);
    const out = createLaunchd(home).uninstall(names);
    assert.deepEqual(calls(), ["list", `unload -w ${plist()}`]);
    assert.equal(existsSync(plist()), false);
    assert.deepEqual(out, {
      ok: true,
      detail: `  Removed unit: ${plist()}\n  Supervisor stopped and disabled: ${label}`,
    });
  });

  it("uninstall removes by label when no plist is on disk", () => {
    set("out.list", `-\t0\t${label}\n`);
    createLaunchd(home).uninstall(names);
    assert.deepEqual(calls(), ["list", `remove ${label}`]);
  });

  it("uninstall of an absent service is success: was not loaded", () => {
    const out = createLaunchd(home).uninstall(names);
    assert.deepEqual(out, { ok: true, detail: `  Supervisor was not loaded: ${label}` });
  });

  it("supervisorPid reads launchctl print in process", () => {
    set("out.print", "x = {\n\tpid = 777\n}\n");
    const saved = process.env["MEMPALACE_MCP_EXPECTED_PID"];
    delete process.env["MEMPALACE_MCP_EXPECTED_PID"];
    try {
      assert.deepEqual(createLaunchd(home).supervisorPid(names), { state: "pid", pid: 777 });
      assert.match(calls()[0] ?? "", /^print gui\/\d+\/com\.mempalace\.mcp-server$/);
    } finally {
      if (saved !== undefined) process.env["MEMPALACE_MCP_EXPECTED_PID"] = saved;
    }
  });
});

describe("systemd backend", opts, () => {
  const unit = names.unit;
  const file = (): string => unitPathFor(names, home);

  it("install: daemon-reload then enable --now", () => {
    const out = createSystemd(home).install(names, { definitionPath: file() });
    assert.deepEqual(calls(), ["--user daemon-reload", `--user enable --now ${unit}`]);
    assert.deepEqual(out, { ok: true, detail: `  Enabled and started: ${unit}.service` });
  });

  it("install reports the shell's error and stops after a failed reload", () => {
    set("fail.daemon-reload");
    const out = createSystemd(home).install(names, { definitionPath: file() });
    assert.deepEqual(out, { ok: false, reason: "  ERROR: systemctl --user enable --now failed." });
    assert.deepEqual(calls(), ["--user daemon-reload"]);
  });

  it("stop is a restart request, never disable --now", () => {
    const out = createSystemd(home).stop(names);
    assert.deepEqual(calls(), [`--user is-active --quiet ${unit}`, `--user restart ${unit}`]);
    assert.ok(out.ok && out.detail?.startsWith(`MCP daemon: restart requested (${unit})`));
    assert.ok(out.ok && out.detail?.includes("Under Restart=always"));
  });

  it("stop of an inactive unit says so", () => {
    set("fail.is-active");
    const out = createSystemd(home).stop(names);
    assert.deepEqual(out, { ok: true, detail: `MCP daemon: no supervisor unit active (${unit})` });
    assert.deepEqual(calls(), [`--user is-active --quiet ${unit}`]);
  });

  it("status: is-enabled and is-active", () => {
    set("out.is-active", "active\n");
    assert.deepEqual(createSystemd(home).status(names), {
      registered: true,
      running: true,
      detail: "active",
    });
    assert.deepEqual(calls(), [`--user is-enabled ${unit}`, `--user is-active ${unit}`]);
  });

  it("uninstall: disable --now, remove the unit file, daemon-reload", () => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), "x");
    const out = createSystemd(home).uninstall(names);
    assert.deepEqual(calls(), [
      `--user is-enabled --quiet ${unit}`,
      `--user disable --now ${unit}`,
      "--user daemon-reload",
    ]);
    assert.equal(existsSync(file()), false);
    assert.deepEqual(out, {
      ok: true,
      detail: `  Removed unit: ${file()}\n  Supervisor stopped and disabled: ${names.label}`,
    });
  });

  it("uninstall of an absent service is success: was not loaded", () => {
    set("fail.is-enabled");
    set("fail.is-active");
    const out = createSystemd(home).uninstall(names);
    assert.deepEqual(out, { ok: true, detail: `  Supervisor was not loaded: ${names.label}` });
    assert.deepEqual(calls(), [
      `--user is-enabled --quiet ${unit}`,
      `--user is-active --quiet ${unit}`,
    ]);
  });

  it("supervisorPid: MainPID 0 is none, a number is the pid, the seam wins", () => {
    const saved = process.env["MEMPALACE_MCP_EXPECTED_PID"];
    delete process.env["MEMPALACE_MCP_EXPECTED_PID"];
    try {
      set("out.show", "0\n");
      assert.deepEqual(createSystemd(home).supervisorPid(names), { state: "none" });
      set("out.show", "4242\n");
      assert.deepEqual(createSystemd(home).supervisorPid(names), { state: "pid", pid: 4242 });
      assert.deepEqual(calls().at(-1), `--user show -p MainPID --value ${unit}`);
      process.env["MEMPALACE_MCP_EXPECTED_PID"] = "";
      assert.equal(createSystemd(home).supervisorPid(names).state, "unverifiable");
      process.env["MEMPALACE_MCP_EXPECTED_PID"] = "99";
      assert.deepEqual(createSystemd(home).supervisorPid(names), { state: "pid", pid: 99 });
    } finally {
      if (saved === undefined) delete process.env["MEMPALACE_MCP_EXPECTED_PID"];
      else process.env["MEMPALACE_MCP_EXPECTED_PID"] = saved;
    }
  });
});
