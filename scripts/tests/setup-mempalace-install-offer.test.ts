// setup-mempalace-install-offer.test.ts — offerMempalaceInstall
// (scripts/lib/setup/mempalace-install-offer.ts) with a fake Spawner, fake prompt and a PATH built
// in a temporary directory.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SpawnOptions, SpawnResult, Spawner } from "../lib/setup/context.ts";
import { offerMempalaceInstall } from "../lib/setup/mempalace-install-offer.ts";
import type { PromptSession, Question } from "../lib/setup/prompt.ts";

const PIN = { min: "3.6.0", maxExclusive: "3.7" };
const SPEC = "mempalace>=3.6.0,<3.7";
const POSIX = process.platform === "win32";

let dir: string;
let out: string[];
let asked: Question[];
let calls: { argv: readonly string[]; options: SpawnOptions | undefined }[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-mp-offer-")));
  out = [];
  asked = [];
  calls = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const session = (answer: string | undefined): PromptSession => ({
  choose: async (q) => (asked.push(q), answer),
  confirm: async () => answer,
  close: () => undefined,
});
const spawner =
  (status = 0): Spawner =>
  (argv, options) => {
    calls.push({ argv, options });
    const result: SpawnResult = { status, stdout: "", stderr: "" };
    return result;
  };

/** A PATH directory holding an executable `name` (with the suffix the platform names it by). */
function pathWith(name: string): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), "#!/bin/sh\n", { mode: 0o755 });
  return bin;
}

function offer(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  answer: string | undefined,
  status = 0,
): Promise<boolean> {
  return offerMempalaceInstall({
    ctx: {
      io: { out: (l) => out.push(l), err: () => undefined, errRaw: () => undefined },
      env,
      platform,
      repoDir: dir,
    },
    session: session(answer),
    spawn: spawner(status),
    deps: { pin: () => PIN },
  });
}

describe("pipx absent", () => {
  it("prints the POSIX guidance verbatim, asks nothing, spawns nothing, returns false", async () => {
    assert.equal(await offer("linux", { PATH: path.join(dir, "empty") }, "yes"), false);
    assert.deepEqual(out, [
      "  pipx not found — install MemPalace manually:",
      "    pipx install 'mempalace>=3.6.0,<3.7'",
      "  Install pipx: brew install pipx (macOS) or python3 -m pip install --user pipx",
    ]);
    assert.deepEqual(asked, []);
    assert.deepEqual(calls, []);
  });

  it("prints the Windows forms of deviation (q) on win32", async () => {
    assert.equal(await offer("win32", { PATH: path.join(dir, "empty") }, "yes"), false);
    assert.deepEqual(out, [
      "  pipx not found — install MemPalace manually:",
      "    pipx install 'mempalace>=3.6.0,<3.7'",
      "  Install pipx: scoop install pipx or py -m pip install --user pipx",
    ]);
    assert.deepEqual(asked, []);
    assert.deepEqual(calls, []);
  });

  it("a missing PATH variable counts as absent", async () => {
    assert.equal(await offer("linux", {}, "yes"), false);
    assert.equal(out.length, 3);
  });
});

describe("pipx present", { skip: POSIX }, () => {
  it("asks mempalace-install with the shell header, options no and yes, cancel decline", async () => {
    await offer("linux", { PATH: pathWith("pipx") }, "no");
    assert.deepEqual(asked, [
      {
        id: "mempalace-install",
        header: "MemPalace not found — install via pipx now? (mempalace>=3.6.0,<3.7)",
        options: ["no", "yes"],
        cancel: "decline",
      },
    ]);
  });

  it("no: prints the skip line, spawns nothing, returns false", async () => {
    assert.equal(await offer("linux", { PATH: pathWith("pipx") }, "no"), false);
    assert.deepEqual(out, ["  MemPalace install skipped."]);
    assert.deepEqual(calls, []);
  });

  it("a cancelled question (undefined) is a decline", async () => {
    assert.equal(await offer("linux", { PATH: pathWith("pipx") }, undefined), false);
    assert.deepEqual(out, ["  MemPalace install skipped."]);
    assert.deepEqual(calls, []);
  });

  it("any answer other than yes is a decline", async () => {
    assert.equal(await offer("linux", { PATH: pathWith("pipx") }, "Yes please"), false);
    assert.deepEqual(out, ["  MemPalace install skipped."]);
  });

  it("yes: runs pipx install with one argv element for the range, output inherited", async () => {
    assert.equal(await offer("linux", { PATH: pathWith("pipx") }, "yes"), true);
    assert.deepEqual(calls, [{ argv: ["pipx", "install", SPEC], options: { inherit: true } }]);
    assert.deepEqual(out, ["  MemPalace installed."]);
  });

  it("yes with a failing pipx: prints the failure line and returns false", async () => {
    assert.equal(await offer("linux", { PATH: pathWith("pipx") }, "yes", 1), false);
    assert.equal(calls.length, 1);
    assert.deepEqual(out, [
      "  pipx install failed — install MemPalace manually then re-run this script.",
    ]);
  });
});

describe("pipx present on win32", { skip: POSIX }, () => {
  it("finds pipx.exe through PATHEXT and runs the same argv", async () => {
    const env = { PATH: pathWith("pipx.exe"), PATHEXT: ".exe" };
    assert.equal(await offer("win32", env, "yes"), true);
    assert.deepEqual(calls, [{ argv: ["pipx", "install", SPEC], options: { inherit: true } }]);
    assert.deepEqual(out, ["  MemPalace installed."]);
  });
});

describe("the pin", () => {
  it("is read from scripts/lib/common.sh of the repository by default", async () => {
    fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "scripts", "lib", "common.sh"),
      'MEMPALACE_MIN_VERSION="1.2.3"\nMEMPALACE_MAX_VERSION_EXCLUSIVE="1.3"\n',
    );
    const result = await offerMempalaceInstall({
      ctx: {
        io: { out: (l) => out.push(l), err: () => undefined, errRaw: () => undefined },
        env: { PATH: "" },
        platform: "linux",
        repoDir: dir,
      },
      session: session("yes"),
      spawn: spawner(),
    });
    assert.equal(result, false);
    assert.equal(out[1], "    pipx install 'mempalace>=1.2.3,<1.3'");
  });
});
