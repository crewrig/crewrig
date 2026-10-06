// hook-transcript-rewrite.test.ts — the rewrite setup makes before the
// session-recording question, whatever the answer (spec 0247 R23, R25, R26,
// delta-01; scenarios "An existing installation is rewritten on the next setup
// run", "A decline never turns recording on, on the prefixed CLIs", "A decline
// on Claude Code follows the settings file's own consent", "An operator's own
// setting is not dropped" — decline half).
//
// Driven through `transcript_rewrite_installed` (scripts/lib/common.sh), as the
// three JSON-settings setups call it, and through `hook-wiring.ts transcript
// rewrite` directly. Every class of R24 on every CLI: what moves is written in
// the direct form of the running checkout, what stays is byte-identical and
// reported. POSIX only (Bash libraries, a PATH recorder).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { serialiseJson } from "../lib/hook-config.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { backups, mode, wiring, type Json } from "./lib/guard-wiring-fixtures.ts";
import {
  argvRecorder,
  CLI_ID,
  configOf,
  directCmd,
  EVENT,
  HOME_DIR,
  homeWithCopies,
  legacyForms,
  makeTranscriptCheckout,
  NEIGHBOURS,
  q,
  WIRED,
  withoutNode,
  writeConfig,
  type TranscriptCheckout,
  type WiredCli,
} from "./lib/transcript-fixtures.ts";
import { cleanEnv, cleanupAll, read, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** `transcript_rewrite_installed <cli> <repo> <file>`, as the setups call it. */
function rewriteInstalled(cli: WiredCli, co: TranscriptCheckout, file: string, env = cleanEnv()) {
  return bashLibs(
    `transcript_rewrite_installed ${cli} ${q(co.repo)} ${q(file)}; echo "rc=$?"`,
    env,
  );
}

interface Case {
  readonly name: string;
  readonly command: (home: string, cli: WiredCli) => string;
  /** The Claude Code `env` block of the settings file. */
  readonly env?: Json;
  readonly moves: (cli: WiredCli) => boolean;
  readonly reason?: RegExp;
}

const CASES: readonly Case[] = [
  {
    name: "direct, of another checkout",
    command: (_home, cli) => `node "/old/crewrig/hooks/mempalace-transcript.ts" ${CLI_ID[cli]}`,
    moves: () => true,
  },
  {
    name: "legacy-enabled",
    command: (home, cli) => legacyForms(home, HOME_DIR[cli])["legacy-enabled"] ?? "",
    moves: () => true,
  },
  {
    name: "legacy-unmarked, no env",
    command: (home, cli) => legacyForms(home, HOME_DIR[cli])["legacy-unmarked"] ?? "",
    moves: () => false,
    reason: /disabled and not upgraded/,
  },
  {
    name: 'legacy-unmarked, env.MEMPALACE_TRANSCRIPT_ENABLED "1"',
    command: (home, cli) => legacyForms(home, HOME_DIR[cli])["legacy-unmarked"] ?? "",
    env: { MEMPALACE_TRANSCRIPT_ENABLED: "1" },
    moves: (cli) => cli === "claude",
    reason: /disabled and not upgraded/,
  },
  {
    name: 'legacy-unmarked, env.MEMPALACE_TRANSCRIPT_ENABLED "0"',
    command: (home, cli) => legacyForms(home, HOME_DIR[cli])["legacy-unmarked"] ?? "",
    env: { MEMPALACE_TRANSCRIPT_ENABLED: "0" },
    moves: () => false,
    reason: /disabled and not upgraded/,
  },
  {
    name: "legacy-unmarked, MEMPALACE_TRANSCRIPT_ENABLED=0 prefix",
    command: (home, cli) => legacyForms(home, HOME_DIR[cli])["legacy-unmarked (=0)"] ?? "",
    env: { MEMPALACE_TRANSCRIPT_ENABLED: "1" },
    moves: (cli) => cli === "claude",
    reason: /disabled and not upgraded/,
  },
  {
    name: "foreign-prefix",
    command: (home, cli) => legacyForms(home, HOME_DIR[cli])["foreign-prefix"] ?? "",
    env: { MEMPALACE_TRANSCRIPT_ENABLED: "1" },
    moves: () => false,
    reason: /environment prefix the framework does not own \(.*MEMPALACE_MCP_PORT=\.\.\.\)/,
  },
];

describe(
  "the pre-question rewrite, every class on every CLI (R23, R25)",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      for (const c of CASES) {
        const moves = c.moves(cli);
        test(`${cli}, ${c.name}: ${moves ? "rewritten to the running checkout" : "byte-identical and reported"}`, () => {
          const co = makeTranscriptCheckout();
          const home = homeWithCopies();
          const command = c.command(home, cli);
          const extra = {
            neighbours: NEIGHBOURS(co, cli),
            ...(cli === "claude" && c.env ? { env: c.env } : {}),
          };
          const file = writeConfig(co, `${cli}.json`, configOf(cli, [command], extra));
          const before = read(file);
          // The user's shell exports the variable: it never stands for consent.
          const res = rewriteInstalled(
            cli,
            co,
            file,
            cleanEnv({ MEMPALACE_TRANSCRIPT_ENABLED: "1" }),
          );
          assert.match(res.stdout, /rc=0/, res.stderr);
          if (moves) {
            assert.equal(read(file), serialiseJson(configOf(cli, [directCmd(co, cli)], extra)));
            assert.match(res.stdout, new RegExp(`rewrote .* on ${EVENT[cli]} \\(-> ${co.ts}\\)`));
            assert.equal(backups(file).length, 1);
            assert.equal(mode(file), 0o600);
            assert.equal(mode(path.join(path.dirname(file), backups(file)[0] ?? "")), 0o600);
            assert.equal(
              fs.readFileSync(path.join(path.dirname(file), backups(file)[0] ?? ""), "utf8"),
              before,
            );
          } else {
            assert.equal(read(file), before, "byte-identical");
            assert.deepEqual(backups(file), [], "no backup");
            assert.match(res.stdout, new RegExp(`left .* on ${EVENT[cli]} \\(`));
            if (c.reason) assert.match(res.stdout, c.reason);
            assert.match(res.stdout, /nothing written/);
            assert.doesNotMatch(
              res.stdout + res.stderr,
              /41999/,
              "an assignment's value is never reported",
            );
          }
        });
      }
    }
  },
);

