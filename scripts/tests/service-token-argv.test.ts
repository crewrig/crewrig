// service-token-argv.test.ts — the bearer token never reaches an argument list
// (spec 0252 requirement 27; plan v3 step 13). Through the recording exec.ts
// seam: no service-manager spawn and no daemon launch carries the token, and
// it never appears in a rendered unit, plist, task XML or endpoint record.

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
import { afterEach, beforeEach, test } from "node:test";
import { launchDaemon, runManager, setExecutableOverride } from "../lib/service/exec.ts";
import { createBackend as createLaunchd, plistPathFor } from "../lib/service/launchd.ts";
import { serviceNames } from "../lib/service/names.ts";
import {
  installedPaths,
  installLauncherProgram,
  installTrustWrapperProgram,
} from "../lib/service/program-install.ts";
import { createBackend as createSystemd, unitPathFor } from "../lib/service/systemd.ts";
import { materialiseUnit } from "../lib/service/unit-render.ts";
import { chromaChain, mcpChain, renderTaskXml } from "../lib/service/windows-task-xml.ts";

const TOKEN = "Tk3n_abcDEF0123456789abcdef0123456789-ZZ";
const REPO = path.resolve(import.meta.dirname, "..", "..");
const RECORDER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DIR/argv.log"
exit 0
`;

let dir = "";
let saved: Record<string, string | undefined> = {};
const KEYS = ["FAKE_DIR", "MEMPALACE_MCP_HTTP_TOKEN", "MEMPALACE_MCP_TOKEN_FILE"];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "token-argv-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env["FAKE_DIR"] = dir;
  process.env["MEMPALACE_MCP_HTTP_TOKEN"] = TOKEN;
  process.env["MEMPALACE_MCP_TOKEN_FILE"] = path.join(dir, "token");
  writeFileSync(path.join(dir, "token"), `${TOKEN}\n`, { mode: 0o600 });
  for (const tool of ["launchctl", "systemctl"] as const) {
    const file = path.join(dir, tool);
    writeFileSync(file, RECORDER);
    chmodSync(file, 0o755);
    setExecutableOverride(tool, file);
  }
});
afterEach(() => {
  setExecutableOverride("launchctl", null);
  setExecutableOverride("systemctl", null);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
  rmSync(dir, { recursive: true, force: true });
});

const logged = (): string => {
  const file = path.join(dir, "argv.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
const posix = process.platform === "win32" ? { skip: "POSIX only" } : {};

test("no launchd or systemd operation carries the token in an argument list", posix, () => {
  const home = path.join(dir, "home");
  mkdirSync(home);
  for (const [make, definition] of [
    [createLaunchd, plistPathFor],
    [createSystemd, unitPathFor],
  ] as const) {
    const names = serviceNames("mcp", {});
    const target = definition(names, home);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "x");
    const backend = make(home);
    backend.install(names, { definitionPath: target });
    backend.start(names);
    backend.stop(names);
    backend.status(names);
    backend.supervisorPid(names);
    backend.uninstall(names);
  }
  assert.notEqual(logged(), "", "the recording seam saw no call");
  assert.equal(logged().includes(TOKEN), false);
});

test(
  "a direct manager call and a daemon launch carry no token; a secret-named env is dropped",
  posix,
  async () => {
    runManager("systemctl", ["--user", "is-active", "x"], { env: { ...process.env } });
    assert.equal(logged().includes(TOKEN), false);
    const out = path.join(dir, "child-env.json");
    const script = `require("fs").writeFileSync(process.argv[1], JSON.stringify([process.argv, process.env]))`;
    launchDaemon(process.execPath, ["-e", script, out], { env: { ...process.env } });
    for (let i = 0; i < 100 && !existsSync(out); i += 1)
      await new Promise((r) => setTimeout(r, 50));
    const seen = readFileSync(out, "utf8");
    assert.equal(seen.includes(TOKEN), false);
  },
);

test("the token appears in no rendered unit, plist, task XML or endpoint record", () => {
  const home = path.join(dir, "h");
  const paths = installedPaths(home, {});
  const files: string[] = [];
  for (const template of [
    "config/launchd/com.mempalace.mcp-server.plist",
    "config/launchd/com.mempalace.chroma-server.plist",
    "config/systemd/mempalace-mcp-server.service",
    "config/systemd/mempalace-chroma-server.service",
  ]) {
    const target = path.join(dir, path.basename(template));
    const values = {
      mempalaceHome: path.join(home, ".mempalace"),
      launcherPath: paths.launcher,
      pipxPython: "/pipx/bin/python",
      chromaBin: "/pipx/bin/chroma",
      chromaPalacePath: "/palace",
      tlsExec: paths.wrapper,
    };
    assert.equal(
      materialiseUnit(path.join(REPO, template), target, values, process.execPath).ok,
      true,
    );
    files.push(target);
  }
  installLauncherProgram({
    paths,
    repoDir: REPO,
    host: "127.0.0.1",
    port: "41893",
    chromaHost: "127.0.0.1",
    chromaPort: "8001",
    python: "/pipx/bin/python",
    palacePath: "",
  });
  installTrustWrapperProgram({ paths });
  files.push(paths.record, paths.launcher, paths.wrapper);
  for (const file of files) assert.equal(readFileSync(file, "utf8").includes(TOKEN), false, file);
  const chains = [
    mcpChain("C:\\node\\node.exe", "C:\\h\\launcher.ts"),
    chromaChain({
      nodePath: "C:\\node\\node.exe",
      wrapper: "C:\\h\\tls-exec.ts",
      python: "C:\\p\\python.exe",
      chroma: "C:\\p\\chroma.exe",
      palacePath: "C:\\palace",
    }),
  ];
  for (const chain of chains) {
    const xml = renderTaskXml({ chain, taskUri: "\\CrewRig\\t", userId: "H\\dev" });
    assert.equal(xml.includes(TOKEN), false);
  }
});
