// hook-legacy-rewrite-without-shim-files.test.ts — spec 0266 R9 (Class B).
//
// Setup, run in-process over a scratch HOME and a checkout whose hooks/ holds NO `*.sh`, brings
// an installed `.sh`-form line of each Class B hook to the direct `node "<path>.ts"` form, a
// second run writes nothing, and an operator-edited line is left untouched. Cells already proved
// with a `.sh` present: hook-rewrite.test.ts (usage-capture grouped and flat shapes, idempotence),
// hook-guard-rewrite.test.ts (guard per CLI, second run, look-alikes), setup-hooks-rewrite.test.ts
// (transcript per CLI against the shell twin), setup-usage-capture-keep.test.ts (usage capture
// keep). This file adds the same cells with the shim files gone.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { USAGE_CAPTURE, WORKTREE_GIT_GUARD, type WiredCli } from "../lib/hook-descriptor.ts";
import type { JsonObject } from "../lib/hook-config.ts";
import { rewriteConfig } from "../lib/hook-rewrite.ts";
import { rewriteStatusline } from "../lib/hook-statusline.ts";
import { rewriteInstalledHooks } from "../lib/setup/hooks-rewrite.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIS: readonly WiredCli[] = ["claude", "gemini", "copilot"];
const CLI_ID = { claude: "claude-code", gemini: "gemini-cli", copilot: "copilot-cli" } as const;
const EVENT = { claude: "Stop", gemini: "AfterModel", copilot: "agentStop" } as const;
const HOME_DIR = { claude: ".claude", gemini: ".gemini", copilot: ".copilot" } as const;

let base: string;
let repo: string;
let home: string;

before(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-shimless-rw-")));
  repo = path.join(base, "checkout");
  home = path.join(base, "home");
  fs.mkdirSync(home);
  fs.cpSync(path.join(REPO, "hooks"), path.join(repo, "hooks"), {
    recursive: true,
    filter: (src) => !src.endsWith(".sh"),
  });
});
after(() => {
  if (base !== undefined && path.basename(base).startsWith("crewrig-shimless-rw-")) {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

const handlerOf = (command: string): JsonObject => ({ type: "command", command });
const configOf = (cli: WiredCli, event: string, commands: string[]): JsonObject => {
  const handlers = commands.map(handlerOf);
  return {
    ...(cli === "claude" ? { env: { MEMPALACE_TRANSCRIPT_ENABLED: "1" } } : {}),
    hooks: { [event]: cli === "copilot" ? handlers : [{ matcher: "", hooks: handlers }] },
  };
};
const commandsOf = (config: JsonObject, event: string): string[] => {
  const entries = (config["hooks"] as Record<string, JsonObject[]>)[event] ?? [];
  return entries.flatMap((e) =>
    Array.isArray(e["hooks"])
      ? (e["hooks"] as JsonObject[]).map((h) => h["command"] as string)
      : [e["command"] as string],
  );
};
const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isFile()) out[name] = fs.readFileSync(full, "utf8");
  }
  return out;
};

describe("usage-capture and worktree-git-guard lines, rewritten by the library", () => {
  for (const cli of CLIS) {
    for (const [descriptor, base_, args] of [
      [USAGE_CAPTURE, "usage-capture", ` ${CLI_ID[cli]} ${EVENT[cli]}`],
      [WORKTREE_GIT_GUARD, "worktree-git-guard", ""],
    ] as const) {
      test(`${cli}: ${base_} .sh line becomes node .ts, a second run is a no-op, an edited line is kept`, () => {
        assert.equal(fs.existsSync(path.join(repo, "hooks", `${base_}.sh`)), false);
        const legacy = `bash "${repo}/hooks/${base_}.sh"${args}`;
        const edited = `bash "${repo}/hooks/${base_}.sh"${args} --my-flag`;
        const input = configOf(cli, EVENT[cli], [legacy, edited]);
        const first = rewriteConfig(input, { descriptor, cli });
        assert.equal(first.rewrote, 1);
        assert.deepEqual(commandsOf(first.config, EVENT[cli]), [
          `node "${repo}/hooks/${base_}.ts"${args}`,
          edited,
        ]);
        const second = rewriteConfig(first.config, { descriptor, cli });
        assert.equal(second.changed, false);
        assert.deepEqual(second.config, first.config);
      });
    }
  }
});

describe("the legacy spaced Gemini usage-capture line", () => {
  test("is recognised and rewritten with no .sh on disk; a second run is a no-op", () => {
    const spaced = path.join(base, "my projects", "checkout");
    fs.cpSync(path.join(repo, "hooks"), path.join(spaced, "hooks"), { recursive: true });
    const legacy = `bash ${spaced}/hooks/usage-capture.sh gemini-cli AfterModel`;
    const first = rewriteConfig(configOf("gemini", "AfterModel", [legacy]), {
      descriptor: USAGE_CAPTURE,
      cli: "gemini",
    });
    assert.equal(first.rewrote, 1, JSON.stringify(first.lines));
    assert.deepEqual(commandsOf(first.config, "AfterModel"), [
      `node "${spaced}/hooks/usage-capture.ts" gemini-cli AfterModel`,
    ]);
    const second = rewriteConfig(first.config, { descriptor: USAGE_CAPTURE, cli: "gemini" });
    assert.equal(second.changed, false);
    assert.deepEqual(second.config, first.config);
  });
});

