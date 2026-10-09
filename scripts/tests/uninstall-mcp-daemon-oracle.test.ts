// uninstall-mcp-daemon-oracle.test.ts — black-box oracle of
// `scripts/uninstall-mcp-daemon.sh` (spec 0252 R21, PLAN step A2) and of the
// `uninstall_daemon_supervisor` it drives. Runs the script through `bash` under
// the hermetic harness and observes exit status, output, files under the temp
// HOME and the argv of the launchctl / systemctl stubs. The supervisor is ended
// with the symmetric verbs (`unload -w`, `disable --now`); the token file stays.
// Passes against the shell original and, unchanged, against the later shim.
// POSIX only: skipped on win32.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createHermeticEnv, runBash, writeStub, type HermeticEnv } from "./lib/hermetic-env.ts";

const UNINSTALL_SCRIPT = path.resolve(import.meta.dirname, "..", "uninstall-mcp-daemon.sh");

// Expected strings, read from scripts/uninstall-mcp-daemon.sh and uninstall_daemon_supervisor.
const LABEL = "com.mempalace.mcp-server";
const UNIT = "mempalace-mcp-server";
const TOKEN = "token_uninstall_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

interface Fixture {
  readonly h: HermeticEnv;
  readonly state: string;
  readonly calls: string;
  readonly plist: string;
  readonly svc: string;
  readonly launcher: string;
  readonly tokenPath: string;
}

/** Absolute path of the first executable `name` on the real PATH. */
function realTool(name: string): string {
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (path.isAbsolute(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate;
  }
  throw new Error(`oracle: ${name} not found on PATH`);
}

/** Make a real tool available on the hermetic PATH (the script needs jq and a sha256 tool). */
function linkReal(h: HermeticEnv, name: string): void {
  fs.symlinkSync(realTool(name), path.join(h.bin, name));
}

/** The token path `mcp_token_path` derives: ~/.mempalace/server/<sha256(palace)[:24]>/token. */
function tokenPathOf(home: string): string {
  const palace = path.join(fs.realpathSync(path.join(home, ".mempalace")), "palace");
  const key = createHash("sha256").update(palace).digest("hex").slice(0, 24);
  return path.join(home, ".mempalace", "server", key, "token");
}

/** Run `fn` with a fresh harness: stubs, an assistant CLI on PATH, a provisioned token. */
function withFixture(fn: (fx: Fixture) => void): void {
  const h = createHermeticEnv({ poisonPython: false });
  try {
    const state = path.join(h.root, "state");
    const calls = path.join(state, "calls.log");
    fs.mkdirSync(state);
    fs.writeFileSync(calls, "");
    fs.writeFileSync(path.join(state, "launchctl-list"), "");
    fs.mkdirSync(path.join(h.home, ".gemini", "config"), { recursive: true });
    fs.mkdirSync(path.join(h.home, ".copilot"), { recursive: true });
    fs.mkdirSync(path.join(h.home, ".mempalace"), { recursive: true });
    linkReal(h, "jq");
    for (const sha of ["shasum", "sha256sum"]) {
      try {
        linkReal(h, sha);
      } catch {
        // one of the two is enough
      }
    }
    // An assistant CLI on PATH is what makes the claude arrangement readable.
    writeStub(h, "claude", "exit 0\n");
    const realUname = fs.realpathSync(path.join(h.bin, "uname"));
    writeStub(
      h,
      "uname",
      `if [ "\${1:-}" = "-s" ]; then\n  printf '%s\\n' "\${FAKE_UNAME:-Linux}"\n  exit 0\nfi\nexec '${realUname}' "$@"\n`,
    );
    // launchctl: logs argv; state/launchctl-list holds the loaded labels; a
    // successful unload / remove empties it (the unit is gone afterwards).
    writeStub(
      h,
      "launchctl",
      `printf 'launchctl %s\\n' "$*" >> '${calls}'\ncase "\${1:-}" in\n  list) cat '${state}/launchctl-list' 2>/dev/null ;;\n  unload|remove) : > '${state}/launchctl-list' ;;\nesac\nexit 0\n`,
    );
    // systemctl: logs argv; state/loaded present = enabled and active; `disable --now` removes it.
    writeStub(
      h,
      "systemctl",
      `printf 'systemctl %s\\n' "$*" >> '${calls}'\ncase "$*" in\n  *is-enabled*|*is-active*) [ -f '${state}/loaded' ] && exit 0 || exit 3 ;;\n  *disable*) rm -f '${state}/loaded' ;;\nesac\nexit 0\n`,
    );

    const tokenPath = tokenPathOf(h.home);
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, `${TOKEN}\n`, { mode: 0o600 });

    fn({
      h,
      state,
      calls,
      plist: path.join(h.home, "Library", "LaunchAgents", `${LABEL}.plist`),
      svc: path.join(h.home, ".config", "systemd", "user", `${UNIT}.service`),
      launcher: path.join(h.home, ".crewrig", "mcp-daemon-launcher.sh"),
      tokenPath,
    });
  } finally {
    h.dispose();
  }
}

