// hook-transcript-unsafe-prefix.test.ts — a transcript-shaped command whose
// prefix is outside the grammar setup writes (review i1-F5, spec 0247
// delta-03): it is `foreign-prefix`, so on every path and all four CLIs it is
// left byte-identical, reported, and nothing is added to its event — never a
// second transcript command beside it (R26). Antigravity CLI as for other
// foreign-prefix commands: inside the `crewrig-mempalace-transcript` named
// hook, per event (R23(c)).
//
// The decline path is `transcript_rewrite_installed` (run on every setup run
// before the question); the enable path is the setups' `yes` (render, then
// merge) and, on Antigravity CLI, `deploy_antigravity_transcript_hooks`.
// POSIX only (Bash libraries).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { serialiseJson } from "../lib/hook-config.ts";
import { classifyTranscript } from "../lib/transcript-recognition.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { backups, handler, handlers, type Json } from "./lib/guard-wiring-fixtures.ts";
import {
  AGY_HOOK,
  agyDirect,
  configOf,
  directCmd,
  EVENT,
  eventsOf,
  HOME_DIR,
  homeWithCopies,
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
import { cleanEnv, cleanupAll, read, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** The unsafe prefixes under test, one per kind: a quoted value, an expansion, an interpreter glob. */
const PREFIXES = [
  {
    label: "a double-quoted value",
    pre: 'MEMPALACE_TRANSCRIPT_ENABLED="1" ',
    names: /MEMPALACE_TRANSCRIPT_ENABLED=\.\.\./,
  },
  {
    label: "a `$` expansion",
    pre: "MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$HOME/py ",
    names: /MEMPALACE_PYTHON=\.\.\./,
  },
  {
    label: "a glob in the interpreter path",
    pre: "",
    interp: "/opt/b*n/bash",
    names: /does not write/,
  },
] as const;

function unsafeCommand(copy: string, p: (typeof PREFIXES)[number], args = ""): string {
  const interp = "interp" in p ? p.interp : "bash";
  return `${p.pre}${interp} "${copy}"${args}`;
}

describe("i1-F5: an unsafe prefix is foreign-prefix", () => {
  for (const p of PREFIXES) {
    test(`${p.label}`, () => {
      assert.equal(
        classifyTranscript(unsafeCommand("/x/hooks/mempalace-transcript.sh", p)),
        "foreign-prefix",
      );
    });
  }
});

describe(
  "decline path: left byte-identical and reported, nothing written",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      for (const p of PREFIXES) {
        test(`${cli}: ${p.label}`, () => {
          const co = makeTranscriptCheckout();
          const copy = path.join(
            homeWithCopies(),
            HOME_DIR[cli],
            "hooks",
            "mempalace-transcript.sh",
          );
          const unsafe = unsafeCommand(copy, p);
          const env = cli === "claude" ? { env: { MEMPALACE_TRANSCRIPT_ENABLED: "1" } } : {};
          const file = writeConfig(co, `${cli}.json`, configOf(cli, [unsafe], env));
          const before = read(file);
          const res = bashLibs(
            `transcript_rewrite_installed ${cli} ${q(co.repo)} ${q(file)}; echo "rc=$?"`,
            cleanEnv(),
          );
          assert.match(res.stdout, /rc=0/, res.stdout + res.stderr);
          assert.equal(read(file), before, "byte-identical");
          assert.deepEqual(backups(file), [], "no backup");
          assert.match(
            res.stdout,
            new RegExp(`left .*mempalace-transcript\\.sh on ${EVENT[cli]} \\(`),
          );
          assert.match(res.stdout, p.names);
          assert.doesNotMatch(res.stdout, /\$HOME\/py|"1"/, "names only, never values");
        });
      }
    }
  },
);

