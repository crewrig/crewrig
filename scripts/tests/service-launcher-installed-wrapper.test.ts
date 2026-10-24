// service-launcher-installed-wrapper.test.ts — spec 0252 delta-05 (bug #1477):
// the MCP wrapper and its two data files are installed beside the launcher, hashed,
// reported by status, and the installed launcher no longer needs the checkout.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LAUNCHER_PYTHON_FILES } from "../lib/service/launcher/bundle.ts";
import { serviceNames } from "../lib/service/names.ts";
import {
  REPO_LIB_DIR,
  installLauncherProgram,
  installedPaths,
  launcherSourceSha,
  uninstallPrograms,
} from "../lib/service/program-install.ts";
import { launcherSection } from "../lib/service/status-report.ts";

const CONSTANTS = {
  repoDir: "/nonexistent/checkout",
  host: "127.0.0.1",
  port: "41893",
  chromaHost: "127.0.0.1",
  chromaPort: "8001",
  python: "/pipx/bin/python",
  palacePath: "",
};

function fresh(): { home: string; paths: ReturnType<typeof installedPaths> } {
  const home = mkdtempSync(path.join(tmpdir(), "prog-install-"));
  return { home, paths: installedPaths(home, {}) };
}

test("the Python data files are copied verbatim, mode 0644, and uninstall removes them with the launcher", () => {
  const { home, paths } = fresh();
  installLauncherProgram({ paths, ...CONSTANTS });
  const lib = path.join(home, ".crewrig", "service-lib");
  for (const file of LAUNCHER_PYTHON_FILES) {
    const installed = path.join(lib, path.basename(file));
    assert.equal(
      readFileSync(installed, "utf8"),
      readFileSync(path.join(REPO_LIB_DIR, file), "utf8"),
    );
    if (process.platform !== "win32") assert.equal(statSync(installed).mode & 0o777, 0o644);
  }
  uninstallPrograms("mcp", paths, []);
  assert.equal(existsSync(lib), false);
  rmSync(home, { recursive: true });
});

test("drift: a change to the wrapper or the pin changes the hash", () => {
  for (const file of ["mempalace-http-wrapper.py", "mempalace-pin.json"]) {
    const lib = mkdtempSync(path.join(tmpdir(), "prog-lib-"));
    cpSync(REPO_LIB_DIR, lib, { recursive: true });
    writeFileSync(path.join(lib, file), `${readFileSync(path.join(lib, file), "utf8")}\n`);
    assert.notEqual(launcherSourceSha(lib), launcherSourceSha(), file);
    rmSync(lib, { recursive: true });
  }
});

function status(home: string, paths: ReturnType<typeof installedPaths>, libDir: string) {
  const lines: string[] = [];
  const rc = launcherSection({
    env: {},
    home,
    repoRoot: path.dirname(path.dirname(libDir)),
    platform: "win32",
    names: serviceNames("mcp", {}),
    launcher: paths.record,
    write: (l) => lines.push(l),
  });
  return { rc, out: lines.join("\n") };
}

function copyTree(): { root: string; lib: string } {
  const root = mkdtempSync(path.join(tmpdir(), "prog-tree-"));
  const lib = path.join(root, "scripts", "lib");
  cpSync(REPO_LIB_DIR, lib, { recursive: true });
  return { root, lib };
}

test("status: a missing installed wrapper reads BUNDLE INCOMPLETE and fails", () => {
  const { root, lib } = copyTree();
  const { home, paths } = fresh();
  installLauncherProgram({ paths, libDir: lib, ...CONSTANTS, repoDir: root });
  const ok = status(home, paths, lib);
  assert.equal(ok.rc, 0, ok.out);
  assert.doesNotMatch(ok.out, /BUNDLE INCOMPLETE/);
  rmSync(path.join(home, ".crewrig", "service-lib", "mempalace-http-wrapper.py"));
  const bad = status(home, paths, lib);
  assert.equal(bad.rc, 1);
  assert.match(bad.out, /\*\*\* BUNDLE INCOMPLETE \*\*\*/);
  assert.match(bad.out, /mempalace-http-wrapper\.py/);
  assert.match(bad.out, /switch-mempalace-http/);
  rmSync(home, { recursive: true });
  rmSync(root, { recursive: true });
});

test("status: a dead baked checkout is a note, not a failure", () => {
  const { root, lib } = copyTree();
  const { home, paths } = fresh();
  installLauncherProgram({ paths, libDir: lib, ...CONSTANTS, repoDir: root });
  rmSync(root, { recursive: true });
  const dead = status(home, paths, lib);
  // the repository tree is gone too, so drift is unknown; only the note matters here
  assert.match(dead.out, /no longer depends on it/);
  assert.doesNotMatch(dead.out, /BUNDLE INCOMPLETE/);
  assert.equal(dead.rc, 0, dead.out);
  rmSync(home, { recursive: true });
});

test(
  "the installed launcher reaches the wrapper spawn after its checkout is deleted",
  { skip: process.platform === "win32" },
  async () => {
    const { root, lib } = copyTree();
    const { home, paths } = fresh();
    const marker = path.join(home, "marker");
    const shim = path.join(home, "fake-python.sh");
    writeFileSync(shim, `#!/bin/sh\nprintf '%s' "$1" > "${marker}"\n`);
    chmodSync(shim, 0o755);
    const chroma = http.createServer((_q, res) => res.end("{}"));
    await new Promise<void>((r) => chroma.listen(0, "127.0.0.1", r));
    const free = net.createServer();
    await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
    const port = (free.address() as net.AddressInfo).port;
    await new Promise<void>((r) => free.close(() => r()));
    installLauncherProgram({
      paths,
      libDir: lib,
      ...CONSTANTS,
      repoDir: root,
      python: shim,
      port: String(port),
      chromaPort: String((chroma.address() as net.AddressInfo).port),
    });
    writeFileSync(path.join(path.dirname(paths.launcher), "package.json"), '{"type":"module"}\n');
    rmSync(root, { recursive: true });
    const tokenFile = path.join(home, "token");
    writeFileSync(tokenFile, "t".repeat(40), { mode: 0o600 });
    let stderr = "";
    try {
      const child = spawn(process.execPath, [paths.launcher], {
        env: {
          PATH: process.env.PATH,
          HOME: home,
          NO_PROXY: "127.0.0.1,localhost",
          MEMPALACE_MCP_TOKEN_FILE: tokenFile,
          MEMPALACE_MCP_CHROMA_WAIT: "5",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      await new Promise((r) => child.on("close", r));
    } finally {
      chroma.close();
    }
    assert.doesNotMatch(stderr, /wrapper not found/);
    assert.equal(
      realpathSync(readFileSync(marker, "utf8")),
      realpathSync(
        path.join(path.dirname(paths.launcher), "service-lib", "mempalace-http-wrapper.py"),
      ),
    );
    rmSync(home, { recursive: true });
  },
);

test("the launcher template keeps the CREWRIG_REPO_DIR declaration form status parses", () => {
  const template = readFileSync(
    path.join(REPO_LIB_DIR, "service", "launcher", "mcp-daemon-launcher.ts"),
    "utf8",
  );
  assert.match(
    template,
    /(?:^|\n)const CREWRIG_REPO_DIR: string = ("(?:[^"\\\n]|\\.)*");/,
    "status-report.ts reads the baked checkout from this exact declaration",
  );
});
