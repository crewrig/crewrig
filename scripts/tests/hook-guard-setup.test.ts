// hook-guard-setup.test.ts — what the Bash setups do with the guard, driven
// through the library functions they call (spec 0248 R30-R32; scenarios 19, 20,
// 23; named edits v1-F2, v1-F4; plan decision D4).
//
// The setups are interactive (`fzf`) and cannot run in CI, so `common.sh` and
// `usage-capture-optin.sh` are sourced into a throwaway Bash and their functions
// called: `guard_rewrite_installed` (called on every run, before the
// session-recording question, so an answer of `no` and a cancelled confirmation
// still rewrite), `render_session_recording_manifest` and
// `merge_session_recording_hooks` (the `yes` path), `require_node_floor` and
// `deploy_antigravity_transcript_hooks`. A Node.js 20 is the real Node.js with a
// preload that overrides `process.version`, so the real floor guard decides.
// POSIX only; the structural checks run everywhere.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  CLIS,
  direct,
  installed,
  legacy,
  q,
  transcriptCount,
  write,
} from "./lib/guard-installed.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import {
  backups,
  guardCommands,
  handler,
  makeCheckout,
  mode,
  type Json,
} from "./lib/guard-wiring-fixtures.ts";
import { renderDeclaration, SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { fakeNodeFirst, pathWithoutNode } from "./lib/shim-env.ts";
import { cleanupAll, read, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** The steps of one setup in run order, read from its declaration (`step N: <id>` lines). */
function declaredSteps(cli: string): string[] {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, cli);
  const steps = renderDeclaration(descriptor, "lines")
    .split("\n")
    .flatMap((line) => /^step \d+: (.+)$/.exec(line)?.[1] ?? []);
  assert.ok(steps.length > 0, `vacuity: the ${cli} declaration lists no step`);
  return steps;
}

describe("structure: the rewrite runs before the session-recording question, the guard's jq substitutions are gone (R30, R32, v1-F2)", () => {
  for (const cli of ["claude", "gemini", "copilot", "antigravity"]) {
    const text = read(path.join(REPO, "scripts", `setup-${cli}-interactive.sh`));
    test(`${cli}: the rewrite step precedes the session-recording question (declaration)`, () => {
      // Pinned against the shell by setup-retarget-step-order.test.ts, until the shell is a shim.
      const steps = declaredSteps(cli);
      const call = steps.indexOf("hooks-rewrite-installed");
      const question = steps.indexOf("session-recording");
      assert.ok(
        call >= 0 && question >= 0 && call < question,
        "the rewrite precedes the fzf question",
      );
    });
    test(`${cli}: guard_rewrite_installed is never guarded by the answer`, () => {
      assert.match(text, /guard_rewrite_installed [^\n]*\|\| true/);
    });
    test(`${cli}: no jq program rebuilds or substitutes the guard's command line`, () => {
      assert.doesNotMatch(text, /"bash " \+ \$guard_path/);
      assert.doesNotMatch(text, /gsub\([^)]*worktree-git-guard/);
      assert.doesNotMatch(text, /guard_rewrite\b(?!_)/);
    });
  }

  test("common.sh no longer carries the jq `guard_rewrite` of the Antigravity deployment", () => {
    assert.doesNotMatch(
      read(path.join(REPO, "scripts", "lib", "common.sh")),
      /guard_rewrite\b(?!_)/,
    );
  });
});

describe("guard_rewrite_installed (R30; scenario 19)", { skip: SKIP_POSIX }, () => {
  for (const cli of CLIS) {
    test(`${cli}: an installed legacy guard is rewritten whatever the question's answer; transcript hooks untouched; a second run writes nothing`, () => {
      const co = makeCheckout();
      const config = installed(cli, [legacy(co)]);
      const file = write(co, `${cli}.json`, config);
      const before = JSON.parse(read(file)) as Json;
      const first = bashLibs(`guard_rewrite_installed ${cli} ${q(co.repo)} ${q(file)}`);
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /rewrote 1, left 0/);
      assert.deepEqual(guardCommands(JSON.parse(read(file))), [direct(co)]);
      assert.equal(transcriptCount(JSON.parse(read(file))), 1);
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(JSON.parse(read(file))).replace(
            JSON.stringify(direct(co)).slice(1, -1),
            JSON.stringify(legacy(co)).slice(1, -1),
          ),
        ),
        before,
        "nothing but the guard's command changed",
      );
      assert.equal(backups(file).length, 1);
      assert.equal(mode(file), 0o600);
      const snapshot = read(file);
      const second = bashLibs(`guard_rewrite_installed ${cli} ${q(co.repo)} ${q(file)}`);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(read(file), snapshot);
      assert.equal(backups(file).length, 1, "no new backup");
    });
  }

  test("antigravity: the named hook's legacy command is rewritten in hooks.json", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        "crewrig-mempalace-transcript": {
          Stop: [handler('bash "/x/hooks/mempalace-transcript.sh" Stop')],
        },
        "crewrig-worktree-git-guard": {
          PreToolUse: [{ matcher: "run_command", hooks: [handler(legacy(co), { timeout: 5 })] }],
        },
      }),
    );
    const res = bashLibs(`guard_rewrite_installed antigravity ${q(co.repo)} ${q(file)}`);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(guardCommands(JSON.parse(read(file))), [direct(co)]);
    assert.ok(read(file).includes('"timeout":5') || read(file).includes('"timeout": 5'));
  });

  test("a configuration that does not mention the guard, or is absent, needs no Node.js and prints nothing", () => {
    const co = makeCheckout();
    const file = write(co, "plain.json", {
      hooks: { Stop: [{ matcher: "", hooks: [handler("echo hi")] }] },
    });
    const before = read(file);
    const res = bashLibs(
      `guard_rewrite_installed claude ${q(co.repo)} ${q(file)}; echo "rc=$?"; guard_rewrite_installed claude ${q(co.repo)} /nonexistent.json; echo "rc=$?"`,
      pathWithoutNode(),
    );
    assert.equal(res.stdout, "rc=0\nrc=0\n", res.stderr);
    assert.equal(read(file), before);
  });
});

