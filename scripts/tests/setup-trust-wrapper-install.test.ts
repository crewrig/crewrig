import assert from "node:assert/strict";
import { test } from "node:test";

import { mempalaceStdioEntry, sequentialThinkingEntry } from "../lib/setup/mempalace-stdio.ts";
import {
  buildAfterWrapperInstall,
  ensureTrustWrapperInstalled,
} from "../lib/setup/trust-wrapper-install.ts";
import type { TrustWrapperDeps } from "../lib/setup/trust-wrapper-install.ts";
import { wrapperScriptPath } from "../lib/setup/trust-wrapper.ts";

const winCtx = { platform: "win32", home: "C:\\Users\\Jane Doe", env: {} } as const;
const posixCtx = { platform: "linux", home: "/home/a", env: {} } as const;

function recorder(log: string[]): TrustWrapperDeps {
  return { install: (opts) => void log.push(`install:${opts.paths.wrapper}`) };
}

test("win32: installs the wrapper once and returns its path", () => {
  const log: string[] = [];
  const wrapper = ensureTrustWrapperInstalled(winCtx, recorder(log));
  assert.equal(log.length, 1);
  assert.ok(wrapper?.endsWith("tls-exec.ts"));
  assert.equal(log[0], `install:${wrapper}`);
});

test("win32: the installed path is the one the stdio entries name (default location)", () => {
  // `installedPaths` joins with the host separator; compare the file name and the directory name.
  const log: string[] = [];
  const wrapper = ensureTrustWrapperInstalled(winCtx, recorder(log));
  const named = wrapperScriptPath({ ...winCtx, repoDir: "C:\\src" });
  assert.ok(wrapper !== undefined);
  assert.equal(
    wrapper.split(/[\\/]/).slice(-2).join("/"),
    named.split(/[\\/]/).slice(-2).join("/"),
  );
});

test("POSIX: nothing is installed", () => {
  const log: string[] = [];
  assert.equal(ensureTrustWrapperInstalled(posixCtx, recorder(log)), undefined);
  assert.deepEqual(log, []);
});

test("win32: the install runs before any entry is built", () => {
  const log: string[] = [];
  const env = { platform: "win32", home: winCtx.home, repoDir: "C:\\src" } as const;
  const entries = buildAfterWrapperInstall(winCtx, recorder(log), () => {
    log.push("build");
    return [mempalaceStdioEntry("claude", env, "python"), sequentialThinkingEntry("claude", env)];
  });
  assert.equal(log.length, 2);
  assert.ok(log[0]?.startsWith("install:"));
  assert.equal(log[1], "build");
  assert.equal(entries.length, 2);
});

test("POSIX: build still runs, with no install", () => {
  const log: string[] = [];
  const built = buildAfterWrapperInstall(posixCtx, recorder(log), () => {
    log.push("build");
    return 1;
  });
  assert.equal(built, 1);
  assert.deepEqual(log, ["build"]);
});

test("a failing install stops the build", () => {
  let built = false;
  const failing: TrustWrapperDeps = {
    install: () => {
      throw new Error("disk full");
    },
  };
  assert.throws(
    () =>
      buildAfterWrapperInstall(winCtx, failing, () => {
        built = true;
      }),
    /disk full/,
  );
  assert.equal(built, false);
});
