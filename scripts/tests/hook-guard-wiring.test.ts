// hook-guard-wiring.test.ts — the guard's descriptor, manifests and rendered
// command lines (spec 0248 R27-R29; named edits v1-F1 and v1-F2).
//
// The manifests: only the guard entries of the four `hooks/*-transcript-hooks.json`
// differ from their state at 7302366 (committed in fixtures/worktree-guard/
// manifests/), byte for byte, so events, matchers, names, the Antigravity
// `timeout` and every `mempalace-transcript` entry are untouched (R28; row C3
// updates the baselines for its own entries). The command line of each CLI is
// the one hook-command.ts produces (R29), rendered by `hook-wiring.ts guard
// render`, which the Bash setups call.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  antigravityState,
  GUARDED_PREFIX,
  hookCommandLine,
  MEASURED_SURFACES,
  type Cli,
} from "../lib/hook-command.ts";
import { WORKTREE_GIT_GUARD } from "../lib/hook-descriptor.ts";
import { isHookCommand } from "../lib/hook-recognition.ts";
import {
  CLIS,
  guardCommands,
  handlers,
  makeCheckout,
  wiring,
  type GuardCli,
  type Json,
} from "./lib/guard-wiring-fixtures.ts";
import { cleanupAll, read, REPO } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const BASELINES = path.join(REPO, "scripts", "tests", "fixtures", "worktree-guard", "manifests");

describe("the descriptor (R27)", () => {
  test("one descriptor: basename worktree-git-guard, no arguments, guardedPrefix set", () => {
    assert.equal(WORKTREE_GIT_GUARD.id, "worktree-git-guard");
    assert.equal(WORKTREE_GIT_GUARD.basename, "worktree-git-guard");
    assert.equal(WORKTREE_GIT_GUARD.guardedPrefix, true);
    assert.deepEqual(WORKTREE_GIT_GUARD.args("claude", "PreToolUse"), []);
    const pattern = new RegExp(`^(?:${WORKTREE_GIT_GUARD.argsPattern ?? ""})$`);
    assert.ok(pattern.test("") && pattern.test("  "), "accepts no arguments");
    assert.ok(!pattern.test(" --strict") && !pattern.test(" claude-code Stop"), "rejects any");
  });

  test("the guard parses by recognition; the usage-capture descriptor still rejects the guarded prefix", () => {
    assert.ok(isHookCommand('node "/x/hooks/worktree-git-guard.ts"', WORKTREE_GIT_GUARD));
    assert.ok(isHookCommand('bash "/x/hooks/worktree-git-guard.sh"', WORKTREE_GIT_GUARD));
    assert.ok(
      isHookCommand(`${GUARDED_PREFIX}node C:/x/hooks/worktree-git-guard.ts`, WORKTREE_GIT_GUARD),
    );
  });
});

