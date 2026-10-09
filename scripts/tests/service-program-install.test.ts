// service-program-install.test.ts — scripts/lib/service/program-install.ts
// (spec 0252 requirement 10 with delta-01): what an install writes, the SHA
// scope, the residual-placeholder refusal, the endpoint record, and the
// uninstall rules in both orders.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseLauncher } from "../lib/mempalace-registration.ts";
import {
  LAUNCHER_BUNDLE,
  SERVICE_LIB_FILES,
  TRUST_WRAPPER_BUNDLE,
} from "../lib/service/launcher/bundle.ts";
import { parseRecord, recordForm } from "../lib/service/launcher-record.ts";
import {
  LAUNCHER_ENTRY,
  REPO_LIB_DIR,
  installLauncherProgram,
  installTrustWrapperProgram,
  installedPaths,
  launcherSourceSha,
  uninstallPrograms,
} from "../lib/service/program-install.ts";

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

const names = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const flat = (files: readonly string[]): string[] => files.map((f) => path.basename(f)).sort();

test("default and overridden paths: .sh becomes .ts, another extension gets .ts appended", () => {
  const p = installedPaths("/h", {});
  assert.equal(p.record, "/h/.crewrig/mcp-daemon-launcher.sh");
  assert.equal(p.launcher, "/h/.crewrig/mcp-daemon-launcher.ts");
  assert.equal(p.wrapper, "/h/.crewrig/tls-exec.ts");
  const q = installedPaths("/h", {
    MEMPALACE_MCP_LAUNCHER_PATH: "/x/launch",
    MEMPALACE_TLS_EXEC_PATH: "/y/t.sh",
  });
  assert.equal(q.launcher, "/x/launch.ts");
  assert.equal(q.wrapper, "/y/t.ts");
});

test("a path value with replacement patterns is written verbatim into the installed launcher", () => {
  const { paths } = fresh();
  const python = "/p/$&/$$/$`/x";
  installLauncherProgram({ paths, ...CONSTANTS, python });
  assert.ok(readFileSync(paths.launcher, "utf8").includes(JSON.stringify(python)));
});

