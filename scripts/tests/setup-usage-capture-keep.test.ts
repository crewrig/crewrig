// setup-usage-capture-keep.test.ts — usageCaptureKeep (scripts/lib/setup/usage-capture-keep.ts)
// against `usage_capture_keep` of scripts/lib/usage-capture-optin.sh (spec 0256 requirement 30).
// Every case runs the same input through the shell function and through the TypeScript module, on two
// copies of one configuration; the status, both streams, the file bytes, its mode and the backups
// must be identical (harness: lib/keep-differential.ts). POSIX with jq only.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  CLIS,
  compare,
  config,
  direct,
  EVENTS,
  handler,
  ID,
  makePaths,
  OPERATOR,
  viaSh,
  type Case,
  type Outcome,
  type Paths,
} from "./lib/keep-differential.ts";
import { cleanupAll, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

after(cleanupAll);
const SKIP = SKIP_POSIX || (which("jq") === null ? "SKIP: needs jq" : false);

function same(name: string, c: (p: Paths) => Case, expect?: (sh: Outcome) => void) {
  test(name, { skip: SKIP }, () => {
    const p = makePaths();
    const { sh, ts } = compare(c(p), p);
    assert.deepEqual(ts, sh);
    expect?.(sh);
  });
}

describe("usageCaptureKeep is byte-identical to usage_capture_keep", () => {
  for (const cli of CLIS) {
    const [first = "", second = first] = EVENTS[cli];
    const both = (p: Paths, make: (ev: string) => string[]) =>
      Object.fromEntries(EVENTS[cli].map((ev) => [ev, make(ev).map((x) => handler(x))]));
    same(
      `${cli}: live commands on every event are unchanged: no write, no backup`,
      (p) => ({
        cli,
        input: config(
          cli,
          both(p, (ev) => [direct(cli, ev, p.live)]),
        ),
      }),
      (o) => {
        assert.match(o.out, /kept unchanged/);
        assert.deepEqual(o.backups, []);
        assert.equal(o.mode, 0o644);
      },
    );
    same(
      `${cli}: a vanished .ts and a vanished .sh are re-pointed, form preserved`,
      (p) => ({
        cli,
        input: config(cli, {
          [first]: [handler(direct(cli, first, p.gone))],
          [second]: [handler(viaSh(cli, second, p.gone))],
        }),
      }),
      (o) => {
        assert.match(
          o.out,
          /re-pointed .*gone\/hooks\/usage-capture\.(ts|sh) -> .*repo\/hooks\/usage-capture\.ts/,
        );
        assert.equal(o.backups.length, 1);
        assert.equal(o.mode, 0o600);
      },
    );
    same(`${cli}: duplicates, live over vanished`, (p) => ({
      cli,
      input: config(cli, {
        [first]: [
          handler(direct(cli, first, p.gone)),
          OPERATOR,
          handler(direct(cli, first, p.live)),
          handler(direct(cli, first, p.live)),
        ],
      }),
    }));
    same(`${cli}: duplicates, unresolvable over vanished, both vanished, both live`, (p) => ({
      cli,
      input: config(cli, {
        [first]: [
          handler(direct(cli, first, p.gone)),
          handler(`node "$HOME/hooks/usage-capture.ts" ${ID[cli]} ${first}`),
        ],
        [second === first ? "Other" : second]: [
          handler(direct(cli, second, p.gone)),
          handler(direct(cli, second, p.gone2)),
          handler(viaSh(cli, second, p.live)),
          handler(direct(cli, second, p.shOnly)),
        ],
      }),
    }));
    same(
      `${cli}: a missing event is added at the live checkout's .ts, else at the current one`,
      (p) => ({
        cli,
        input: config(cli, { [first]: [handler(viaSh(cli, first, p.live))], Operator: [OPERATOR] }),
      }),
      (o) => {
        // Gemini registers a single event: nothing is missing once its handler is there.
        if (EVENTS[cli].length > 1) {
          assert.match(o.out, /re-registered on 1 event\(s\) at .*live\/hooks\/usage-capture\.ts/);
        }
      },
    );
    same(
      `${cli}: a live .sh with no .ts next to it sends the added handler to the current checkout`,
      (p) => ({ cli, input: config(cli, { [first]: [handler(viaSh(cli, first, p.shOnly))] }) }),
    );
    same(`${cli}: no hooks key at all, and an empty hooks object`, (p) => ({
      cli,
      input: { model: "m", n: 1.5, s: "é" },
    }));
    same(
      `${cli}: a capture handler on another event and foreign operator hooks are left alone`,
      (p) => ({
        cli,
        input: config(
          cli,
          {
            [first]: [OPERATOR, handler(direct(cli, first, p.gone)), handler("echo hi")],
            Notification: [
              handler(direct(cli, "Notification", p.gone)),
              handler(direct(cli, "Notification", p.gone2)),
            ],
          },
          { env: { A: "1" } },
        ),
      }),
    );
    same(
      `${cli}: a group emptied by the deduplication is pruned, a group that was empty stays`,
      (p) => ({
        cli,
        input:
          cli === "copilot"
            ? config(cli, {
                [first]: [handler(direct(cli, first, p.live)), handler(direct(cli, first, p.gone))],
              })
            : {
                hooks: {
                  [first]: [
                    { matcher: "", hooks: [handler(direct(cli, first, p.live))] },
                    { matcher: "Bash", hooks: [handler(direct(cli, first, p.gone))] },
                    { matcher: "x", hooks: [] },
                    "odd",
                  ],
                },
              },
      }),
    );
    same(`${cli}: a prefixed vanished handler keeps its prefix on POSIX`, (p) => ({
      cli,
      input: config(cli, {
        [first]: [handler(viaSh(cli, first, p.gone, "FOO=bar "))],
        [second]: [handler(direct(cli, second, p.live))],
      }),
    }));
  }
  same(
    "gemini: the legacy unquoted spaced path of an existing file gains its quotes",
    (p) => ({
      cli: "gemini",
      input: config("gemini", {
        AfterModel: [handler(`bash ${p.spaced}/hooks/usage-capture.sh gemini-cli AfterModel`)],
      }),
    }),
    (o) => assert.match(o.out, /path quoted \(it holds a space\)/),
  );
  same("gemini: a legacy spaced path of a missing file is no capture handler", (p) => ({
    cli: "gemini",
    input: config("gemini", {
      AfterModel: [
        handler(`bash ${p.root}/Not There/hooks/usage-capture.sh gemini-cli AfterModel`),
      ],
    }),
  }));
  same("gemini: a vanished legacy spaced path next to a live one", (p) => ({
    cli: "gemini",
    input: config("gemini", {
      AfterModel: [
        handler(`bash ${p.spaced}/hooks/usage-capture.sh gemini-cli AfterModel`),
        handler(direct("gemini", "AfterModel", p.gone)),
      ],
    }),
  }));
  same("claude: the added handler joins the group of the same selector", (p) => ({
    cli: "claude",
    input: {
      hooks: {
        SessionEnd: [
          { matcher: "Bash", hooks: [OPERATOR] },
          { matcher: "", hooks: [OPERATOR] },
        ],
        Stop: [{ matcher: "", hooks: [handler(direct("claude", "Stop", p.live))] }],
      },
    },
  }));
  for (const cli of ["gemini", "copilot"] as const) {
    same(
      `${cli}: a prefixed vanished handler is left, and named, on Windows PowerShell`,
      (p) => ({
        cli,
        platform: "win32",
        input: config(
          cli,
          Object.fromEntries(
            EVENTS[cli].map((ev) => [
              ev,
              [
                handler(viaSh(cli, ev, p.gone, "TOKEN=x A=b ")),
                handler(viaSh(cli, ev, p.gone, "TOKEN=x A=b ")),
              ],
            ]),
          ),
        ),
      }),
      (o) =>
        assert.match(
          o.out,
          /left .*gone\/hooks\/usage-capture\.sh: keeps an environment prefix \(TOKEN=\.\.\., A=\.\.\.\) that PowerShell/,
        ),
    );
  }
  same(
    "an absent file",
    () => ({ cli: "claude", input: null }),
    (o) => assert.match(o.out, /nothing to keep/),
  );
  same(
    "a file that is not a JSON object",
    () => ({ cli: "claude", input: "[1]\n" }),
    (o) => assert.equal(o.status, 1),
  );
  same(
    "an unknown CLI",
    () => ({ cli: "antigravity", input: {} }),
    (o) => assert.equal(o.status, 1),
  );
  same("a second run writes nothing and makes no new backup", (p) => ({
    cli: "claude",
    input: config("claude", { Stop: [handler(direct("claude", "Stop", p.gone))] }),
  }));

  test(
    "hooks that is not an object: the shell fails when a handler must be added, so does the module",
    { skip: SKIP },
    () => {
      const p = makePaths();
      const { sh, ts } = compare({ cli: "claude", input: { hooks: [] } }, p);
      assert.equal(ts.status, 1);
      assert.equal(sh.status, 1);
      assert.equal(ts.file, sh.file);
    },
  );

  test("keep run again on its own output is a no-op", { skip: SKIP }, () => {
    const p = makePaths();
    const first = compare(
      {
        cli: "copilot",
        input: config("copilot", { agentStop: [handler(direct("copilot", "agentStop", p.gone))] }),
      },
      p,
    );
    const again = compare({ cli: "copilot", input: first.ts.file ?? "" }, p);
    assert.match(again.ts.out, /kept unchanged/);
    assert.deepEqual(again.ts, again.sh);
  });
});
