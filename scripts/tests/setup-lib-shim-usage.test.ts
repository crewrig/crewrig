// setup-lib-shim-usage.test.ts — scripts/lib/usage-capture-optin.sh as a forwarding FUNCTION shim of
// scripts/usage-capture-optin.ts (spec 0256 requirement 33, plan step E3/E4b). POSIX-only (the shim is
// Bash). Pins: every public function gives the entry's stdout, stderr and status and leaves the entry's
// configuration bytes; the `--result` side channel sets only the closed whitelist (SR_TRANSCRIPT_WIRED,
// SR_ALL_HOOKS_DISABLED, wrote) with a value of 0 or 1 in the calling shell and removes its file on every
// return path (success, node absent, below the floor); `set -u`, no `exit`, no `trap`, and standard
// input untouched (a sentinel stays readable after the call).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { cap, configOf, rig, SKIP, stamp } from "./lib/usage-capture-rig.ts";
import { MANIFEST } from "./lib/transcript-fixtures.ts";
import { cleanupAll, makePathDir, realTmp, REPO, which } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const LIB = path.join(REPO, "scripts", "lib", "usage-capture-optin.sh");
const ENTRY = path.join(REPO, "scripts", "usage-capture-optin.ts");
const BASH = which("bash") ?? "/bin/bash";
const FN = (sub: string): string => `usage_capture_${sub}`;

