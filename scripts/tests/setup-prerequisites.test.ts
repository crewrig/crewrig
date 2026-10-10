// setup-prerequisites.test.ts — the prerequisite and identity checks of the setup graph (spec 0256
// requirement 21, plan v2 step B1.10). PATH stubs in a temporary directory, a fake Spawner for
// `gh copilot --help`; the Windows lookup (`PATHEXT`) goes through the platform seam of the context.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { Cli, SpawnResult, Spawner } from "../lib/setup/context.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import {
  checkIdentity,
  checkPrerequisites,
  identityInvocation,
} from "../lib/setup/prerequisites.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  bin: string;
  repo: string;
  out: string[];
  ctx: (
    cli: Cli,
    platform?: NodeJS.Platform,
    env?: Record<string, string>,
  ) => Parameters<typeof checkIdentity>[0];
}

function fixture(): Fixture {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-prereq-")));
  temps.push(root);
  const bin = path.join(root, "bin");
  const repo = path.join(root, "repo");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(repo, "config"), { recursive: true });
  const out: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: () => undefined,
    errRaw: () => undefined,
  };
  return {
    bin,
    repo,
    out,
    ctx: (cli, platform = process.platform, env = {}) => ({
      io,
      env: { PATH: bin, ...env },
      platform,
      repoDir: repo,
      cli,
    }),
  };
}

const stub = (dir: string, name: string): void =>
  fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n", { mode: 0o755 });

const spawnWith = (status: number): { spawn: Spawner; argvs: (readonly string[])[] } => {
  const argvs: (readonly string[])[] = [];
  const spawn: Spawner = (argv): SpawnResult => {
    argvs.push(argv);
    return { status, stdout: "", stderr: "" };
  };
  return { spawn, argvs };
};

function exitOf(run: () => void): number | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof SetupExit) return error.status;
    throw error;
  }
  return undefined;
}

describe("checkPrerequisites", () => {
  test("claude: missing prints the two-line error on stdout and exits 1; present is silent", () => {
    const fx = fixture();
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("claude"))),
      1,
    );
    assert.deepEqual(fx.out, [
      "Error: 'claude' CLI is required to register MCP servers.",
      "Install Claude Code: https://docs.claude.com/en/docs/claude-code/setup",
    ]);
    fx.out.length = 0;
    stub(fx.bin, "claude");
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("claude"))),
      undefined,
    );
    assert.deepEqual(fx.out, []);
  });

  test("antigravity: agy missing prints the two-line error and exits 1", () => {
    const fx = fixture();
    stub(fx.bin, "claude");
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("antigravity"))),
      1,
    );
    assert.deepEqual(fx.out, [
      "Error: 'agy' binary not found in PATH.",
      "Install Antigravity CLI: https://docs.antigravity.ai/install",
    ]);
    fx.out.length = 0;
    stub(fx.bin, "agy");
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("antigravity"))),
      undefined,
    );
    assert.deepEqual(fx.out, []);
  });

  test("copilot: only a warning, printed when neither gh copilot nor copilot is found", () => {
    const fx = fixture();
    const { spawn, argvs } = spawnWith(1);
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("copilot"), spawn)),
      undefined,
    );
    assert.deepEqual(argvs, [["gh", "copilot", "--help"]]);
    assert.deepEqual(fx.out, [
      "Warning: GitHub Copilot CLI not detected.",
      "  Install with: gh extension install github/gh-copilot",
      "  or follow: https://docs.github.com/copilot/github-copilot-in-the-cli",
      "  Proceeding anyway — settings files will be written to the repo.",
      "",
    ]);
  });

  test("copilot: no warning when gh copilot answers, or when copilot is on PATH", () => {
    const fx = fixture();
    checkPrerequisites(fx.ctx("copilot"), spawnWith(0).spawn);
    stub(fx.bin, "copilot");
    checkPrerequisites(fx.ctx("copilot"), spawnWith(127).spawn);
    assert.deepEqual(fx.out, []);
  });

  test("gemini: no tool is required (the fzf and jq guards are removed)", () => {
    const fx = fixture();
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("gemini"))),
      undefined,
    );
    assert.deepEqual(fx.out, []);
  });

  test("win32: the lookup crosses PATH with PATHEXT (claude.CMD satisfies claude)", () => {
    const fx = fixture();
    const env = { PATHEXT: ".EXE;.CMD" };
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("claude", "win32", env))),
      1,
    );
    stub(fx.bin, "claude.CMD");
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("claude", "win32", env))),
      undefined,
    );
    stub(fx.bin, "agy.EXE");
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("antigravity", "win32", env))),
      undefined,
    );
  });

  test("posix: a name with an extension is not matched through PATHEXT", () => {
    const fx = fixture();
    stub(fx.bin, "claude.CMD");
    assert.equal(
      exitOf(() => checkPrerequisites(fx.ctx("claude", "linux", { PATHEXT: ".CMD" }))),
      1,
    );
  });
});

describe("checkIdentity", () => {
  const clis: readonly (readonly [Cli, string, string])[] = [
    ["claude", "claude /init-soul", "claude /init-personal-profile"],
    ["gemini", "gemini /init-soul", "gemini /init-personal-profile"],
    ["copilot", 'copilot -i "/init-soul"', 'copilot -i "/init-personal-profile"'],
    [
      "antigravity",
      'agy -i "/init-soul" --new-project',
      'agy -i "/init-personal-profile" --new-project',
    ],
  ];

  for (const [cli, soul, profile] of clis) {
    test(`${cli}: both files missing lists both with the per-CLI invocation and exits 1`, () => {
      const fx = fixture();
      assert.equal(
        exitOf(() => checkIdentity(fx.ctx(cli))),
        1,
      );
      assert.deepEqual(fx.out, [
        "Cannot proceed — required identity files are missing:",
        `  - config/SOUL.md is missing — run: ${soul}`,
        `  - config/PROFILE.md is missing — run: ${profile}`,
        "",
        "Generate them BEFORE re-running this script.",
      ]);
    });
  }

  test("only the missing file is listed; both present is silent", () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.repo, "config", "SOUL.md"), "soul\n");
    assert.equal(
      exitOf(() => checkIdentity(fx.ctx("claude"))),
      1,
    );
    assert.deepEqual(fx.out.slice(1, -2), [
      "  - config/PROFILE.md is missing — run: claude /init-personal-profile",
    ]);
    fx.out.length = 0;
    fs.writeFileSync(path.join(fx.repo, "config", "PROFILE.md"), "profile\n");
    assert.equal(
      exitOf(() => checkIdentity(fx.ctx("claude"))),
      undefined,
    );
    assert.deepEqual(fx.out, []);
  });

  test("a directory named SOUL.md is not the file the shell's -f test accepts", () => {
    const fx = fixture();
    fs.mkdirSync(path.join(fx.repo, "config", "SOUL.md"));
    fs.writeFileSync(path.join(fx.repo, "config", "PROFILE.md"), "profile\n");
    assert.equal(
      exitOf(() => checkIdentity(fx.ctx("gemini"))),
      1,
    );
    assert.equal(fx.out[1], "  - config/SOUL.md is missing — run: gemini /init-soul");
  });

  test("identityInvocation builds the string of each CLI", () => {
    assert.equal(identityInvocation("copilot", "/x"), 'copilot -i "/x"');
    assert.equal(identityInvocation("antigravity", "/x"), 'agy -i "/x" --new-project');
    assert.equal(identityInvocation("claude", "/x"), "claude /x");
  });
});
