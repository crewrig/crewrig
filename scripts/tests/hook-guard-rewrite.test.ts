// hook-guard-rewrite.test.ts — `hook-wiring.ts guard rewrite` and
// `guard antigravity-rewrite`: bringing an installed guard registration to the
// current command line (spec 0248 R30, R31, R32; scenarios 19, 21).
//
// Per CLI: a legacy `bash "<checkout>/hooks/worktree-git-guard.sh"` becomes
// `node "<checkout>/hooks/worktree-git-guard.ts"` after a 0600 backup, event,
// matcher, name, key order and every other entry kept; reported by name and
// count; idempotent (a second run writes nothing and makes no backup); a
// configuration that is not a JSON object refused byte-identical; another
// checkout's command left unless its `.ts` sits next to its `.sh`; a hook that
// merely names the script, and every `mempalace-transcript` command, never
// touched; no configuration content on any argument list and no subprocess.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  backups,
  guardCommands,
  makeCheckout,
  mode,
  WIRING,
  wiring,
  type Checkout,
  type Json,
} from "./lib/guard-wiring-fixtures.ts";
import type { SpyRecord } from "./lib/spawn-spy.ts";
import { cleanupAll, read, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const SPY = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "spawn-spy.ts");
const REWRITE_CLIS = ["claude", "gemini", "copilot"] as const;
type RewriteCli = (typeof REWRITE_CLIS)[number];

const handler = (command: string, extra: Json = {}): Json => ({
  type: "command",
  command,
  ...extra,
});
const TRANSCRIPT = 'bash "$HOME/.claude/hooks/mempalace-transcript.sh"';

/** A configuration of `cli`'s shape holding `guardHandlers` on its guard event and one transcript hook elsewhere. */
function configOf(cli: RewriteCli, guardHandlers: Json[]): Json {
  switch (cli) {
    case "claude":
      return {
        model: "opus",
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [...guardHandlers, handler("echo mine")] }],
          Stop: [{ matcher: "", hooks: [handler(TRANSCRIPT)] }],
        },
        env: { TOKEN: "s3cr3t-do-not-leak" },
      };
    case "gemini":
      return {
        theme: "dark",
        hooks: {
          BeforeTool: [
            {
              hooks: [
                ...guardHandlers.map((g) => ({ ...g, name: "transcript-git-guard" })),
                handler("echo mine"),
              ],
            },
          ],
          SessionEnd: [{ hooks: [handler(TRANSCRIPT, { name: "transcript-session-end" })] }],
        },
        mcpServers: { x: { env: { TOKEN: "s3cr3t-do-not-leak" } } },
      };
    case "copilot":
      return {
        version: 1,
        hooks: {
          preToolUse: [...guardHandlers, handler("echo mine")],
          sessionEnd: [handler(TRANSCRIPT)],
        },
      };
  }
}

function install(cli: RewriteCli, config: Json, co: Checkout): string {
  const file = path.join(path.dirname(co.repo), `${cli}-config.json`);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
  return file;
}

const rewrite = (cli: RewriteCli, file: string, co: Checkout) =>
  wiring("guard", "rewrite", cli, "--config", file, "--repo", co.repo);

