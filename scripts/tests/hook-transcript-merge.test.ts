// hook-transcript-merge.test.ts — the enable path of Claude Code, Gemini CLI and
// Copilot CLI through the real Bash functions (spec 0247 R21, R23(a)(b), R25,
// R26, R29, delta-01; scenarios "An enable answer upgrades every own command",
// "An enable run keeps the operator's command alone on its event", "An
// operator's own setting is not dropped" — enable half, "A second enable run
// keeps its backup and changes nothing").
//
// The render and merge run as the setups run them on a `yes` (yesScript).
// Antigravity CLI has its own suite. POSIX only (Bash libraries).

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { backups, handlers, mode, wiring, type Json } from "./lib/guard-wiring-fixtures.ts";
import {
  configOf,
  directCmd,
  eventsOf,
  EVENT,
  HOME_DIR,
  homeWithCopies,
  legacyForms,
  makeTranscriptCheckout,
  manifestEvents,
  q,
  transcriptCommands,
  WIRED,
  writeConfig,
  yesScript,
  type TranscriptCheckout,
  type WiredCli,
} from "./lib/transcript-fixtures.ts";
import { cleanupAll, read, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** The `yes` answer to the usage-capture question, as `usage_capture_apply` takes it. */
const CAPTURE = (cli: WiredCli, co: TranscriptCheckout, file: string): string =>
  `usage_capture_apply ${cli} ${q(file)} ${q(co.repo)} "$(usage_capture_state ${cli} ${q(file)})" yes >/dev/null; echo "uc=$?"`;

function yes(cli: WiredCli, co: TranscriptCheckout, file: string) {
  const res = bashLibs(yesScript(cli, co, file));
  assert.match(res.stdout, /rc=0/, res.stdout + res.stderr);
  return res;
}

/** Every event holds at most one transcript command (R26). */
function assertNeverTwo(config: Json, label: string): void {
  for (const [event, entries] of Object.entries(eventsOf(config))) {
    assert.ok(
      transcriptCommands(entries).length <= 1,
      `${label}: two transcript commands on ${event}`,
    );
  }
}

describe(
  "an enable run upgrades every own command, one per event (R23(a)(b))",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      test(`${cli}: direct, legacy-enabled and legacy-unmarked become the one direct form; an operator hook stays`, () => {
        const co = makeTranscriptCheckout();
        const forms = legacyForms(homeWithCopies(), HOME_DIR[cli]);
        const own = [
          forms["legacy-enabled"] ?? "",
          forms["legacy-unmarked"] ?? "",
          forms["legacy-unmarked (=0)"] ?? "",
          `node "/old/crewrig/hooks/mempalace-transcript.ts" ${directCmd(co, cli).split(" ").pop() ?? ""}`,
        ];
        const file = writeConfig(
          co,
          `${cli}.json`,
          configOf(cli, own, { neighbours: ["/opt/operator/notify.sh"] }),
        );
        const res = yes(cli, co, file);
        assert.match(res.stdout, /wired=1/);
        const after = JSON.parse(read(file)) as Json;
        for (const event of manifestEvents(co, cli)) {
          assert.deepEqual(transcriptCommands(eventsOf(after)[event]), [directCmd(co, cli)], event);
        }
        assert.ok(
          handlers(eventsOf(after)[EVENT[cli]]).some(
            (h) => h["command"] === "/opt/operator/notify.sh",
          ),
        );
        assertNeverTwo(after, cli);
        assert.ok(
          !read(file).includes("$CLAUDE_PROJECT_DIR") && !read(file).includes("_PROJECT_DIR}"),
          "every token rendered (R21)",
        );
        assert.equal(mode(file), 0o600);
      });
    }
  },
);

