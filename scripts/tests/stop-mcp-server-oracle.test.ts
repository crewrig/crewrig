// stop-mcp-server-oracle.test.ts — the black-box oracle of
// `scripts/stop-mcp-server.sh` (spec 0252 R21, PLAN step A1). It drives the
// script through `bash` under the hermetic harness and observes only what must
// survive the migration: exit status, stdout, stderr and the argv of the
// service-manager calls (launchctl / systemctl stubs). The script is "stop is
// a restart request": it never unloads, removes, disables or stops the unit.
// It passes against the shell original today and, unchanged, once the script
// becomes a shim to TypeScript. POSIX only: skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createHermeticEnv, runBash, writeStub, type HermeticEnv } from "./lib/hermetic-env.ts";

const STOP_SCRIPT = path.resolve(import.meta.dirname, "..", "stop-mcp-server.sh");

// Expected strings, read from scripts/stop-mcp-server.sh and scripts/lib/common.sh.
const DEFAULT_LABEL = "com.mempalace.mcp-server";
const DEFAULT_UNIT = "mempalace-mcp-server";

interface Fixture {
  readonly h: HermeticEnv;
  readonly state: string;
  readonly calls: string;
}

/** Run `fn` with a fresh harness whose PATH holds uname, launchctl and systemctl stubs. */
function withStubs(fn: (fx: Fixture) => void): void {
  const h = createHermeticEnv({ poisonPython: false });
  try {
    const state = path.join(h.root, "state");
    const calls = path.join(state, "calls.log");
    fs.mkdirSync(state);
    fs.writeFileSync(calls, "");
    const realUname = fs.realpathSync(path.join(h.bin, "uname"));
    // uname: `-s` answers FAKE_UNAME; anything else falls through to the real binary.
    writeStub(
      h,
      "uname",
      `if [ "\${1:-}" = "-s" ]; then\n  printf '%s\\n' "\${FAKE_UNAME:-Linux}"\n  exit 0\nfi\nexec '${realUname}' "$@"\n`,
    );
    // launchctl: logs argv; `list` prints the content of state/launchctl-list.
    writeStub(
      h,
      "launchctl",
      `printf 'launchctl %s\\n' "$*" >> '${calls}'\nif [ "\${1:-}" = "list" ]; then\n  cat '${state}/launchctl-list' 2>/dev/null\nfi\nexit 0\n`,
    );
    // systemctl: logs argv; is-active answers per state/active (present = active).
    writeStub(
      h,
      "systemctl",
      `printf 'systemctl %s\\n' "$*" >> '${calls}'\ncase "$*" in\n  *is-active*) [ -f '${state}/active' ] && exit 0 || exit 3 ;;\nesac\nexit 0\n`,
    );
    fn({ h, state, calls });
  } finally {
    h.dispose();
  }
}

function stop(fx: Fixture, os: string, env: Record<string, string> = {}) {
  fs.writeFileSync(fx.calls, "");
  return runBash(fx.h, STOP_SCRIPT, [], {
    env: {
      FAKE_UNAME: os,
      CREWRIG_TEST_SERVICE_PLATFORM: os.toLowerCase(),
      CREWRIG_TEST_SERVICE_BIN_DIR: fx.h.bin,
      ...env,
    },
  });
}