describe(
  "enable path: the command stays alone on its event, nothing added, reported",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      for (const p of PREFIXES) {
        test(`${cli}: ${p.label}`, () => {
          const co = makeTranscriptCheckout();
          const copy = path.join(
            homeWithCopies(),
            HOME_DIR[cli],
            "hooks",
            "mempalace-transcript.sh",
          );
          const unsafe = unsafeCommand(copy, p);
          const config = configOf(cli, [unsafe]);
          const original = handlers(config).find((h) => h["command"] === unsafe);
          const file = writeConfig(co, `${cli}.json`, config);
          const res = bashLibs(yesScript(cli, co, file));
          assert.match(res.stdout, /rc=0/, res.stdout + res.stderr);
          const after = JSON.parse(read(file)) as Json;
          const onEvent = handlers(eventsOf(after)[EVENT[cli]]);
          assert.deepEqual(transcriptCommands(onEvent), [unsafe], "no second transcript command");
          assert.deepEqual(
            onEvent.find((h) => h["command"] === unsafe),
            original,
            "byte-identical",
          );
          for (const event of manifestEvents(co, cli).filter((e) => e !== EVENT[cli])) {
            assert.deepEqual(
              transcriptCommands(eventsOf(after)[event]),
              [directCmd(co, cli)],
              event,
            );
          }
          const report = res.stdout + res.stderr;
          assert.match(
            report,
            new RegExp(`left .* on ${EVENT[cli]} \\(.*\\); removed 0 .*added none`),
          );
          assert.match(report, p.names);
          // A second enable run changes nothing.
          const first = read(file);
          assert.match(bashLibs(yesScript(cli, co, file)).stdout, /rc=0/);
          assert.equal(read(file), first);
        });
      }
    }
  },
);

describe("Antigravity CLI: inside the named hook, per event (R23(c))", { skip: SKIP_POSIX }, () => {
  function writeHooks(co: TranscriptCheckout, unsafe: string): string {
    const target = path.join(path.dirname(co.repo), "hooks.json");
    const config = { [AGY_HOOK]: { Stop: [handler(unsafe, { timeout: 10 })] } };
    fs.writeFileSync(target, serialiseJson(config), { mode: 0o644 });
    return target;
  }

  for (const p of PREFIXES) {
    test(`decline (antigravity-rewrite): ${p.label} is left byte-identical and reported`, () => {
      const co = makeTranscriptCheckout();
      const copy = path.join(
        homeWithCopies(),
        ".gemini",
        "antigravity-cli",
        "hooks",
        "mempalace-transcript.sh",
      );
      const target = writeHooks(co, unsafeCommand(copy, p, " Stop"));
      const before = read(target);
      const res = bashLibs(
        `transcript_rewrite_installed antigravity ${q(co.repo)} ${q(target)}; echo "rc=$?"`,
        cleanEnv(),
      );
      assert.match(res.stdout, /rc=0/, res.stdout + res.stderr);
      assert.equal(read(target), before);
      assert.deepEqual(backups(target), []);
      assert.match(res.stdout, new RegExp(`left .* on ${AGY_HOOK}/Stop \\(`));
      assert.match(res.stdout, p.names);
    });

    test(`enable (deploy): ${p.label} stays alone on Stop, nothing added, reported`, () => {
      const co = makeTranscriptCheckout();
      const copy = path.join(
        homeWithCopies(),
        ".gemini",
        "antigravity-cli",
        "hooks",
        "mempalace-transcript.sh",
      );
      const unsafe = unsafeCommand(copy, p, " Stop");
      const target = writeHooks(co, unsafe);
      const res = bashLibs(
        `deploy_antigravity_transcript_hooks ${q(co.manifest("antigravity"))} "" ${q(path.join(path.dirname(target), "agy-hooks"))} ${q(target)} "" ${q(co.guard)}
         echo "rc=$?"`,
      );
      assert.match(res.stdout, /rc=0/, res.stdout + res.stderr);
      const after = JSON.parse(read(target)) as Json;
      const stop = (after[AGY_HOOK] as Json)["Stop"];
      assert.deepEqual(stop, [handler(unsafe, { timeout: 10 })]);
      assert.ok(!transcriptCommands(stop).includes(agyDirect(co, "Stop")), "nothing added");
      const report = res.stdout + res.stderr;
      assert.match(
        report,
        new RegExp(`left .* on ${AGY_HOOK}/Stop \\(.*nothing added on this event`),
      );
      assert.match(report, p.names);
    });
  }
});
