// mempalace-transcript-token.test.ts — the daemon bearer token of the
// transcript hook (spec 0247 R14): the three rules, the finality of the first
// that applies, the wildcard under rule (c) only and in byte order, whitespace
// removal, the empty token refused, and no file or directory created.
//
// Unit tests over scripts/lib/mempalace-transcript/token.ts under a throwaway
// home (HOME and USERPROFILE swapped for the duration of each test), plus
// black-box runs for the `DAEMON_UNREACHABLE` lines of R14/R15.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";

import { chooseTokenFile, readDaemonToken } from "../lib/mempalace-transcript/token.ts";
import {
  hookEnv,
  lines,
  makeHome,
  runHook,
  snapshotTree,
  writeToken,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

let home: string;
const saved: Record<string, string | undefined> = {};
const KEYS = [
  "HOME",
  "USERPROFILE",
  "MEMPALACE_PALACE_PATH",
  "MEMPALACE_DAEMON_TOKEN_FILE",
  "TOKEN_PATH_MOCK",
];

beforeEach(() => {
  home = makeHome();
  for (const key of KEYS) saved[key] = process.env[key];
  for (const key of KEYS) delete process.env[key];
  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** `<home>/.mempalace/server/<sha256(palace)[0:24]>/token`, computed independently of mcp.js. */
function keyed(palace: string): string {
  const key = crypto.createHash("sha256").update(palace).digest("hex").slice(0, 24);
  return path.join(home, ".mempalace", "server", key, "token");
}

const server = (name: string): string => path.join(home, ".mempalace", "server", name);

describe("rule (a): MEMPALACE_DAEMON_TOKEN_FILE, final", () => {
  test("it wins over the mock and the computed path", () => {
    const named = writeToken(path.join(home, "named"), "A\n");
    process.env["TOKEN_PATH_MOCK"] = writeToken(path.join(home, "mock"), "B\n");
    writeToken(path.dirname(keyed(path.join(home, ".mempalace", "palace"))), "C\n");
    assert.deepEqual(readDaemonToken({ ...process.env, MEMPALACE_DAEMON_TOKEN_FILE: named }), {
      ok: true,
      token: "A",
    });
  });

  test("a named file that does not exist is reported, never replaced", () => {
    const missing = path.join(home, "missing", "token");
    process.env["TOKEN_PATH_MOCK"] = writeToken(path.join(home, "mock"));
    writeToken(server("0first"));
    assert.deepEqual(readDaemonToken({ ...process.env, MEMPALACE_DAEMON_TOKEN_FILE: missing }), {
      ok: false,
      reason: `token file not found at ${missing}`,
    });
  });

  test("an empty value does not apply", () => {
    const mock = writeToken(path.join(home, "mock"), "B");
    assert.equal(
      chooseTokenFile({ ...process.env, MEMPALACE_DAEMON_TOKEN_FILE: "", TOKEN_PATH_MOCK: mock }),
      mock,
    );
  });
});

describe("rule (b): TOKEN_PATH_MOCK, final", () => {
  test("it wins over the computed path and the wildcard", () => {
    const mock = writeToken(path.join(home, "mock"), "B");
    writeToken(server("0first"), "W");
    assert.deepEqual(readDaemonToken({ ...process.env, TOKEN_PATH_MOCK: mock }), {
      ok: true,
      token: "B",
    });
  });

  test("a mock that does not exist is reported, never replaced", () => {
    writeToken(server("0first"), "W");
    const missing = path.join(home, "nope");
    assert.deepEqual(readDaemonToken({ ...process.env, TOKEN_PATH_MOCK: missing }), {
      ok: false,
      reason: `token file not found at ${missing}`,
    });
  });
});

describe("rule (c): the palace-keyed path of mcp_token_path", () => {
  test("the default palace <home>/.mempalace/palace", () => {
    const file = keyed(path.join(home, ".mempalace", "palace"));
    writeToken(path.dirname(file), "K");
    writeToken(server("0other"), "W");
    assert.equal(chooseTokenFile(process.env), file);
    assert.deepEqual(readDaemonToken(process.env), { ok: true, token: "K" });
  });

  test(
    "MEMPALACE_PALACE_PATH, resolved to its physical path when it exists",
    { skip: SKIP_POSIX },
    () => {
      const real = path.join(home, "real-palace");
      fs.mkdirSync(real);
      fs.symlinkSync(real, path.join(home, "link-palace"), "dir");
      process.env["MEMPALACE_PALACE_PATH"] = path.join(home, "link-palace");
      assert.equal(chooseTokenFile(process.env), keyed(real));
    },
  );

  test(
    "a palace that does not exist: its existing parent's physical path, joined with its name",
    { skip: SKIP_POSIX },
    () => {
      const parent = path.join(home, "real-parent");
      fs.mkdirSync(parent);
      fs.symlinkSync(parent, path.join(home, "link-parent"), "dir");
      process.env["MEMPALACE_PALACE_PATH"] = path.join(home, "link-parent", "palace");
      assert.equal(chooseTokenFile(process.env), keyed(path.join(parent, "palace")));
    },
  );

  test("a missing parent: the path as given", () => {
    process.env["MEMPALACE_PALACE_PATH"] = path.join(home, "no", "such", "palace");
    assert.equal(chooseTokenFile(process.env), keyed(path.join(home, "no", "such", "palace")));
  });

  test("nothing anywhere: the computed path is reported", () => {
    const file = keyed(path.join(home, ".mempalace", "palace"));
    assert.deepEqual(readDaemonToken(process.env), {
      ok: false,
      reason: `token file not found at ${file}`,
    });
  });
});

describe("rule (c)'s wildcard: <home>/.mempalace/server/*/token", () => {
  test("only when the computed file is missing, the first in byte order of the directory name", () => {
    writeToken(server("a-lower"), "lower");
    writeToken(server("B-upper"), "upper");
    writeToken(server("Z-upper"), "z");
    assert.equal(chooseTokenFile(process.env), path.join(server("B-upper"), "token"));
    assert.deepEqual(readDaemonToken(process.env), { ok: true, token: "upper" });
  });

  test("byte order, not UTF-16 order: a supplementary character sorts after U+FFxx", () => {
    writeToken(server("Ａ"), "fullwidth");
    writeToken(server("\u{1F600}"), "emoji");
    assert.deepEqual(readDaemonToken(process.env), { ok: true, token: "fullwidth" });
  });

  test("a directory with no token is passed over, as the glob never matched it", () => {
    fs.mkdirSync(server("0-empty"), { recursive: true });
    writeToken(server("1-full"), "T");
    assert.deepEqual(readDaemonToken(process.env), { ok: true, token: "T" });
  });

  test("hidden directories are not matched", () => {
    writeToken(server(".hidden"), "H");
    const file = keyed(path.join(home, ".mempalace", "palace"));
    assert.equal(chooseTokenFile(process.env), file);
  });

  test("a first match that is not a regular file is not replaced by a later one", () => {
    fs.mkdirSync(path.join(server("0-dir"), "token"), { recursive: true });
    writeToken(server("1-file"), "T");
    assert.equal(chooseTokenFile(process.env), keyed(path.join(home, ".mempalace", "palace")));
  });

  test("never under rules (a) and (b)", () => {
    writeToken(server("0first"), "W");
    const missing = path.join(home, "x");
    assert.equal(chooseTokenFile({ ...process.env, TOKEN_PATH_MOCK: missing }), missing);
  });
});

describe("the token's content", () => {
  test("every POSIX whitespace character is removed", () => {
    const file = writeToken(path.join(home, "w"), " to\tk\ven\f\r\n\n x ");
    assert.deepEqual(readDaemonToken({ ...process.env, TOKEN_PATH_MOCK: file }), {
      ok: true,
      token: "tokenx",
    });
  });

  test("an empty or whitespace-only token is refused (R30)", () => {
    for (const content of ["", " \n\t\r\n"]) {
      const file = writeToken(path.join(home, "e"), content);
      assert.deepEqual(readDaemonToken({ ...process.env, TOKEN_PATH_MOCK: file }), {
        ok: false,
        reason: `token file is empty at ${file}`,
      });
    }
  });

  test("a directory named as the token file is not found", () => {
    const dir = path.join(home, "d");
    fs.mkdirSync(dir);
    assert.deepEqual(readDaemonToken({ ...process.env, TOKEN_PATH_MOCK: dir }), {
      ok: false,
      reason: `token file not found at ${dir}`,
    });
  });
});

describe("resolving the token creates no file and no directory", () => {
  const scenarios: Array<[string, () => void]> = [
    ["an empty home (tokenPath() would create ~/.mempalace)", () => {}],
    [
      "a palace path under a missing parent",
      () => {
        process.env["MEMPALACE_PALACE_PATH"] = path.join(home, "a", "b", "palace");
      },
    ],
    ["a server directory with a token", () => writeToken(server("0first"))],
    [
      "a named file that is missing",
      () => {
        process.env["MEMPALACE_DAEMON_TOKEN_FILE"] = path.join(home, "m", "token");
      },
    ],
  ];
  for (const [name, setup] of scenarios) {
    test(name, () => {
      setup();
      const before = snapshotTree(home);
      readDaemonToken(process.env);
      chooseTokenFile(process.env);
      assert.deepEqual(snapshotTree(home), before);
    });
  }
});

describe("the hook's lines for a token failure (R14, R15)", () => {
  const payload = JSON.stringify({ prompt: "p", cwd: "/w/proj" });

  test("not found: DAEMON_UNREACHABLE, then FAILED with rc=4; the home left untouched", () => {
    const before = snapshotTree(home);
    const res = runHook(["claude-code"], payload, {
      env: hookEnv(home, { MEMPALACE_MCP_PORT: "9" }),
    });
    const file = keyed(path.join(home, ".mempalace", "palace"));
    assert.equal(res.status, 0);
    assert.deepEqual(lines(res.stderr), [
      `DAEMON_UNREACHABLE: token file not found at ${file}`,
      "mempalace-transcript: FAILED to persist user-prompt (rc=4): ",
    ]);
    assert.deepEqual(snapshotTree(home), before);
  });

  test("empty: DAEMON_UNREACHABLE saying so, rc=4, whatever QUIET says", () => {
    const file = writeToken(path.join(home, "e"), "\n");
    const res = runHook(["claude-code"], payload, {
      env: hookEnv(home, {
        TOKEN_PATH_MOCK: file,
        MEMPALACE_TRANSCRIPT_QUIET: "1",
        MEMPALACE_MCP_PORT: "9",
      }),
    });
    assert.deepEqual(lines(res.stderr), [
      `DAEMON_UNREACHABLE: token file is empty at ${file}`,
      "mempalace-transcript: FAILED to persist user-prompt (rc=4): ",
    ]);
  });
});