interface Out {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** `body` in a `bash -c` under `set -u` that sourced only the shim; `args` are its `$@`. */
function shim(body: string, args: readonly string[], env: NodeJS.ProcessEnv, input = ""): Out {
  const home = realTmp("shim-home-");
  const script = `set -u\nsource ${JSON.stringify(LIB)}\n${body}`;
  const res = spawnSync(BASH, ["-c", script, "bash", ...args], {
    encoding: "utf8",
    cwd: home,
    input,
    env: { ...env, HOME: home },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const entry = (args: readonly string[]): Out => {
  const home = realTmp("shim-entry-");
  const r = spawnSync(process.execPath, [ENTRY, ...args], { encoding: "utf8", cwd: home });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const PATHS: NodeJS.ProcessEnv = process.env;
const norm = (t: string, ...files: string[]): string =>
  stamp(files.reduce((s, f) => s.split(f).join("<F>"), t));
const read = (f: string): string | null => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const live = configOf("claude", [cap("/tmp/x", "claude")]);

type Case = [string, string, unknown, (cfg: string, co: string) => string[]];
const CASES: Case[] = [
  ["abs", "abs", undefined, (_c, co) => [co]],
  ["abs", "abs", undefined, (_c, co) => [co, "sh"]],
  ["fragment", "fragment", undefined, (_c, co) => ["claude", co]],
  ["fragment", "fragment", undefined, (_c, co) => ["bogus", co]],
  ["state", "state", live, (c) => ["claude", c]],
  ["state", "state", undefined, (c) => ["claude", c]],
  ["paths", "paths", live, (c) => ["claude", c]],
  ["footprint", "footprint", live, (c) => ["claude", c]],
  ["footprint", "footprint", "[1]", (c) => ["claude", c]],
  ["rewrite", "rewrite", live, (c, co) => ["claude", c, co]],
  ["reinject", "reinject", live, (c) => ["claude", c, "[]"]],
  ["disclose", "disclose", undefined, (c, co) => ["claude", c, co]],
  ["enable", "enable", undefined, (c, co) => ["claude", c, co]],
  ["enable", "enable", configOf("claude", []), (c, co) => ["claude", c, co]],
  ["keep", "keep", live, (c, co) => ["claude", c, co]],
  ["remove", "remove", live, (c) => ["claude", c]],
  ["apply", "apply", live, (c, co) => ["claude", c, co, "installed", "remove"]],
  ["apply", "apply", undefined, (c, co) => ["claude", c, co, "absent", "yes"]],
  ["apply", "apply", undefined, (c, co) => ["claude", c, co, "weird", "yes"]],
];

describe("each public function through the shim equals the entry", { skip: SKIP }, () => {
  for (const [fn, sub, initial, args] of CASES) {
    test(`${FN(fn)} ${JSON.stringify(args("CFG", "CO").slice(0, 1))}`, () => {
      const r = rig(initial);
      const a = shim(`${FN(fn)} "$@"`, args(r.cfgB, r.co), PATHS);
      const b = entry([sub, "--", ...args(r.cfgT, r.co)]);
      assert.equal(a.status, b.status);
      assert.equal(norm(a.stdout, r.cfgB), norm(b.stdout, r.cfgT));
      assert.equal(norm(a.stderr, r.cfgB), norm(b.stderr, r.cfgT));
      assert.equal(read(r.cfgB), read(r.cfgT));
    });
  }
  test("usage_capture_require_node_floor stays the shell function (silent above the floor)", () => {
    const a = shim("usage_capture_require_node_floor", [], PATHS);
    assert.deepEqual([a.status, a.stdout, a.stderr], [0, "", ""]);
  });
});

/** A PATH directory with the few tools the shim needs; `node` is a stub running `node` when given. */
const dirWith = (node?: string): string =>
  makePathDir({
    links: Object.fromEntries(["dirname", "rm", "wc", "cat"].map((n) => [n, which(n) ?? n])),
    // macOS `mktemp` ignores TMPDIR without a template: pin the directory the tests list.
    scripts: {
      mktemp: `exec ${JSON.stringify(which("mktemp"))} "$TMPDIR/shim.XXXXXXXX"`,
      ...(node === undefined ? {} : { node }),
    },
  });
/** A node stub that runs `pre`, then writes `lines` to its `--result` file (when given) and exits `status`. */
const stubNode = (lines: string, status = 0, pre = ""): string =>
  dirWith(
    `r=; while [ $# -gt 0 ]; do [ "$1" = --result ] && r="$2"; shift; done\n${pre}\n` +
      `[ -n "$r" ] && printf '${lines}' > "$r"\nexit ${status}`,
  );
const withPath = (dir: string, tmp: string): NodeJS.ProcessEnv => ({ PATH: dir, TMPDIR: tmp });
const FILE_FNS = ["render_session_recording_manifest", "merge_session_recording_hooks"];
const SHOW =
  'echo "T=${SR_TRANSCRIPT_WIRED-unset} D=${SR_ALL_HOOKS_DISABLED-unset} W=${wrote-unset} E=${EVIL-unset}"';

describe("the --result side channel", { skip: SKIP }, () => {
  test("the real entry: render and merge set the variables the entry reports", () => {
    const out = path.join(realTmp("shim-out-"), "m.json");
    const sh = shim(
      `render_session_recording_manifest claude "$@"; echo "rc=$? $SR_TRANSCRIPT_WIRED"\n` +
        `merge_session_recording_hooks claude "$HOME/c.json" "$3" '{}'; echo "rc=$? $SR_ALL_HOOKS_DISABLED"`,
      [REPO, MANIFEST("claude"), out],
      PATHS,
    );
    assert.equal(sh.stdout.match(/^rc=0 [01]$/gm)?.length, 2, sh.stderr);
    const res = path.join(realTmp("shim-res-"), "r.txt");
    entry([
      "render-session-recording-manifest",
      "--result",
      res,
      "--",
      "claude",
      REPO,
      MANIFEST("claude"),
      out,
    ]);
    assert.match(sh.stdout, new RegExp(`rc=0 ${read(res)?.trim().split("=")[1]}\\n`));
  });
  test("only the closed whitelist is set, each with 0 or 1; nothing else", () => {
    const tmp = realTmp("shim-tmp-");
    const lines = "SR_TRANSCRIPT_WIRED=1\\nSR_ALL_HOOKS_DISABLED=2\\nwrote=1\\nEVIL=1\\nPATH=/x\\n";
    const a = shim(
      `${FILE_FNS[0]} a b c d; ${SHOW}; echo "P=$PATH"`,
      [],
      withPath(stubNode(lines), tmp),
    );
    assert.match(a.stdout, /T=1 D=unset W=1 E=unset\n/);
    assert.match(a.stdout, /P=\S*\n$/);
    assert.doesNotMatch(a.stdout, /P=\/x/);
    const b = shim(
      `${FILE_FNS[1]} a b c; ${SHOW}`,
      [],
      withPath(stubNode("SR_ALL_HOOKS_DISABLED=1\\n"), tmp),
    );
    assert.match(b.stdout, /T=unset D=1 W=unset E=unset\n/);
  });
  test("the file is removed on success, below the floor and with node absent", () => {
    const tmp = realTmp("shim-tmp-");
    const floor = dirWith('echo "crewrig: requires Node.js >= 24 (stub)" >&2; exit 1');
    const paths = [stubNode("SR_TRANSCRIPT_WIRED=1\\n"), floor, dirWith()];
    for (const [i, dir] of paths.entries()) {
      for (const fn of FILE_FNS) {
        const a = shim(
          `SR_TRANSCRIPT_WIRED=1; ${fn} a b c d; echo "rc=$?"; ${SHOW}`,
          [],
          withPath(dir, tmp),
        );
        assert.deepEqual(fs.readdirSync(tmp), [], `${fn} leg ${i}`);
        if (i > 0) assert.match(a.stdout, /rc=1\n/, a.stderr);
      }
    }
    const absent = shim(`${FILE_FNS[0]} a b c d; ${SHOW}`, [], withPath(paths[2] ?? "", tmp));
    assert.match(absent.stderr, /Node\.js was not found on PATH/);
    assert.match(absent.stdout, /T=0 D=unset/);
    const low = shim(`${FILE_FNS[1]} a b c; ${SHOW}`, [], withPath(paths[1] ?? "", tmp));
    assert.match(low.stderr, /requires Node\.js >= 24 \(stub\)/);
    assert.match(low.stdout, /T=unset D=unset/);
  });
});

describe("shell hygiene", { skip: SKIP }, () => {
  test("set -u: no function reports an unbound variable, with or without arguments", () => {
    for (const fn of [...CASES.map((c) => FN(c[0])), ...FILE_FNS]) {
      for (const args of [[], ["claude"]]) {
        assert.doesNotMatch(shim(`${fn} "$@"`, args, PATHS).stderr, /unbound variable/, fn);
      }
    }
  });
  test("no exit, no trap: the caller runs on, even with node absent", () => {
    const bare = dirWith();
    for (const fn of [...CASES.map((c) => FN(c[0])), ...FILE_FNS]) {
      const a = shim(
        `${fn} a b c d e; echo "after $(trap -p | wc -c)"`,
        [],
        withPath(bare, realTmp("t-")),
      );
      assert.match(a.stdout, /after\s+0\n$/, `${fn}: ${a.stderr}`);
    }
  });
  test("standard input is untouched: a sentinel is still readable after the call", () => {
    for (const fn of ["state", "apply", "disclose"].map(FN).concat(FILE_FNS)) {
      const r = rig(live);
      // A node stub that drains its standard input: only /dev/null from the shim spares the sentinel.
      const env = withPath(stubNode("", 0, "cat >/dev/null"), realTmp("shim-tmp-"));
      const a = shim(
        `${fn} claude "$1" "$2" installed keep >/dev/null 2>&1; IFS= read -r line; echo "got=$line"`,
        [r.cfgB, r.co],
        env,
        "SENTINEL\nrest\n",
      );
      assert.equal(a.stdout, "got=SENTINEL\n", fn);
    }
  });
});