function callLines(fx: Fixture): string[] {
  return fs
    .readFileSync(fx.calls, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

function callsLack(fx: Fixture, ...needles: string[]): void {
  const text = fs.readFileSync(fx.calls, "utf8");
  for (const needle of needles) {
    assert.ok(!text.includes(needle), `unexpected call ${needle}: ${text}`);
  }
}

describe("stop-mcp-server.sh oracle", { skip: process.platform === "win32" }, () => {
  test("Darwin with the supervisor unit loaded: requests a restart, never unloads or removes", () => {
    withStubs((fx) => {
      fs.writeFileSync(path.join(fx.state, "launchctl-list"), `123\t0\t${DEFAULT_LABEL}\n`);
      const res = stop(fx, "Darwin");
      assert.equal(res.status, 0);
      assert.ok(
        res.stdout.includes(`MCP daemon: restart requested (${DEFAULT_LABEL})`),
        res.stdout,
      );
      assert.ok(
        res.stdout.includes("Under KeepAlive the supervisor brings it straight back."),
        res.stdout,
      );
      assert.ok(res.stdout.includes("To end it: bash scripts/uninstall-mcp-daemon.sh"), res.stdout);
      assert.ok(
        callLines(fx).includes(`launchctl stop ${DEFAULT_LABEL}`),
        callLines(fx).join("\n"),
      );
      callsLack(fx, "unload", "remove", "bootout");
      assert.equal(res.stderr, "");
    });
  });

  test("Darwin with no supervisor unit loaded: prints the no-unit line, stops nothing", () => {
    withStubs((fx) => {
      fs.writeFileSync(path.join(fx.state, "launchctl-list"), "456\t0\tcom.other.service\n");
      const res = stop(fx, "Darwin");
      assert.equal(res.status, 0);
      assert.equal(
        res.stdout.replace(/\n$/, ""),
        `MCP daemon: no supervisor unit loaded (${DEFAULT_LABEL})`,
      );
      callsLack(fx, "launchctl stop");
    });
  });

  test("Linux with the supervisor unit active: restarts it, never disables or stops it", () => {
    withStubs((fx) => {
      fs.writeFileSync(path.join(fx.state, "active"), "");
      const res = stop(fx, "Linux");
      assert.equal(res.status, 0);
      assert.ok(res.stdout.includes(`MCP daemon: restart requested (${DEFAULT_UNIT})`), res.stdout);
      assert.ok(
        res.stdout.includes("Under Restart=always the supervisor brings it straight back."),
        res.stdout,
      );
      assert.ok(res.stdout.includes("To end it: bash scripts/uninstall-mcp-daemon.sh"), res.stdout);
      assert.ok(
        callLines(fx).includes(`systemctl --user restart ${DEFAULT_UNIT}`),
        callLines(fx).join("\n"),
      );
      callsLack(fx, "disable", " stop", "mask");
      assert.equal(res.stderr, "");
    });
  });

  test("Linux with the supervisor unit inactive: prints the no-unit line, restarts nothing", () => {
    withStubs((fx) => {
      const res = stop(fx, "Linux");
      assert.equal(res.status, 0);
      assert.equal(
        res.stdout.replace(/\n$/, ""),
        `MCP daemon: no supervisor unit active (${DEFAULT_UNIT})`,
      );
      callsLack(fx, "restart");
    });
  });

  test("an unsupported OS exits 1 with the message on standard error and calls no service manager", () => {
    withStubs((fx) => {
      const res = stop(fx, "FreeBSD");
      assert.equal(res.status, 1);
      assert.match(res.stderr, /MCP daemon: unsupported OS.*manage the supervisor unit manually\./);
      assert.equal(res.stdout, "");
      assert.equal(fs.readFileSync(fx.calls, "utf8"), "");
    });
  });

  test("MEMPALACE_MCP_LABEL and MEMPALACE_MCP_UNIT override the defaults", () => {
    withStubs((fx) => {
      fs.writeFileSync(path.join(fx.state, "launchctl-list"), "789\t0\tcustom.label.mcp\n");
      let res = stop(fx, "Darwin", { MEMPALACE_MCP_LABEL: "custom.label.mcp" });
      assert.ok(
        res.stdout.includes("MCP daemon: restart requested (custom.label.mcp)"),
        res.stdout,
      );
      assert.ok(
        callLines(fx).includes("launchctl stop custom.label.mcp"),
        callLines(fx).join("\n"),
      );

      res = stop(fx, "Darwin");
      assert.ok(
        res.stdout.includes(`no supervisor unit loaded (${DEFAULT_LABEL})`),
        "the default label is not matched when only the override is loaded",
      );

      fs.writeFileSync(path.join(fx.state, "active"), "");
      res = stop(fx, "Linux", { MEMPALACE_MCP_UNIT: "custom-unit" });
      assert.ok(res.stdout.includes("MCP daemon: restart requested (custom-unit)"), res.stdout);
      assert.ok(
        callLines(fx).includes("systemctl --user restart custom-unit"),
        callLines(fx).join("\n"),
      );
    });
  });
});