describe("the four manifests differ from 7302366 in the guard command only (R28)", () => {
  const expected: Record<GuardCli, [from: string, to: string]> = {
    claude: [
      'bash \\"$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.sh\\"',
      'node \\"$CLAUDE_PROJECT_DIR/hooks/worktree-git-guard.ts\\"',
    ],
    gemini: [
      "bash ${GEMINI_PROJECT_DIR}/hooks/worktree-git-guard.sh",
      'node \\"${GEMINI_PROJECT_DIR}/hooks/worktree-git-guard.ts\\"',
    ],
    copilot: [
      'bash \\"${COPILOT_PROJECT_DIR:-$PWD}/hooks/worktree-git-guard.sh\\"',
      'node \\"${COPILOT_PROJECT_DIR:-$PWD}/hooks/worktree-git-guard.ts\\"',
    ],
    antigravity: ["bash hooks/worktree-git-guard.sh", "node hooks/worktree-git-guard.ts"],
  };
  for (const cli of CLIS) {
    test(`${cli}: the baseline with the guard command swapped is the committed file, byte for byte`, () => {
      const baseline = read(path.join(BASELINES, `${cli}-transcript-hooks.baseline.json`));
      const [from, to] = expected[cli];
      assert.ok(baseline.includes(from), `the baseline carries ${from}`);
      const current = read(path.join(REPO, "hooks", `${cli}-transcript-hooks.json`));
      assert.equal(current, baseline.replace(from, to));
    });
  }

  test("every guard entry names the .ts; no manifest carries a Windows-unusable NAME=value prefix", () => {
    for (const cli of CLIS) {
      const commands = guardCommands(
        JSON.parse(read(path.join(REPO, "hooks", `${cli}-transcript-hooks.json`))),
      );
      assert.equal(commands.length, 1, cli);
      assert.match(commands[0] ?? "", /^node .*hooks\/worktree-git-guard\.ts"?$/);
      assert.doesNotMatch(commands[0] ?? "", /^[A-Za-z_][A-Za-z0-9_]*=/);
    }
  });
});

describe("the command line of each CLI (R29)", () => {
  const ABS = "/srv/co/crewrig/hooks/worktree-git-guard.ts";
  const WIN = "C:/Users/ana/crewrig/hooks/worktree-git-guard.ts";
  const line = (cli: Cli, platform: NodeJS.Platform, scriptPath: string) =>
    hookCommandLine({ cli, surface: "hooks", platform, scriptPath, args: [] });

  test("every CLI on macOS and Linux: node and the quoted absolute path", () => {
    for (const platform of ["darwin", "linux"] as const) {
      for (const cli of CLIS) {
        assert.deepEqual(line(cli, platform, ABS), { ok: true, command: `node "${ABS}"` }, cli);
      }
    }
  });

  test("Claude Code, Gemini CLI and Copilot CLI on Windows: the same text, the path spelled out, no token, no env prefix", () => {
    for (const cli of ["claude", "gemini", "copilot"] as const) {
      assert.deepEqual(line(cli, "win32", WIN), { ok: true, command: `node "${WIN}"` }, cli);
    }
  });

  test("Antigravity CLI on Windows, state (e): the guarded form, the path unquoted and in forward slashes", () => {
    const entry = MEASURED_SURFACES.find(
      (m) => m.cli === "antigravity" && m.surface === "hooks" && m.os === "win32",
    );
    assert.equal(antigravityState(entry), "e", "the committed constant is in state (e)");
    assert.deepEqual(line("antigravity", "win32", WIN), {
      ok: true,
      command: `set NoDefaultCurrentDirectoryInExePath=1&& node ${WIN}`,
    });
  });

  test("a checkout path with whitespace: the module refuses for Antigravity CLI, names the whitespace and the path", () => {
    const result = line(
      "antigravity",
      "win32",
      "C:/Users/Ana Diaz/crewrig/hooks/worktree-git-guard.ts",
    );
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.refusal, /whitespace/);
    assert.match(result.ok ? "" : result.refusal, /C:\/Users\/Ana Diaz\/crewrig/);
  });
});