describe(
  "an unsupported Node.js stops the rewrite (R32; scenario 23)",
  { skip: SKIP_POSIX },
  () => {
    test("Node.js 20: the floor guard's diagnostic naming 20 and 24, nothing rewritten, no backup, the legacy command in place", () => {
      const co = makeCheckout();
      const file = write(co, "claude.json", installed("claude", [legacy(co)]));
      const before = read(file);
      const res = bashLibs(
        `guard_rewrite_installed claude ${q(co.repo)} ${q(file)}; echo "rc=$?"`,
        fakeNodeFirst(),
      );
      assert.match(res.stdout, /rc=1/);
      assert.match(res.stderr, /v20\.11\.1/);
      assert.match(res.stderr, /requires Node\.js >= 24/);
      assert.equal(read(file), before);
      assert.equal(backups(file).length, 0);
    });

    test("require_node_floor: no node on PATH is one shell-authored line, generic wording (not usage capture's)", () => {
      const res = bashLibs('require_node_floor; echo "rc=$?"', pathWithoutNode());
      assert.match(res.stdout, /rc=1/);
      assert.equal(res.stderr.trim().split("\n").length, 1, res.stderr);
      assert.match(res.stderr, /Node\.js was not found on PATH/);
      assert.match(res.stderr, />= 24/);
      assert.doesNotMatch(res.stderr, /usage capture/i);
    });

    test("require_node_floor below the floor: the floor guard's diagnostic and no 'usage capture' wording", () => {
      const res = bashLibs('require_node_floor; echo "rc=$?"', fakeNodeFirst());
      assert.match(res.stdout, /rc=1/);
      assert.doesNotMatch(res.stderr, /usage capture/i);
    });
  },
);
