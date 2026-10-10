// setup-lib-usage-entry.test.ts — scripts/usage-capture-optin.ts, the entry behind the function shims of
// scripts/lib/usage-capture-optin.sh (spec 0256 requirement 33, plan v2 step B3b.4). Per subcommand, the entry run in a throwaway HOME against the shell function over two copies of one
// configuration (status, both streams, file bytes and mode, `--result` content). This needs bash, jq
// and a POSIX host.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { same } from "./lib/usage-entry-rig.ts";
import { cap, CLIS, configOf, SKIP, type Cli } from "./lib/usage-capture-rig.ts";
import { makeTranscriptCheckout, MANIFEST, q } from "./lib/transcript-fixtures.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const legacy = (cli: Cli): string => cap("/gone/co", cli, "sh");
const BAD = "[1, 2]";

describe("readers", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    for (const [label, initial] of [
      ["absent file", undefined],
      ["installed", configOf(cli, [cap("/tmp/x", cli)])],
      ["not an object", BAD],
    ] as const) {
      for (const sub of ["state", "paths", "footprint"] as const) {
        test(`${sub} ${cli}: ${label}`, () => {
          same(cli, initial, `usage_capture_${sub} "$CLI" "$CFG"`, (f) => [sub, cli, f.cfg]);
        });
      }
    }
  }
  test("an unknown CLI is refused with status 1 on every reader", () => {
    for (const sub of ["state", "paths", "footprint"]) {
      same("claude", undefined, `usage_capture_${sub} bogus "$CFG"`, (f) => [sub, "bogus", f.cfg]);
    }
  });
  test("abs: the physical path, the sh form, a missing script", () => {
    same("claude", undefined, 'usage_capture_abs "$CO"', (f) => ["abs", f.co]);
    same("claude", undefined, 'usage_capture_abs "$CO" sh', (f) => ["abs", f.co, "sh"]);
    same("claude", undefined, 'usage_capture_abs "$CO/nope"', (f) => ["abs", `${f.co}/nope`]);
  });
  test("fragment prints the shell's line for each CLI", () => {
    for (const cli of CLIS)
      same(cli, undefined, 'usage_capture_fragment "$CLI" "$CO"', (f) => ["fragment", cli, f.co]);
  });
});

describe("writers", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    const live = configOf(cli, [cap("/tmp/x", cli)]);
    const stale = configOf(cli, [legacy(cli)]);
    test(`enable ${cli}: absent file, existing file, not an object`, () => {
      for (const initial of [undefined, configOf(cli, []), live, BAD]) {
        same(cli, initial, 'usage_capture_enable "$CLI" "$CFG" "$CO"', (f) => [
          "enable",
          cli,
          f.cfg,
          f.co,
        ]);
      }
    });
    test(`remove ${cli}: installed, absent, not an object`, () => {
      for (const initial of [live, undefined, BAD]) {
        same(cli, initial, 'usage_capture_remove "$CLI" "$CFG"', (f) => ["remove", cli, f.cfg]);
      }
    });
    test(`keep ${cli}: a vanished registered path, a no-op, no file`, () => {
      for (const initial of [stale, undefined, configOf(cli, [])]) {
        same(cli, initial, 'usage_capture_keep "$CLI" "$CFG" "$CO"', (f) => [
          "keep",
          cli,
          f.cfg,
          f.co,
        ]);
      }
    });
    test(`disclose and rewrite ${cli}`, () => {
      same(cli, stale, 'usage_capture_disclose "$CLI" "$CFG" "$CO"', (f) => [
        "disclose",
        cli,
        f.cfg,
        f.co,
      ]);
      same(cli, stale, 'usage_capture_rewrite "$CLI" "$CFG" "$CO"', (f) => [
        "rewrite",
        cli,
        f.cfg,
        f.co,
      ]);
    });
    test(`reinject ${cli}: a footprint, an invalid one, a missing file`, () => {
      const fp = '[{"event":"x","selector":null,"handler":{"type":"command","command":"echo hi"}}]';
      same(
        cli,
        live,
        'usage_capture_reinject "$CLI" "$CFG" "$FP"',
        (f) => ["reinject", cli, f.cfg, fp],
        { FP: fp },
      );
      same(
        cli,
        live,
        'usage_capture_reinject "$CLI" "$CFG" "$FP"',
        (f) => ["reinject", cli, f.cfg, "{"],
        { FP: "{" },
      );
      same(
        cli,
        undefined,
        'usage_capture_reinject "$CLI" "$CFG" "$FP"',
        (f) => ["reinject", cli, f.cfg, fp],
        { FP: fp },
      );
    });
    test(`apply ${cli}: every state and answer`, () => {
      const cases: [unknown, string, string][] = [
        [undefined, "absent", "yes"],
        [undefined, "absent", "no"],
        [live, "installed", "remove"],
        [stale, "installed", "keep"],
        [stale, "installed", ""],
        [live, "weird", "yes"],
      ];
      for (const [initial, state, answer] of cases) {
        same(
          cli,
          initial,
          `usage_capture_apply "$CLI" "$CFG" "$CO" ${q(state)} ${q(answer)}`,
          (f) => ["apply", cli, f.cfg, f.co, state, answer],
        );
      }
    });
  }
});