describe("guard render (R28, R29, v1-F1, v1-F2)", () => {
  /** The guard handlers of a manifest, and the manifest with their commands blanked. */
  const withoutGuardCommands = (manifest: Json): unknown =>
    JSON.parse(JSON.stringify(manifest), (_key, value: unknown) =>
      typeof value === "string" && value.includes("worktree-git-guard") ? "<guard>" : value,
    );

  for (const cli of CLIS) {
    test(`${cli}: only the guard's command is rendered, to the direct form on the physical checkout path`, () => {
      const co = makeCheckout();
      const res = wiring("guard", "render", cli, "--manifest", co.manifest(cli), "--repo", co.repo);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout.trim().split("\n").length, 1, "one line of compact JSON");
      const rendered = JSON.parse(res.stdout) as Json;
      assert.deepEqual(guardCommands(rendered), [`node "${co.guard}"`]);
      assert.deepEqual(
        withoutGuardCommands(rendered),
        withoutGuardCommands(JSON.parse(read(co.manifest(cli))) as Json),
        "every other handler, key and entry is as read",
      );
      assert.doesNotMatch(
        guardCommands(rendered).join("\n"),
        /PROJECT_DIR|\$PWD/,
        "no token survives in the guard command",
      );
      for (const handler of handlers(rendered)) {
        if (
          typeof handler["command"] === "string" &&
          handler["command"].includes("worktree-git-guard")
        ) {
          assert.doesNotMatch(
            handler["command"],
            /^[A-Za-z_][A-Za-z0-9_]*=/,
            "no NAME=value prefix (row 37c)",
          );
        }
      }
    });
  }

  test("v1-F1: Antigravity's relative `bash hooks/worktree-git-guard.sh` is found by its named-hook key", () => {
    const co = makeCheckout();
    const manifest = path.join(path.dirname(co.repo), "relative-legacy.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        "crewrig-mempalace-transcript": {
          Stop: [
            { type: "command", command: "bash hooks/mempalace-transcript.sh Stop", timeout: 10 },
          ],
        },
        "crewrig-worktree-git-guard": {
          PreToolUse: [
            {
              matcher: "run_command",
              hooks: [{ type: "command", command: "bash hooks/worktree-git-guard.sh", timeout: 5 }],
            },
          ],
        },
      }),
    );
    const res = wiring("guard", "render", "antigravity", "--manifest", manifest, "--repo", co.repo);
    assert.equal(res.status, 0, res.stderr);
    const rendered = JSON.parse(res.stdout) as Json;
    assert.deepEqual(guardCommands(rendered), [`node "${co.guard}"`]);
    assert.equal(
      (rendered["crewrig-worktree-git-guard"] as { PreToolUse: Array<{ hooks: Json[] }> })
        .PreToolUse[0]?.hooks[0]?.["timeout"],
      5,
      "the 5-second timeout is kept",
    );
    assert.deepEqual(rendered["crewrig-mempalace-transcript"], {
      Stop: [{ type: "command", command: "bash hooks/mempalace-transcript.sh Stop", timeout: 10 }],
    });
  });

  test("Antigravity on win32: the guarded form (state e)", () => {
    const co = makeCheckout();
    const res = wiring(
      "guard",
      "render",
      "antigravity",
      "--manifest",
      co.manifest("antigravity"),
      "--repo",
      co.repo,
      "--platform",
      "win32",
    );
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(guardCommands(JSON.parse(res.stdout)), [`${GUARDED_PREFIX}node ${co.guard}`]);
  });

  test("a refusal: exit 0, a diagnostic on stderr, the guard handlers and what they emptied absent, the rest kept", () => {
    const co = makeCheckout("Ana Diaz");
    const res = wiring(
      "guard",
      "render",
      "antigravity",
      "--manifest",
      co.manifest("antigravity"),
      "--repo",
      co.repo,
      "--platform",
      "win32",
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /ERROR: .*whitespace/);
    const rendered = JSON.parse(res.stdout) as Json;
    assert.deepEqual(guardCommands(rendered), []);
    assert.equal(
      "crewrig-worktree-git-guard" in rendered,
      false,
      "the emptied hook name is dropped",
    );
    assert.ok("crewrig-mempalace-transcript" in rendered, "the transcript hook stays");
  });

  test("a refusal on Claude Code (guard entry absent) leaves the lifecycle hooks", () => {
    const co = makeCheckout("no-entry", { entry: false });
    const res = wiring(
      "guard",
      "render",
      "claude",
      "--manifest",
      co.manifest("claude"),
      "--repo",
      co.repo,
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /ERROR: /);
    const rendered = JSON.parse(res.stdout) as { hooks: Json };
    assert.deepEqual(guardCommands(rendered), []);
    assert.equal("PreToolUse" in rendered.hooks, false, "the event the guard emptied is dropped");
    assert.ok("Stop" in rendered.hooks && "SessionEnd" in rendered.hooks);
  });

  test("a missing or non-object manifest exits 1 with nothing on standard output", () => {
    const co = makeCheckout();
    const missing = wiring(
      "guard",
      "render",
      "claude",
      "--manifest",
      path.join(co.repo, "nope.json"),
      "--repo",
      co.repo,
    );
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    const array = path.join(co.repo, "array.json");
    fs.writeFileSync(array, "[]");
    const notObject = wiring("guard", "render", "claude", "--manifest", array, "--repo", co.repo);
    assert.equal(notObject.status, 1);
    assert.equal(notObject.stdout, "");
  });
});