describe(
  "scenario: an existing Gemini CLI installation is rewritten on the next setup run",
  { skip: SKIP_POSIX },
  () => {
    test("the transcript entry is rewritten, its neighbours byte-identical, the unused copy reported, a second run writes nothing", () => {
      const co = makeTranscriptCheckout();
      const home = homeWithCopies();
      const copy = path.join(home, ".gemini", "hooks", "mempalace-transcript.sh");
      const legacy = `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3 bash ${copy}`;
      const neighbours = NEIGHBOURS(co, "gemini");
      const file = writeConfig(co, "settings.json", configOf("gemini", [legacy], { neighbours }));
      const run = () =>
        bashLibs(
          `transcript_rewrite_installed gemini ${q(co.repo)} ${q(file)}; echo "rc=$?"
         report_unused_transcript_copy ${q(copy)}`,
        );

      const first = run();
      assert.match(first.stdout, /rc=0/, first.stderr);
      const after = JSON.parse(read(file)) as {
        hooks: { AfterModel: { hooks: Json[] }[] };
      };
      const entries = after.hooks.AfterModel[0]?.hooks ?? [];
      assert.deepEqual(
        entries.map((h) => h["command"]),
        [...neighbours, `node "${co.ts}" gemini-cli`],
      );
      assert.equal(
        read(file),
        serialiseJson(configOf("gemini", [directCmd(co, "gemini")], { neighbours })),
      );
      assert.equal(mode(file), 0o600);
      assert.equal(backups(file).length, 1);
      assert.equal(mode(path.join(path.dirname(file), backups(file)[0] ?? "")), 0o600);
      assert.match(first.stdout, /rewrote 1, left 0, dropped 0/);
      assert.match(first.stdout, new RegExp(`No longer used \\(left on disk\\): ${copy}`));
      assert.ok(fs.existsSync(copy), "the installed copy stays on disk");

      const written = read(file);
      const second = run();
      assert.match(second.stdout, /rc=0/, second.stderr);
      assert.equal(read(file), written, "the second run writes nothing");
      assert.equal(backups(file).length, 1, "and makes no backup");
      assert.match(second.stdout, /already the direct form/);
    });
  },
);