function uninstall(fx: Fixture, os: string, env: Record<string, string> = {}) {
  fs.writeFileSync(fx.calls, "");
  return runBash(fx.h, UNINSTALL_SCRIPT, [], { env: { FAKE_UNAME: os, ...env } });
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

function has(out: string, needle: string): void {
  assert.ok(out.includes(needle), `missing ${JSON.stringify(needle)} in: ${out}`);
}

function lacks(out: string, needle: string): void {
  assert.ok(!out.includes(needle), `unexpected ${JSON.stringify(needle)} in: ${out}`);
}

/** Remove every file a previous case left, and empty the loaded-label list. */
function resetState(fx: Fixture): void {
  const home = fx.h.home;
  for (const file of [
    fx.plist,
    fx.svc,
    fx.launcher,
    path.join(fx.state, "loaded"),
    path.join(home, ".claude.json"),
    path.join(home, ".gemini", "settings.json"),
    path.join(home, ".copilot", "mcp-config.json"),
    path.join(home, ".gemini", "config", "mcp_config.json"),
  ]) {
    fs.rmSync(file, { force: true });
  }
  fs.writeFileSync(path.join(fx.state, "launchctl-list"), "");
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe("uninstall-mcp-daemon.sh oracle", { skip: process.platform === "win32" }, () => {
  test("Darwin uninstall of a loaded unit, then a second run that finds nothing", () => {
    withFixture((fx) => {
      writeFile(fx.plist, "plist\n");
      writeFile(fx.launcher, "launcher\n");
      fs.writeFileSync(path.join(fx.state, "launchctl-list"), `321\t0\t${LABEL}\n`);
      let res = uninstall(fx, "Darwin");
      assert.equal(res.status, 0);
      has(res.stdout, "Uninstalling the shared MemPalace MCP HTTP daemon...");
      assert.ok(
        callLines(fx).includes(`launchctl unload -w ${fx.plist}`),
        callLines(fx).join("\n"),
      );
      callsLack(fx, "launchctl stop");
      assert.ok(!fs.existsSync(fx.plist), "plist still on disk");
      has(res.stdout, `  Removed unit: ${fx.plist}`);
      has(res.stdout, `  Supervisor stopped and disabled: ${LABEL}`);
      assert.ok(!fs.existsSync(fx.launcher), "launcher still on disk");
      has(res.stdout, `  Removed launcher: ${fx.launcher}`);

      // Second run: nothing is loaded any more.
      res = uninstall(fx, "Darwin");
      assert.equal(res.status, 0);
      has(res.stdout, `  Supervisor was not loaded: ${LABEL}`);
      lacks(res.stdout, "Removed unit:");
      lacks(res.stdout, "Removed launcher:");
      callsLack(fx, "unload", "remove");
    });
  });

  test("Darwin unit loaded without a plist on disk is removed by label", () => {
    withFixture((fx) => {
      fs.writeFileSync(path.join(fx.state, "launchctl-list"), `654\t0\t${LABEL}\n`);
      const res = uninstall(fx, "Darwin");
      assert.ok(callLines(fx).includes(`launchctl remove ${LABEL}`), callLines(fx).join("\n"));
      has(res.stdout, `  Supervisor stopped and disabled: ${LABEL}`);
    });
  });

  test("Linux uninstall of an active unit, then a second run that finds nothing", () => {
    withFixture((fx) => {
      writeFile(fx.svc, "service\n");
      fs.writeFileSync(path.join(fx.state, "loaded"), "");
      let res = uninstall(fx, "Linux");
      assert.equal(res.status, 0);
      assert.ok(
        callLines(fx).includes(`systemctl --user disable --now ${UNIT}`),
        callLines(fx).join("\n"),
      );
      callsLack(fx, "restart");
      assert.ok(!fs.existsSync(fx.svc), "service file still on disk");
      assert.ok(callLines(fx).includes("systemctl --user daemon-reload"), callLines(fx).join("\n"));
      has(res.stdout, `  Removed unit: ${fx.svc}`);
      // The outcome line names the launchd label on Linux too ($label in common.sh);
      // the oracle pins the prefix only, so a port may name either identifier.
      has(res.stdout, "  Supervisor stopped and disabled: ");

      res = uninstall(fx, "Linux");
      assert.equal(res.status, 0);
      has(res.stdout, "  Supervisor was not loaded: ");
      callsLack(fx, "disable");
    });
  });

  test("MEMPALACE_MCP_LABEL and MEMPALACE_MCP_UNIT override the defaults", () => {
    withFixture((fx) => {
      fs.writeFileSync(path.join(fx.state, "launchctl-list"), "987\t0\tcustom.label.mcp\n");
      let res = uninstall(fx, "Darwin", { MEMPALACE_MCP_LABEL: "custom.label.mcp" });
      has(res.stdout, "  Supervisor stopped and disabled: custom.label.mcp");

      resetState(fx);
      const custom = path.join(fx.h.home, ".config", "systemd", "user", "custom-unit.service");
      writeFile(custom, "service\n");
      fs.writeFileSync(path.join(fx.state, "loaded"), "");
      res = uninstall(fx, "Linux", { MEMPALACE_MCP_UNIT: "custom-unit" });
      assert.ok(
        callLines(fx).includes("systemctl --user disable --now custom-unit"),
        callLines(fx).join("\n"),
      );
      assert.ok(!fs.existsSync(custom), "overridden unit file still on disk");
    });
  });

  test("an unsupported OS prints the error line and calls no service manager", () => {
    withFixture((fx) => {
      const res = uninstall(fx, "FreeBSD");
      has(res.stdout, "  ERROR: unsupported OS 'FreeBSD' — remove the supervisor unit manually.");
      assert.equal(fs.readFileSync(fx.calls, "utf8"), "");
      lacks(res.stdout, "Supervisor stopped and disabled");
      lacks(res.stdout, "Supervisor was not loaded");
    });
  });

  test("assistants still registered over http get one warning line each", () => {
    withFixture((fx) => {
      const home = fx.h.home;
      writeFile(
        path.join(home, ".claude.json"),
        '{ "mcpServers": { "mempalace": { "url": "http://127.0.0.1:8765/mcp" } } }\n',
      );
      writeFile(
        path.join(home, ".gemini", "config", "mcp_config.json"),
        '{ "mcpServers": { "mempalace": { "serverUrl": "http://127.0.0.1:8765/mcp" } } }\n',
      );
      writeFile(
        path.join(home, ".copilot", "mcp-config.json"),
        '{ "mcpServers": { "mempalace": { "command": "mempalace-mcp" } } }\n',
      );
      let res = uninstall(fx, "Linux");
      has(res.stdout, "WARNING: these assistants still point at the daemon you just removed:");
      has(res.stdout, `    - claude  (${home}/.claude.json)`);
      has(res.stdout, `    - antigravity  (${home}/.gemini/config/mcp_config.json)`);
      lacks(res.stdout, "    - copilot");
      lacks(res.stdout, "    - gemini");
      has(res.stdout, "re-run the setup script for each, or 'task mempalace:switch-http'");

      resetState(fx);
      res = uninstall(fx, "Linux");
      lacks(res.stdout, "WARNING:");
    });
  });

  test("prints the token retention, rotate and decommission guidance and leaves the token file untouched", () => {
    withFixture((fx) => {
      const res = uninstall(fx, "Linux");
      has(res.stdout, "The bearer token is left in place: it is per-palace and a later install");
      has(res.stdout, "  task mempalace:rotate-token");
      has(res.stdout, "  # or: bash scripts/switch-mempalace-http.sh --rotate");
      has(res.stdout, "To DECOMMISSION this palace entirely, remove the token by hand:");
      has(res.stdout, `  rm -rf ${path.dirname(fx.tokenPath)}`);
      assert.equal(fs.readFileSync(fx.tokenPath, "utf8").trim(), TOKEN);
    });
  });
});