describe(
  "an operator's foreign-prefix command stays alone on its event (R23, R25)",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      test(`${cli}: the own command beside it is removed, nothing is added there, the removal is reported`, () => {
        const co = makeTranscriptCheckout();
        const forms = legacyForms(homeWithCopies(), HOME_DIR[cli]);
        const foreign = forms["foreign-prefix"] ?? "";
        const config = configOf(cli, [forms["legacy-enabled"] ?? "", foreign]);
        const foreignHandler = handlers(config).find((h) => h["command"] === foreign);
        const file = writeConfig(co, `${cli}.json`, config);
        const res = yes(cli, co, file);
        const after = JSON.parse(read(file)) as Json;
        const onEvent = handlers(eventsOf(after)[EVENT[cli]]);
        assert.deepEqual(transcriptCommands(onEvent), [foreign]);
        assert.deepEqual(
          onEvent.find((h) => h["command"] === foreign),
          foreignHandler,
          "byte-identical",
        );
        for (const event of manifestEvents(co, cli).filter((e) => e !== EVENT[cli])) {
          assert.deepEqual(transcriptCommands(eventsOf(after)[event]), [directCmd(co, cli)], event);
        }
        const report = res.stdout + res.stderr;
        assert.match(report, new RegExp(`${EVENT[cli]}.*MEMPALACE_MCP_PORT=\\.\\.\\.`));
        assert.match(report, /removed 1 .*added none|added none.*removed 1/);
        assert.doesNotMatch(report, /41999/, "names only, never values");
      });
    }
  },
);

describe(
  "Copilot CLI: the user-level hooks file is merged, not replaced (R23(b))",
  { skip: SKIP_POSIX },
  () => {
    const operator = { type: "command", command: "/opt/other-tool/on-start.sh", timeoutSec: 5 };

    test("an operator hook of another tool on sessionStart stays; top-level keys are kept, and added when absent", () => {
      const co = makeTranscriptCheckout();
      const file = writeConfig(co, "hooks.json", {
        version: 7,
        "x-tool": { on: true },
        hooks: { sessionStart: [operator] },
      });
      yes("copilot", co, file);
      const after = JSON.parse(read(file)) as Json;
      assert.deepEqual(Object.keys(after), ["version", "x-tool", "hooks", "disableAllHooks"]);
      assert.equal(after["version"], 7);
      assert.deepEqual(after["x-tool"], { on: true });
      assert.equal(after["disableAllHooks"], false);
      const start = eventsOf(after)["sessionStart"] as Json[];
      assert.deepEqual(start[0], operator);
      assert.deepEqual(transcriptCommands(start), [directCmd(co, "copilot")]);
    });

    test("an absent file takes the manifest's top-level keys in their order", () => {
      const co = makeTranscriptCheckout();
      const file = `${co.repo}/../absent-hooks.json`;
      yes("copilot", co, file);
      assert.deepEqual(Object.keys(JSON.parse(read(file)) as Json), [
        "version",
        "disableAllHooks",
        "hooks",
      ]);
    });

    test('"disableAllHooks": true is kept and reported, and recording is not reported active', () => {
      const co = makeTranscriptCheckout();
      const file = writeConfig(co, "hooks.json", {
        version: 1,
        disableAllHooks: true,
        hooks: { sessionStart: [operator] },
      });
      const res = yes("copilot", co, file);
      assert.equal((JSON.parse(read(file)) as Json)["disableAllHooks"], true);
      assert.match(res.stdout, /disabled=1/);
      assert.match(res.stderr, /"disableAllHooks": true .*no hook in that file fires/s);
      assert.match(res.stderr, /session recording included, until you set it to false/);
    });

    test('"disableAllHooks": false sets no flag', () => {
      const co = makeTranscriptCheckout();
      const file = writeConfig(co, "hooks.json", { version: 1, disableAllHooks: false, hooks: {} });
      assert.match(yes("copilot", co, file).stdout, /disabled=0/);
    });
  },
);

