// service-launcher-palace-path.test.ts — consumer-level replacement of the palace-path
// assertions of test-palace-path-propagation.sh (spec 0260, sourced-library exception).
// A1-A3: the launcher text installLauncherProgram writes; A4: the child env of the
// launcher entry, run for real; A10/A11: the systemd unit with a custom palace.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { derivedTokenPath } from "../lib/service/launcher/launcher-token.ts";
import { writePythonShim } from "./lib/supervisor-stand-in.ts";
import { installLauncherProgram, installedPaths } from "../lib/service/program-install.ts";
import { materialiseChromaUnit } from "../lib/setup/chroma-unit.ts";

const realRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const posix = process.platform !== "win32";
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "launcher-palace-")));
after(() => rmSync(root, { recursive: true, force: true }));

const CUSTOM = path.join(root, "custom", "palace", "location");
const CONSTANTS = {
  repoDir: path.join(root, "repo"),
  host: "127.0.0.1",
  port: "41893",
  chromaHost: "127.0.0.1",
  chromaPort: "8001",
  python: "/pipx/bin/python",
};

function install(name: string, palacePath: string, extra: Partial<typeof CONSTANTS> = {}) {
  const home = path.join(root, name);
  mkdirSync(home, { recursive: true });
  const paths = installedPaths(home, {});
  installLauncherProgram({ paths, ...CONSTANTS, ...extra, palacePath });
  writeFileSync(path.join(path.dirname(paths.launcher), "package.json"), '{"type":"module"}\n');
  return { home, paths, text: readFileSync(paths.launcher, "utf8") };
}

// A1: unset palace -> CONFIGURED_PALACE_PATH=""
test("A1 empty palace path: the launcher records an empty CONFIGURED_PALACE_PATH", () => {
  const { text } = install("a1", "");
  assert.ok(text.includes('CONFIGURED_PALACE_PATH: string = ""'));
});

// A2: no residual placeholder, in both states
test("A2 no placeholder residue, both states", () => {
  for (const [name, palace] of [
    ["a2-empty", ""],
    ["a2-set", CUSTOM],
  ] as const) {
    const { text } = install(name, palace);
    assert.ok(!text.includes("__MEMPALACE_PALACE_PATH__"), `${name}: placeholder left`);
    assert.doesNotMatch(text, /__[A-Z][A-Z0-9_]*__/, `${name}: some placeholder left`);
  }
});

// A3: set -> the configured value is substituted (JSON-quoted, so path-aware on win32)
test("A3 custom palace path is substituted into the launcher", () => {
  const { text } = install("a3", CUSTOM);
  assert.ok(text.includes(`CONFIGURED_PALACE_PATH: string = ${JSON.stringify(CUSTOM)};`));
  const amp = path.join(root, "a&b|c");
  assert.ok(
    install("a3-amp", amp).text.includes(
      `CONFIGURED_PALACE_PATH: string = ${JSON.stringify(amp)};`,
    ),
  );
});

interface Run {
  readonly code: number | null;
  readonly dumped: string | undefined;
}

/** Run the installed launcher against a stand-in daemon that dumps its own palace env. */
async function runLauncher(name: string, palace: string, ambient?: string): Promise<Run> {
  const chroma = http.createServer((_q, res) => res.end("{}"));
  await new Promise<void>((r) => chroma.listen(0, "127.0.0.1", r));
  const free = net.createServer();
  await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
  const mcpPort = (free.address() as net.AddressInfo).port;
  await new Promise<void>((r) => free.close(() => r()));
  const repoDir = path.join(root, `${name}-repo`);
  const dump = path.join(root, `${name}-dump`);
  const shim = writePythonShim(
    path.join(root, name, ".crewrig", "service-lib"),
    `"use strict";\nrequire("node:fs").writeFileSync(${JSON.stringify(dump)}, ` +
      `process.env.MEMPALACE_PALACE_PATH === undefined ? "<unset>" : process.env.MEMPALACE_PALACE_PATH);\n`,
  );
  const { home, paths } = install(name, palace, {
    repoDir,
    port: String(mcpPort),
    chromaPort: String((chroma.address() as net.AddressInfo).port),
    python: shim,
  });
  const tokenFile = path.join(root, `${name}-token`);
  writeFileSync(tokenFile, "t".repeat(40));
  chmodSync(tokenFile, 0o600);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    NO_PROXY: "127.0.0.1,localhost",
    MEMPALACE_MCP_TOKEN_FILE: tokenFile,
    MEMPALACE_MCP_CHROMA_WAIT: "5",
  };
  if (ambient !== undefined) env.MEMPALACE_PALACE_PATH = ambient;
  try {
    const child = spawn(process.execPath, [paths.launcher], { env, stdio: "ignore" });
    const code = await new Promise<number | null>((r) => child.on("close", r));
    return { code, dumped: existsSync(dump) ? readFileSync(dump, "utf8") : undefined };
  } finally {
    chroma.close();
  }
}

