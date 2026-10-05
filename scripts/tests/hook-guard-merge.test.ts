// hook-guard-merge.test.ts — the `yes` path of the setups: the session-recording
// merge and the guard (spec 0248 R29-R31; scenario 20; named edit v1-F4).
//
// `render_session_recording_manifest` and `merge_session_recording_hooks` are
// called as the setups call them, over an installed configuration holding the
// legacy form, the direct form or both. A render that yields no guard entry (a
// Node.js below the floor, or a refusal) carries the installed guard through
// the merge byte-identical while the transcript hooks are still merged.
// POSIX only (Bash libraries).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import {
  guardCommands,
  handler,
  handlers,
  makeCheckout,
  type Checkout,
  type Json,
} from "./lib/guard-wiring-fixtures.ts";
import {
  CLIS,
  direct,
  installed,
  legacy,
  q,
  transcriptCount,
  write,
  type Cli,
} from "./lib/guard-installed.ts";
import { fakeNodeFirst } from "./lib/shim-env.ts";
import { cleanupAll, read, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** Render the manifest of `cli` from `co`, then merge it into `file` as the `yes` path does. */
function yes(cli: Cli, co: Checkout, file: string, env?: NodeJS.ProcessEnv) {
  return bashLibs(
    `render_session_recording_manifest ${cli} ${q(co.repo)} ${q(co.manifest(cli))} rendered.json \\
       && merge_session_recording_hooks ${cli} ${q(file)} rendered.json; echo "rc=$?"`,
    env,
  );
}

describe(
  "the session-recording merge never duplicates the guard (scenario 20)",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of CLIS) {
      for (const [name, commands] of [
        ["legacy", (co: Checkout) => [legacy(co)]],
        ["direct", (co: Checkout) => [direct(co)]],
        ["both", (co: Checkout) => [legacy(co), direct(co)]],
      ] as const) {
        test(`${cli}, ${name}: exactly one guard command, in the form of R29, and the transcript hooks merged`, () => {
          const co = makeCheckout();
          const file = write(co, `${cli}.json`, installed(cli, commands(co)));
          const res = yes(cli, co, file);
          assert.match(res.stdout, /rc=0/, res.stderr);
          const after = JSON.parse(read(file));
          assert.deepEqual(guardCommands(after), [direct(co)]);
          assert.ok(transcriptCount(after) >= 1);
        });
      }
    }
  },
);

describe(
  "v1-F4: a render with no guard entry carries the installed guard through the merge",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of CLIS) {
      test(`${cli}, legacy guard, Node.js 20, yes: the guard byte-identical, the transcript hooks merged (floor)`, () => {
        const co = makeCheckout();
        const config = installed(cli, [legacy(co)]);
        const file = write(co, `${cli}.json`, config);
        const guardBefore = handlers(config).filter((h) =>
          String(h["command"]).includes("worktree-git-guard"),
        );
        const res = yes(cli, co, file, fakeNodeFirst());
        assert.match(res.stdout, /rc=0/, res.stderr);
        assert.match(res.stderr, /requires Node\.js >= 24/);
        const after = JSON.parse(read(file));
        assert.deepEqual(
          handlers(after).filter((h) => String(h["command"]).includes("worktree-git-guard")),
          guardBefore,
          "the installed guard handler is byte-identical",
        );
        assert.deepEqual(guardCommands(after), [legacy(co)]);
        assert.ok(transcriptCount(after) >= 1, "the manifest's transcript hooks are merged");
      });

      test(`${cli}, legacy guard, a refused render, yes: the guard byte-identical, the transcript hooks merged (refusal)`, () => {
        const co = makeCheckout("no-entry", { entry: false });
        const config = installed(cli, [legacy(co)]);
        const file = write(co, `${cli}.json`, config);
        const guardBefore = handlers(config).filter((h) =>
          String(h["command"]).includes("worktree-git-guard"),
        );
        const res = yes(cli, co, file);
        assert.match(res.stdout, /rc=0/, res.stderr);
        assert.match(res.stderr, /ERROR/);
        const after = JSON.parse(read(file));
        assert.deepEqual(
          handlers(after).filter((h) => String(h["command"]).includes("worktree-git-guard")),
          guardBefore,
        );
        assert.ok(transcriptCount(after) >= 1);
      });
    }

    test("antigravity: a Node.js 20 deployment leaves the installed guard and merges the transcript hook", () => {
      const co = makeCheckout();
      const hooksDir = path.join(path.dirname(co.repo), "agy-hooks");
      const target = path.join(path.dirname(co.repo), "hooks.json");
      const guardEntry = {
        "crewrig-worktree-git-guard": {
          PreToolUse: [{ matcher: "run_command", hooks: [handler(legacy(co), { timeout: 5 })] }],
        },
      };
      fs.writeFileSync(target, JSON.stringify(guardEntry));
      const res = bashLibs(
        `deploy_antigravity_transcript_hooks ${q(co.manifest("antigravity"))} ${q(path.join(REPO, "hooks", "mempalace-transcript.sh"))} ${q(hooksDir)} ${q(target)} "MEMPALACE_TRANSCRIPT_ENABLED=1" ${q(co.guard)}; echo "rc=$?"`,
        fakeNodeFirst(),
      );
      assert.match(res.stdout, /rc=0/, res.stderr);
      const after = JSON.parse(read(target)) as Json;
      assert.deepEqual(
        after["crewrig-worktree-git-guard"],
        guardEntry["crewrig-worktree-git-guard"],
        "the installed guard is untouched",
      );
      assert.ok("crewrig-mempalace-transcript" in after, "the transcript hook is deployed");
    });
  },
);
