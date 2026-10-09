// service-dual-source-conformance.test.ts — scripts/lib/common.sh against the
// TypeScript modules over one corpus (spec 0252 requirement 26; plan v2 D4).
// Linux only. Retired with the shell library in row J4.

import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { classifyFile, configPath, parseLauncher } from "../lib/mempalace-registration.ts";
import { readMempalacePin } from "../lib/mempalace-pin.ts";
import { mempalacePythonCandidates } from "../lib/mempalace-python.ts";
import { parseRecord, renderRecord } from "../lib/service/launcher-record.ts";
import { materialiseUnit } from "../lib/service/unit-render.ts";
import { tokenPath } from "../lib/usage-store/mcp.js";
import { FIXTURES, REPO, SKIP, shell, stub, tempHome } from "./lib/conformance-harness.ts";

const withEnv = <T>(env: Record<string, string>, fn: () => T): T => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe("dual-source conformance", { skip: SKIP }, () => {
  it("token path: mcp_token_path against tokenPath, default, override, symlinked palace", () => {
    for (const variant of ["default", "override", "symlink"]) {
      const home = tempHome();
      const env: Record<string, string> = { HOME: home };
      if (variant !== "default") {
        const real = path.join(home, "data", "real-palace");
        mkdirSync(real, { recursive: true });
        const palace = path.join(
          home,
          "data",
          variant === "symlink" ? "link-palace" : "real-palace",
        );
        if (variant === "symlink") symlinkSync(real, palace);
        env["MEMPALACE_PALACE_PATH"] = palace;
      }
      const expected = shell(home, "mcp_token_path", env);
      const actual = withEnv(
        { ...env, MEMPALACE_PALACE_PATH: env["MEMPALACE_PALACE_PATH"] ?? "" },
        () => tokenPath(),
      );
      // os.homedir() reads HOME on POSIX; the shell and Node resolve the same real path.
      assert.equal(actual, expected, variant);
    }
  });

  it("launcher record: mcp_installed_endpoint against parseLauncher, shell launcher and new record", () => {
    const dir = path.join(FIXTURES, "launchers");
    const record = renderRecord({
      host: "127.0.0.1",
      port: "41893",
      sourceSha: "a".repeat(64),
      program: "/h/.crewrig/mcp-daemon-launcher.ts",
    });
    const corpus = new Map<string, string>([
      ...readdirSync(dir).map((f) => [f, readFileSync(path.join(dir, f), "utf8")] as const),
      ["endpoint-record.sh", record],
    ]);
    for (const [name, text] of corpus) {
      const home = tempHome();
      const launcher = path.join(home, "launcher.sh");
      writeFileSync(launcher, text);
      const out = shell(home, "mcp_installed_endpoint", { MEMPALACE_MCP_LAUNCHER_PATH: launcher });
      assert.equal(parseLauncher(text)?.url ?? "", out, name);
    }
    assert.notEqual(parseRecord(record), null);
  });

  it("unit substitution: install_daemon_supervisor against unit-render, interpreter token normalised", () => {
    const NODE = "/opt/node/bin/node";
    const cases = [
      {
        os: "Darwin",
        daemon: "mcp",
        label: "com.mempalace.mcp-server",
        unit: "mempalace-mcp-server",
        fn: "_materialise_mcp_unit",
        ext: "plist",
        dir: "launchd",
      },
      {
        os: "Linux",
        daemon: "mcp",
        label: "com.mempalace.mcp-server",
        unit: "mempalace-mcp-server",
        fn: "_materialise_mcp_unit",
        ext: "service",
        dir: "systemd",
      },
      {
        os: "Darwin",
        daemon: "chroma",
        label: "com.mempalace.chroma-server",
        unit: "mempalace-chroma-server",
        fn: "_materialise_chroma_unit",
        ext: "plist",
        dir: "launchd",
      },
      {
        os: "Linux",
        daemon: "chroma",
        label: "com.mempalace.chroma-server",
        unit: "mempalace-chroma-server",
        fn: "_materialise_chroma_unit",
        ext: "service",
        dir: "systemd",
      },
    ];
    for (const c of cases) {
      for (const palace of ["", "/data/palace"]) {
        const home = tempHome();
        const bin = path.join(home, "bin");
        stub(bin, "uname", `echo ${c.os}`);
        stub(bin, "launchctl", "exit 0");
        stub(bin, "systemctl", "exit 0");
        const env: Record<string, string> = {
          MEMPALACE_PYTHON: "/pipx/bin/python",
          CREWRIG_TEST_MOCK_CHROMA_BIN: "true",
          MEMPALACE_PALACE_PATH: palace,
        };
        shell(home, `install_daemon_supervisor ${c.label} ${c.unit} ${c.fn} true x`, env, [bin]);
        const target =
          c.os === "Darwin"
            ? path.join(home, "Library", "LaunchAgents", `${c.label}.plist`)
            : path.join(home, ".config", "systemd", "user", `${c.unit}.service`);
        const template = path.join(
          REPO,
          "config",
          c.dir,
          c.os === "Darwin" ? `${c.label}.plist` : `${c.unit}.service`,
        );
        const flavour = c.os === "Darwin" ? "plist" : "service";
        const rendered = path.join(home, "ts-out");
        const result = materialiseUnit(
          template,
          rendered,
          {
            mempalaceHome: path.join(home, ".mempalace"),
            launcherPath: path.join(home, ".crewrig", "mcp-daemon-launcher.sh"),
            pipxPython: "/pipx/bin/python",
            chromaBin: "/pipx/bin/chroma",
            chromaPalacePath:
              palace !== ""
                ? palace
                : flavour === "service"
                  ? "%h/.mempalace/palace"
                  : path.join(home, ".mempalace", "palace"),
            tlsExec: path.join(home, ".crewrig", "tls-exec.sh"),
          },
          NODE,
        );
        assert.equal(result.ok, true);
        const normalised = readFileSync(rendered, "utf8")
          .replace(`<string>${NODE}</string>`, "<string>/bin/bash</string>")
          .replace(`ExecStart=${NODE}`, "ExecStart=/usr/bin/env bash");
        assert.equal(
          normalised,
          readFileSync(target, "utf8"),
          `${c.daemon} ${flavour} palace=${palace}`,
        );
      }
    }
  });

  it("pin read: MEMPALACE_*_VERSION of common.sh against readMempalacePin", () => {
    const [min, max] = shell(
      tempHome(),
      'echo "$MEMPALACE_MIN_VERSION $MEMPALACE_MAX_VERSION_EXCLUSIVE"',
    ).split(" ");
    assert.deepEqual(readMempalacePin(REPO), { min, maxExclusive: max });
  });

  it("python candidate order: mempalace_python_candidates against mempalacePythonCandidates", () => {
    for (const variant of ["plain", "pipx-home", "console-script"]) {
      const home = tempHome();
      const bin = path.join(home, "bin");
      mkdirSync(bin);
      const env: Record<string, string> = {};
      if (variant === "pipx-home") env["PIPX_HOME"] = path.join(home, "custom-pipx");
      if (variant === "console-script") stub(bin, "mempalace", "exit 0");
      if (variant === "console-script") {
        writeFileSync(
          path.join(bin, "mempalace"),
          `#!${path.join(home, "venv", "bin", "python")}\nx\n`,
          { mode: 0o755 },
        );
      }
      const expected = shell(home, "mempalace_python_candidates", env, [bin]).split("\n");
      const actual = mempalacePythonCandidates({
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        ...env,
      });
      assert.deepEqual(actual, expected, variant);
    }
  });

  it("arrangement: mcp_assistant_arrangement against classifyFile over the registration corpus", () => {
    const dir = path.join(FIXTURES, "registrations");
    const names = readdirSync(dir).sort();
    assert.ok(names.length >= 15);
    const asArrangement = (read: Parameters<typeof classifyFile>[0]): string => {
      const c = classifyFile(read, "http://127.0.0.1:41893/mcp", "copilot");
      if (c.class === "ok" || c.class === "wrong-endpoint") return "http";
      if (c.class === "stdio") return "stdio";
      if (c.class === "unrecognised") return "unknown";
      return c.reason === "no-file" ? "absent" : "none";
    };
    for (const name of names) {
      const home = tempHome();
      const target = configPath("copilot", home);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(dir, name), target);
      const shellSays = shell(home, "mcp_assistant_arrangement copilot", {}, [
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ]);
      const tsSays = asArrangement({ kind: "ok", bytes: readFileSync(target) });
      if (name === "deviation-nan.json") {
        // requirement 31(b): jq reads NaN, the Node.js parser does not.
        assert.equal(shellSays, "http");
        assert.equal(tsSays, "unknown");
      } else {
        assert.equal(tsSays, shellSays, name);
      }
    }
    const home = tempHome();
    assert.equal(
      shell(home, "mcp_assistant_arrangement copilot"),
      asArrangement({ kind: "missing" }),
    );
  });
});