describe("the guard is refreshed exactly as row C2 writes it (R29)", { skip: SKIP_POSIX }, () => {
  for (const cli of WIRED) {
    test(`${cli}: the guard handlers equal those of \`guard render\`, byte for byte`, () => {
      const co = makeTranscriptCheckout();
      const legacyGuard = `bash "${co.repo}/hooks/worktree-git-guard.sh"`;
      const file = writeConfig(co, `${cli}.json`, configOf(cli, [legacyGuard]));
      yes(cli, co, file);
      const rendered = wiring(
        "guard",
        "render",
        cli,
        "--manifest",
        co.manifest(cli),
        "--repo",
        co.repo,
      );
      assert.equal(rendered.status, 0, rendered.stderr);
      const isGuard = (h: Json): boolean => String(h["command"]).includes("worktree-git-guard");
      const expected = handlers(JSON.parse(rendered.stdout)).filter(isGuard);
      assert.equal(expected.length, 1);
      assert.deepEqual(handlers(JSON.parse(read(file))).filter(isGuard), expected);
    });
  }
});

describe(
  "R26: never two transcript commands on one event, whatever the usage-capture answer",
  { skip: SKIP_POSIX },
  () => {
    const ORDERS: readonly (readonly ("sr" | "uc")[])[] = [
      ["sr", "uc"],
      ["uc", "sr"],
      ["sr", "uc", "sr"],
      ["uc", "sr", "uc", "sr"],
    ];
    for (const cli of WIRED) {
      for (const order of ORDERS) {
        test(`${cli}, ${order.join(" then ")}`, () => {
          const co = makeTranscriptCheckout("co", { capture: true });
          const forms = legacyForms(homeWithCopies(), HOME_DIR[cli]);
          const file = writeConfig(
            co,
            `${cli}.json`,
            configOf(cli, [forms["legacy-enabled"] ?? ""]),
          );
          for (const step of order) {
            const res = bashLibs(step === "sr" ? yesScript(cli, co, file) : CAPTURE(cli, co, file));
            assert.match(res.stdout, step === "sr" ? /rc=0/ : /uc=0/, res.stdout + res.stderr);
            assertNeverTwo(JSON.parse(read(file)) as Json, `${cli} after ${step}`);
          }
          const after = JSON.parse(read(file)) as Json;
          for (const event of manifestEvents(co, cli)) {
            assert.deepEqual(
              transcriptCommands(eventsOf(after)[event]),
              [directCmd(co, cli)],
              event,
            );
          }
          assert.ok(
            handlers(after).some((h) => String(h["command"]).includes("usage-capture.ts")),
            "capture registered",
          );
        });
      }

      test(`${cli}: a configuration that already held two keeps no more than it held`, () => {
        const co = makeTranscriptCheckout();
        const home = homeWithCopies();
        const twoForeign = [
          `MEMPALACE_MCP_PORT=41999 bash "${home}/${HOME_DIR[cli]}/hooks/mempalace-transcript.sh"`,
          `MEMPALACE_MCP_HOST=10.0.0.2 bash "${home}/${HOME_DIR[cli]}/hooks/mempalace-transcript.sh"`,
        ];
        const file = writeConfig(co, `${cli}.json`, configOf(cli, twoForeign));
        yes(cli, co, file);
        assert.deepEqual(
          transcriptCommands(eventsOf(JSON.parse(read(file)) as Json)[EVENT[cli]]),
          twoForeign,
        );
      });
    }
  },
);

describe(
  "a second enable run keeps its backup and changes nothing (R26, delta-01, v1-F4)",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      test(`${cli}: content byte-identical to the first run's result, a backup taken each run`, () => {
        const co = makeTranscriptCheckout();
        const forms = legacyForms(homeWithCopies(), HOME_DIR[cli]);
        const file = writeConfig(
          co,
          `${cli}.json`,
          configOf(cli, [forms["legacy-enabled"] ?? "", forms["foreign-prefix"] ?? ""]),
        );
        yes(cli, co, file);
        const first = read(file);
        assert.equal(backups(file).length, 1);
        yes(cli, co, file);
        assert.equal(read(file), first);
        assert.equal(
          backups(file).length,
          2,
          "the enable path keeps its unconditional backup (R29)",
        );
        assertNeverTwo(JSON.parse(first) as Json, cli);
      });
    }
  },
);