describe("setup's installed-hooks step: guard and transcript, per CLI, in a scratch HOME", () => {
  for (const cli of CLIS) {
    test(`${cli}: legacy lines move to the direct form; the second run leaves the tree byte-equal`, () => {
      const cliHome = path.join(home, HOME_DIR[cli]);
      fs.mkdirSync(path.join(cliHome, "hooks"), { recursive: true });
      const copy = path.join(cliHome, "hooks", "mempalace-transcript.sh");
      const settings = path.join(cliHome, `settings-${cli}.json`);
      const prefix = cli === "claude" ? "" : "MEMPALACE_TRANSCRIPT_ENABLED=1 ";
      const event = EVENT[cli];
      const config = configOf(cli, event, [
        `${prefix}bash "${copy}"`,
        `bash "${repo}/hooks/worktree-git-guard.sh"`,
        "/opt/operator/own-hook.sh",
      ]);
      fs.writeFileSync(settings, `${JSON.stringify(config, null, 2)}\n`);
      const run = (): void => {
        const out: string[] = [];
        const io = { out: (l: string) => void out.push(l), err: () => {}, errRaw: () => {} };
        const res = rewriteInstalledHooks({
          ctx: { io, env: {}, platform: process.platform, home, repoDir: repo },
          cli,
          settingsPath: settings,
          spawn: () => ({ status: 0, stdout: "", stderr: "" }),
          unusedCopy: "",
        });
        assert.deepEqual(res, { guard: 0, transcript: 0, usage: 0 });
      };
      run();
      const after1 = JSON.parse(fs.readFileSync(settings, "utf8")) as JsonObject;
      const lines = commandsOf(after1, event);
      assert.equal(lines.length, 3);
      assert.ok(lines.includes(`node "${repo}/hooks/worktree-git-guard.ts"`), lines.join("\n"));
      assert.ok(
        lines.some((l) => l.includes(`${repo}/hooks/mempalace-transcript.ts`)),
        lines.join("\n"),
      );
      assert.ok(lines.includes("/opt/operator/own-hook.sh"), "the operator's line is untouched");
      const snapshot = tree(home);
      run();
      assert.deepEqual(tree(home), snapshot, "a second run writes nothing, backups included");
    });
  }
});

describe("antigravity statusline", () => {
  test("a legacy .sh statusLine.command becomes node .ts and a second run writes nothing", () => {
    const agy = path.join(base, "agy");
    fs.mkdirSync(path.join(agy, "state"), { recursive: true });
    const settings = path.join(agy, "settings.json");
    const marker = path.join(agy, "state", "antigravity-statusline.json");
    const legacy = `"${repo}/hooks/antigravity-statusline-shim.sh"`;
    fs.writeFileSync(
      settings,
      `${JSON.stringify({ statusLine: { type: "command", command: legacy } }, null, 2)}\n`,
    );
    fs.writeFileSync(
      marker,
      `${JSON.stringify({ installedBy: "crewrig-setup-antigravity-interactive", installedStatusLineCommand: legacy, priorStatusLineCommand: "" }, null, 2)}\n`,
    );
    const target = { settings, marker, repo, platform: "linux" as const };
    const log: string[] = [];
    assert.equal(
      rewriteStatusline(target, (l) => void log.push(l)),
      0,
    );
    const got = (JSON.parse(fs.readFileSync(settings, "utf8")) as JsonObject)[
      "statusLine"
    ] as JsonObject;
    assert.equal(
      got["command"],
      `node "${repo}/hooks/antigravity-statusline-shim.ts"`,
      log.join("\n"),
    );
    const snapshot = tree(agy);
    assert.equal(
      rewriteStatusline(target, () => {}),
      0,
    );
    assert.deepEqual(tree(agy), snapshot);
  });

  test("an operator-edited statusLine.command is left untouched", () => {
    const agy = path.join(base, "agy-edited");
    fs.mkdirSync(path.join(agy, "state"), { recursive: true });
    const settings = path.join(agy, "settings.json");
    const marker = path.join(agy, "state", "antigravity-statusline.json");
    const edited = `"${repo}/hooks/antigravity-statusline-shim.sh" --mine`;
    fs.writeFileSync(settings, `${JSON.stringify({ statusLine: { command: edited } }, null, 2)}\n`);
    fs.writeFileSync(
      marker,
      `${JSON.stringify({ installedStatusLineCommand: "other" }, null, 2)}\n`,
    );
    const snapshot = tree(agy);
    rewriteStatusline({ settings, marker, repo, platform: "linux" }, () => {});
    assert.deepEqual(tree(agy), snapshot);
  });
});