// A4: the launcher exports the configured path to the daemon env (behavioural)
test("A4 child env carries the configured MEMPALACE_PALACE_PATH", { skip: !posix }, async () => {
  const set = await runLauncher("a4-set", CUSTOM, "/ambient/ignored");
  assert.equal(set.dumped, CUSTOM, "configured value reaches the daemon, over the ambient one");
  const none = await runLauncher("a4-empty", "");
  assert.equal(none.dumped, "<unset>", "empty configuration leaves the variable unset");
  const kept = await runLauncher("a4-ambient", "", "/ambient/kept");
  assert.equal(
    kept.dumped,
    "/ambient/kept",
    "empty configuration does not clobber the ambient value",
  );
});

// A10, A11: systemd service with a custom palace
test("A10 service unit custom path / A11 no residue", { skip: !posix }, () => {
  const repoDir = path.join(root, "unit-repo");
  const home = path.join(root, "unit-home");
  const venv = path.join(root, "unit-venv", "bin");
  for (const rel of ["config/systemd/mempalace-chroma-server.service", "scripts/tls-exec.ts"]) {
    mkdirSync(path.dirname(path.join(repoDir, rel)), { recursive: true });
    writeFileSync(path.join(repoDir, rel), readFileSync(path.join(realRepo, rel)));
  }
  mkdirSync(venv, { recursive: true });
  writeFileSync(path.join(venv, "chroma"), "#!/bin/sh\n");
  chmodSync(path.join(venv, "chroma"), 0o755);
  const target = path.join(home, "chroma.service");
  const custom = "/var/data/custom-palace";
  const res = materialiseChromaUnit({
    ctx: {
      io: { out: () => {}, err: () => {}, errRaw: () => {} },
      env: { MEMPALACE_PALACE_PATH: custom },
      platform: process.platform,
      home,
      repoDir,
    },
    template: path.join(repoDir, "config", "systemd", "mempalace-chroma-server.service"),
    target,
    python: path.join(venv, "python"),
  });
  assert.equal(res.ok, true);
  const text = readFileSync(target, "utf8");
  assert.ok(text.includes(`--path ${custom}`));
  assert.ok(!text.includes("__CHROMA_PALACE_PATH__"));
});

// A13 (token path is keyed on the RESOLVED palace path, as `mcp_token_path` computed with
// `cd -P`): a symlinked palace path and its target derive the same token path. The
// existing service-launcher-token.test.ts compares three derivations on a plain directory
// only, so this symlink leg is what a removed realpath would break.
test("A13 a symlinked palace path derives the token path of its target", { skip: !posix }, () => {
  const home = path.join(root, "a13-home");
  const real = path.join(root, "a13-real-palace");
  const link = path.join(root, "a13-link-palace");
  mkdirSync(home, { recursive: true });
  mkdirSync(real, { recursive: true });
  symlinkSync(real, link, "dir");
  assert.equal(derivedTokenPath(link, home), derivedTokenPath(real, home));
  assert.match(
    path.relative(home, derivedTokenPath(link, home)),
    /^\.mempalace[\\/]server[\\/][0-9a-f]{24}[\\/]token$/,
  );
});