for (const cli of REWRITE_CLIS) {
  describe(`${cli}: rewriting an installed guard (R30; scenario 19)`, () => {
    test("a legacy command becomes the direct form after a 0600 backup; everything else is byte-identical", () => {
      const co = makeCheckout();
      const legacy = handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`);
      const file = install(cli, configOf(cli, [legacy]), co);
      const before = JSON.parse(read(file)) as Json;
      const res = rewrite(cli, file, co);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /rewrote .*worktree-git-guard\.sh/);
      assert.match(res.stdout, /rewrote 1, left 0, dropped 0 duplicate\(s\)/);
      assert.deepEqual(guardCommands(JSON.parse(read(file))), [`node "${co.guard}"`]);
      const expected = JSON.parse(
        JSON.stringify(before).replace(
          JSON.stringify(legacy["command"]).slice(1, -1),
          JSON.stringify(`node "${co.guard}"`).slice(1, -1),
        ),
      ) as Json;
      assert.deepEqual(JSON.parse(read(file)), expected, "only the command changed");
      assert.deepEqual(
        Object.keys(JSON.parse(read(file)) as Json),
        Object.keys(before),
        "key order kept",
      );
      assert.equal(backups(file).length, 1);
      assert.equal(mode(file), 0o600);
      assert.equal(mode(path.join(path.dirname(file), backups(file)[0] ?? "")), 0o600);
      assert.equal(
        read(path.join(path.dirname(file), backups(file)[0] ?? "")),
        `${JSON.stringify(before, null, 2)}\n`,
        "the backup is the file as it was",
      );
    });

    test("a second run writes nothing and makes no backup", () => {
      const co = makeCheckout();
      const file = install(
        cli,
        configOf(cli, [handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`)]),
        co,
      );
      rewrite(cli, file, co);
      const first = read(file);
      const again = rewrite(cli, file, co);
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /left as they are .*nothing written/);
      assert.equal(read(file), first);
      assert.equal(backups(file).length, 1);
    });

    test("the legacy and the direct form together leave exactly one guard command", () => {
      const co = makeCheckout();
      const file = install(
        cli,
        configOf(cli, [
          handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`),
          handler(`node "${co.guard}"`),
        ]),
        co,
      );
      const res = rewrite(cli, file, co);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(guardCommands(JSON.parse(read(file))), [`node "${co.guard}"`]);
      assert.match(res.stdout, /dropped 1 duplicate/);
    });

    test("a hook that merely names the script, and a chained command, are never rewritten, kept or dropped (scenario 21)", () => {
      const co = makeCheckout();
      const lookalikes = [
        handler('node "/opt/tools/worktree-git-guard.ts" --strict'),
        handler(
          `bash /opt/prep.sh && bash ${path.join(co.repo, "hooks", "worktree-git-guard.sh")}`,
        ),
        handler("bash /opt/tools/worktree-git-guard.sh"),
      ];
      const file = install(cli, configOf(cli, lookalikes), co);
      const before = read(file);
      const res = rewrite(cli, file, co);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(read(file), before, "byte-identical");
      assert.equal(backups(file).length, 0);
    });

    test("another checkout's command is left unless its .ts sits next to its .sh", () => {
      const co = makeCheckout();
      const other = makeCheckout("elsewhere", { entry: false });
      const command = `bash "${path.join(other.repo, "hooks", "worktree-git-guard.sh")}"`;
      const file = install(cli, configOf(cli, [handler(command)]), co);
      const before = read(file);
      const left = rewrite(cli, file, co);
      assert.equal(left.status, 0, left.stderr);
      assert.equal(read(file), before, "no .ts next to the registered .sh: left");
      assert.match(left.stdout, /left /);

      fs.writeFileSync(other.guard, "// entry\n");
      const done = rewrite(cli, file, co);
      assert.equal(done.status, 0, done.stderr);
      assert.deepEqual(
        guardCommands(JSON.parse(read(file))),
        [`node "${other.guard}"`],
        "re-pointed to the checkout that holds it, not to this one",
      );
    });

    test("a configuration that is not a JSON object is refused, byte-identical, no backup", () => {
      const co = makeCheckout();
      const file = path.join(path.dirname(co.repo), `${cli}-array.json`);
      fs.writeFileSync(file, "[1, 2]\n");
      const res = rewrite(cli, file, co);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /ERROR: .* is not a JSON object/);
      assert.equal(read(file), "[1, 2]\n");
      assert.equal(backups(file).length, 0);
    });

    test("an absent configuration is nothing to do: exit 0, no file created", () => {
      const co = makeCheckout();
      const file = path.join(path.dirname(co.repo), "absent.json");
      const res = rewrite(cli, file, co);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(fs.existsSync(file), false);
    });

    test("no mempalace-transcript command is rewritten, kept, deduplicated or removed", () => {
      const co = makeCheckout();
      const legacyTranscript = handler(
        `bash "${path.join(co.repo, "hooks", "mempalace-transcript.sh")}"`,
      );
      const config = configOf(cli, [
        handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`),
      ]);
      const events = config["hooks"] as Record<string, unknown[]>;
      const lastEvent = Object.keys(events).at(-1) ?? "";
      const entries = events[lastEvent] ?? [];
      entries.push(
        cli === "copilot"
          ? legacyTranscript
          : { ...((entries[0] as Json) ?? {}), hooks: [legacyTranscript, legacyTranscript] },
      );
      const file = install(cli, config, co);
      rewrite(cli, file, co);
      const after = JSON.parse(read(file)) as { hooks: Record<string, unknown[]> };
      assert.deepEqual(
        after.hooks[lastEvent],
        events[lastEvent],
        "the transcript entries are exactly as they were",
      );
    });
  });
}

describe(
  "no configuration content on any argument list, and no subprocess (R30, R32)",
  { skip: SKIP_POSIX },
  () => {
    test("guard rewrite over a configuration holding a secret starts no process", () => {
      const co = makeCheckout();
      const file = install(
        "claude",
        configOf("claude", [
          handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`),
        ]),
        co,
      );
      const log = path.join(realTmp("crewrig-spy-"), "spy.log");
      const res = spawnSync(
        process.execPath,
        [
          "--import",
          SPY,
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          "--disable-warning=ExperimentalWarning",
          WIRING,
          "guard",
          "rewrite",
          "claude",
          "--config",
          file,
          "--repo",
          co.repo,
        ],
        { encoding: "utf8", env: { ...process.env, SPAWN_SPY_LOG: log } },
      );
      assert.equal(res.status, 0, res.stderr);
      const records = fs.existsSync(log)
        ? read(log)
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as SpyRecord)
        : [];
      assert.deepEqual(records, [], "no jq, no POSIX utility, no argument list");
    });
  },
);