test("installing the launcher alone writes the launcher, its record and its own bundle only", () => {
  const { home, paths } = fresh();
  installLauncherProgram({ paths, ...CONSTANTS });
  assert.deepEqual(names(path.join(home, ".crewrig")), [
    "mcp-daemon-launcher.sh",
    "mcp-daemon-launcher.ts",
    "service-lib",
  ]);
  assert.deepEqual(names(path.join(home, ".crewrig", "service-lib")), flat(LAUNCHER_BUNDLE));
  assert.equal(existsSync(paths.wrapper), false);
  const text = readFileSync(paths.launcher, "utf8");
  assert.match(text, /from "\.\/service-lib\/launcher-child\.ts"/);
  assert.doesNotMatch(text, /from "\.\.\//);
  assert.match(text, /const MCP_PORT: string = "41893";/);
  if (process.platform !== "win32") assert.equal(statSync(paths.launcher).mode & 0o777, 0o755);
  rmSync(home, { recursive: true });
});

test("installing the wrapper alone writes the wrapper and its own bundle only", () => {
  const { home, paths } = fresh();
  installTrustWrapperProgram({ paths });
  assert.deepEqual(names(path.join(home, ".crewrig")), ["service-lib", "tls-exec.ts"]);
  assert.deepEqual(names(path.join(home, ".crewrig", "service-lib")), flat(TRUST_WRAPPER_BUNDLE));
  rmSync(home, { recursive: true });
});

test("bundle files are copied verbatim", () => {
  const { home, paths } = fresh();
  installLauncherProgram({ paths, ...CONSTANTS });
  installTrustWrapperProgram({ paths });
  for (const file of SERVICE_LIB_FILES) {
    const installed = path.join(home, ".crewrig", "service-lib", path.basename(file));
    assert.equal(
      readFileSync(installed, "utf8"),
      readFileSync(path.join(REPO_LIB_DIR, file), "utf8"),
    );
  }
  assert.deepEqual(names(path.join(home, ".crewrig", "service-lib")), flat(SERVICE_LIB_FILES));
  rmSync(home, { recursive: true });
});

test("override paths get their own service-lib beside each program", () => {
  const { home } = fresh();
  const env = {
    MEMPALACE_MCP_LAUNCHER_PATH: path.join(home, "a", "launch.sh"),
    MEMPALACE_TLS_EXEC_PATH: path.join(home, "b", "wrap.sh"),
  };
  const paths = installedPaths(home, env);
  installLauncherProgram({ paths, ...CONSTANTS });
  installTrustWrapperProgram({ paths });
  assert.deepEqual(names(path.join(home, "a", "service-lib")), flat(LAUNCHER_BUNDLE));
  assert.deepEqual(names(path.join(home, "b", "service-lib")), flat(TRUST_WRAPPER_BUNDLE));
  assert.equal(existsSync(path.join(home, ".crewrig")), false);
  uninstallPrograms("mcp", paths, ["chroma"]);
  assert.equal(existsSync(path.join(home, "a", "service-lib")), false);
  assert.deepEqual(names(path.join(home, "b", "service-lib")), flat(TRUST_WRAPPER_BUNDLE));
  rmSync(home, { recursive: true });
});

function both(): { home: string; paths: ReturnType<typeof installedPaths> } {
  const made = fresh();
  installLauncherProgram({ paths: made.paths, ...CONSTANTS });
  installTrustWrapperProgram({ paths: made.paths });
  return made;
}

test("uninstall MCP first: launcher and record go, the wrapper's bundle stays, then it all goes", () => {
  const { home, paths } = both();
  const lib = path.join(home, ".crewrig", "service-lib");
  uninstallPrograms("mcp", paths, ["chroma"]);
  assert.equal(existsSync(paths.launcher), false);
  assert.equal(existsSync(paths.record), false);
  assert.equal(existsSync(paths.wrapper), true);
  assert.deepEqual(names(lib), flat(TRUST_WRAPPER_BUNDLE));
  uninstallPrograms("chroma", paths, []);
  assert.equal(existsSync(paths.wrapper), false);
  assert.equal(existsSync(lib), false);
  rmSync(home, { recursive: true });
});

test("uninstall ChromaDB first: the wrapper goes, the launcher's bundle stays, then it all goes", () => {
  const { home, paths } = both();
  const lib = path.join(home, ".crewrig", "service-lib");
  uninstallPrograms("chroma", paths, ["mcp"]);
  assert.equal(existsSync(paths.wrapper), false);
  assert.equal(existsSync(paths.launcher), true);
  assert.deepEqual(names(lib), flat(LAUNCHER_BUNDLE));
  uninstallPrograms("mcp", paths, []);
  assert.equal(existsSync(paths.launcher), false);
  assert.equal(existsSync(paths.record), false);
  assert.equal(existsSync(lib), false);
  rmSync(home, { recursive: true });
});

test("uninstall leaves a foreign file in service-lib and is idempotent", () => {
  const { home, paths } = both();
  const lib = path.join(home, ".crewrig", "service-lib");
  writeFileSync(path.join(lib, "mine.txt"), "x");
  uninstallPrograms("mcp", paths, []);
  uninstallPrograms("chroma", paths, []);
  assert.deepEqual(names(lib), ["mine.txt"]);
  assert.deepEqual(uninstallPrograms("mcp", paths, []), []);
  rmSync(home, { recursive: true });
});

test("the hash covers the launcher entry, the wrapper, then the bundle in order", () => {
  const expected = createHash("sha256");
  for (const f of [LAUNCHER_ENTRY, "service/launcher/trust-wrapper.ts", ...SERVICE_LIB_FILES]) {
    expected.update(readFileSync(path.join(REPO_LIB_DIR, f)));
  }
  assert.equal(launcherSourceSha(), expected.digest("hex"));
  // a change to a bundled module is drift too
  const lib = mkdtempSync(path.join(tmpdir(), "prog-lib-"));
  cpSync(REPO_LIB_DIR, lib, { recursive: true });
  writeFileSync(
    path.join(lib, "tls-env.ts"),
    `${readFileSync(path.join(lib, "tls-env.ts"), "utf8")}\n// x\n`,
  );
  assert.notEqual(launcherSourceSha(lib), launcherSourceSha());
  rmSync(lib, { recursive: true });
});

test("a residual placeholder refuses the install and writes no program", () => {
  const { home, paths } = fresh();
  const lib = mkdtempSync(path.join(tmpdir(), "prog-lib-"));
  cpSync(REPO_LIB_DIR, lib, { recursive: true });
  const entry = path.join(lib, LAUNCHER_ENTRY);
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\nconst X = "__NEW_THING__";\n`);
  assert.throws(
    () => installLauncherProgram({ paths, libDir: lib, ...CONSTANTS }),
    /__NEW_THING__/,
  );
  assert.equal(existsSync(paths.launcher), false);
  assert.equal(existsSync(paths.record), false);
  rmSync(home, { recursive: true });
  rmSync(lib, { recursive: true });
});

test("no staging file is left and the record is read back by parseLauncher", () => {
  const { home, paths } = fresh();
  const sha = installLauncherProgram({ paths, ...CONSTANTS });
  assert.equal(
    readdirSync(path.join(home, ".crewrig")).some((n) => n.endsWith(".tmp")),
    false,
  );
  const record = readFileSync(paths.record, "utf8");
  assert.equal(parseLauncher(record)?.host, "127.0.0.1");
  assert.equal(parseLauncher(record)?.port, 41893);
  assert.deepEqual(parseRecord(record), {
    host: "127.0.0.1",
    port: "41893",
    sourceSha: sha,
    program: paths.launcher,
  });
  assert.equal(recordForm(record).form, "typescript");
  assert.equal(sha, launcherSourceSha());
  rmSync(home, { recursive: true });
});