describe(
  "the rewrite never builds two direct commands on one event (R26)",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      test(`${cli}: two movable commands on the event become one, a foreign-prefix one stays beside it`, () => {
        const co = makeTranscriptCheckout();
        const home = homeWithCopies();
        const forms = legacyForms(home, HOME_DIR[cli]);
        const commands = [
          forms["legacy-enabled"] ?? "",
          `node "/old/hooks/mempalace-transcript.ts" ${CLI_ID[cli]}`,
          forms["foreign-prefix"] ?? "",
        ];
        const config = configOf(cli, commands);
        const file = writeConfig(co, `${cli}.json`, config);
        const res = rewriteInstalled(cli, co, file);
        assert.match(res.stdout, /rc=0/, res.stderr);
        // The first movable command is rewritten in place, the second dropped, the operator's kept.
        const hooks = config["hooks"] as Record<string, unknown[]>;
        const holder = (
          cli === "copilot" ? hooks[EVENT[cli]] : (hooks[EVENT[cli]]?.[0] as Json)["hooks"]
        ) as Json[];
        (holder[0] as Json)["command"] = directCmd(co, cli);
        holder.splice(1, 1);
        assert.equal(read(file), serialiseJson(config));
        assert.match(res.stdout, /dropped .*duplicate/);
      });
    }
  },
);

describe("write safety (R26)", { skip: SKIP_POSIX }, () => {
  for (const text of ["[]\n", '"bash /x/hooks/mempalace-transcript.sh"\n', "{ not json"]) {
    test(`a configuration that is not a JSON object is refused and left byte-identical: ${JSON.stringify(text)}`, () => {
      const co = makeTranscriptCheckout();
      const file = path.join(path.dirname(co.repo), "settings.json");
      fs.writeFileSync(file, text, { mode: 0o644 });
      const res = wiring("transcript", "rewrite", "claude", "--config", file, "--repo", co.repo);
      assert.notEqual(res.status, 0);
      assert.equal(read(file), text);
      assert.deepEqual(backups(file), []);
    });
  }

  test("an absent configuration writes nothing", () => {
    const co = makeTranscriptCheckout();
    const file = path.join(path.dirname(co.repo), "absent.json");
    const res = wiring("transcript", "rewrite", "copilot", "--config", file, "--repo", co.repo);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(file));
  });

  test("a configuration naming no transcript hook needs no Node.js and is not touched", () => {
    const co = makeTranscriptCheckout();
    const file = writeConfig(co, "plain.json", configOf("claude", ["/opt/operator/notify.sh"]));
    const before = read(file);
    const res = rewriteInstalled("claude", co, file, withoutNode());
    assert.match(res.stdout, /rc=0/, res.stderr);
    assert.equal(read(file), before);
  });

  test("no configuration content reaches the argument list of any process", () => {
    const co = makeTranscriptCheckout();
    const home = homeWithCopies();
    const forms = legacyForms(home, ".claude");
    const file = writeConfig(
      co,
      "claude.json",
      configOf("claude", [forms["legacy-enabled"] ?? "", forms["foreign-prefix"] ?? ""]),
    );
    const log = path.join(realTmp("crewrig-argv-"), "argv.log");
    const res = rewriteInstalled("claude", co, file, argvRecorder(["node", "jq", "grep"], log));
    assert.match(res.stdout, /rc=0/, res.stderr);
    const argv = read(log);
    assert.match(argv, /transcript rewrite claude --config/);
    for (const needle of [
      "MEMPALACE_MCP_PORT",
      "41999",
      "MEMPALACE_PYTHON",
      "/usr/bin/python3",
      "notify.sh",
    ]) {
      assert.ok(!argv.includes(needle), `${needle} on an argument list`);
    }
  });
});