describe("render and merge", { skip: SKIP }, () => {
  for (const cli of CLIS) {
    const co = makeTranscriptCheckout();
    const wanted = { WANT_RES: "SR_TRANSCRIPT_WIRED" };
    test(`render ${cli}: the manifest bytes and SR_TRANSCRIPT_WIRED`, () => {
      const leg = same(
        cli,
        undefined,
        `render_session_recording_manifest "$CLI" ${q(co.repo)} ${q(MANIFEST(cli))} "$OUT"`,
        (f) => [
          "render-session-recording-manifest",
          "--result",
          f.res,
          cli,
          co.repo,
          MANIFEST(cli),
          f.out,
        ],
        wanted,
      );
      assert.match(leg.result ?? "", /^SR_TRANSCRIPT_WIRED=1\n/);
    });
    test(`render ${cli}: a checkout with no transcript script falls back, wired 0`, () => {
      const bare = makeTranscriptCheckout("bare", { entry: false });
      const leg = same(
        cli,
        undefined,
        `render_session_recording_manifest "$CLI" ${q(bare.repo)} ${q(MANIFEST(cli))} "$OUT"`,
        (f) => [
          "render-session-recording-manifest",
          "--result",
          f.res,
          cli,
          bare.repo,
          MANIFEST(cli),
          f.out,
        ],
        wanted,
      );
      assert.match(leg.result ?? "", /^SR_TRANSCRIPT_WIRED=0\n/);
    });
    test(`merge ${cli}: onto absent, existing and capture-carrying files, with an env patch`, () => {
      const patch = cli === "claude" ? '{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}' : "{}";
      for (const initial of [undefined, configOf(cli, [cap("/tmp/x", cli)]), BAD]) {
        same(
          cli,
          initial,
          `merge_session_recording_hooks "$CLI" "$CFG" ${q(MANIFEST(cli))} ${q(patch)}`,
          (f) => [
            "merge-session-recording-hooks",
            "--result",
            f.res,
            cli,
            f.cfg,
            MANIFEST(cli),
            patch,
          ],
          { WANT_RES: "SR_ALL_HOOKS_DISABLED" },
        );
      }
    });
  }
  test("merge copilot keeps disableAllHooks: SR_ALL_HOOKS_DISABLED=1, the warning on standard error", () => {
    const leg = same(
      "copilot",
      { version: 1, disableAllHooks: true, hooks: {} },
      `merge_session_recording_hooks "$CLI" "$CFG" ${q(MANIFEST("copilot"))}`,
      (f) => [
        "merge-session-recording-hooks",
        "--result",
        f.res,
        "copilot",
        f.cfg,
        MANIFEST("copilot"),
      ],
      { WANT_RES: "SR_ALL_HOOKS_DISABLED" },
    );
    assert.match(leg.result ?? "", /SR_ALL_HOOKS_DISABLED=1\n$/);
    assert.match(leg.err, /disableAllHooks/);
  });
  test("merge refuses an invalid environment patch and a patched manifest that is no object", () => {
    const bad = path.join(realTmp("uc-bad-"), "m.json");
    fs.writeFileSync(bad, "[]");
    same(
      "claude",
      configOf("claude", []),
      `merge_session_recording_hooks "$CLI" "$CFG" ${q(MANIFEST("claude"))} '{'`,
      (f) => ["merge-session-recording-hooks", "claude", f.cfg, MANIFEST("claude"), "{"],
    );
    same(
      "claude",
      configOf("claude", []),
      `merge_session_recording_hooks "$CLI" "$CFG" ${q(bad)}`,
      (f) => ["merge-session-recording-hooks", "claude", f.cfg, bad],
    );
  });
});
