// skill-evals-claude-child.test.ts — what every `claude` child of the runner shares
// (spec 0290 delta-03 R32, R40, R41, R42): the isolation flags, the environment allowlist, the login
// probe and the temporary-directory guard. A stub `claude` answers `auth status --json` with decoy
// account fields (an e-mail address and an organisation) and logs argv and environment; nothing here
// reaches a real `claude`, a model or the network.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock, test } from "node:test";

import {
  cannotStartMessage,
  checkTempRoot,
  childBaseEnv,
  childEnv,
  claudeBinary,
  INSTALL_HINT,
  ISOLATION_FLAGS,
  notLoggedInMessage,
  probeLogin,
  resetLoginProbe,
} from "../lib/skill-evals/claude-child.ts";
import {
  DECOY_EMAIL,
  DECOY_ORG,
  isolatedDirs,
  makeRepo,
  readCalls,
  skillRel,
  tmpDir,
  writeSessionStub,
  writeStubClaude,
} from "./lib/skill-evals-fixtures.ts";
import type { AuthStub } from "./lib/skill-evals-fixtures.ts";
import { makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const MEMBERS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "USER",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
];

const TEMPS: string[] = [];
const temp = (): string => {
  const d = tmpDir("skill-evals-cc-");
  TEMPS.push(d);
  return d;
};
test.after(() => {
  for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
});

test("R40: the isolation flags are exactly --setting-sources project, --strict-mcp-config and --no-session-persistence, and never --bare", () => {
  assert.deepEqual(
    [...ISOLATION_FLAGS],
    ["--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence"],
  );
  assert.equal(ISOLATION_FLAGS.includes("--bare"), false);
});

test("R42: childBaseEnv passes exactly the allowlist members that are set, the network variables in both cases and USER included, and nothing else", () => {
  const all = Object.fromEntries(MEMBERS.map((k) => [k, `v-${k}`]));
  const out = childBaseEnv({
    ...all,
    ANTHROPIC_API_KEY: "sk-key",
    CLAUDE_CODE_OAUTH_TOKEN: "tok",
    SKILL_EVALS_CLAUDE_BIN: "/bin/claude",
    SOME_OTHER: "x",
    SHELL: "/bin/zsh",
    LOGNAME: "me",
  });
  assert.deepEqual(out, all);
  for (const k of [
    "USER",
    "HTTPS_PROXY",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "http_proxy",
  ])
    assert.equal(out[k], `v-${k}`, k);
  // a member that is unset (or undefined) is absent, not an empty string
  assert.deepEqual(childBaseEnv({ PATH: "/bin", HOME: undefined, USER: "u" }), {
    PATH: "/bin",
    USER: "u",
  });
  assert.deepEqual(childBaseEnv({}), {});
});

test("R42: childEnv adds exactly one credential variable and never ANTHROPIC_API_KEY by itself", () => {
  const base = { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t" };
  assert.deepEqual(childEnv(base), { PATH: "/bin", HOME: "/h" });
  assert.deepEqual(childEnv(base, { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "t" }), {
    PATH: "/bin",
    HOME: "/h",
    CLAUDE_CODE_OAUTH_TOKEN: "t",
  });
  assert.deepEqual(childEnv(base, { name: "ANTHROPIC_API_KEY", value: "k" }), {
    PATH: "/bin",
    HOME: "/h",
    ANTHROPIC_API_KEY: "k",
  });
});

test("claudeBinary: `claude` unless SKILL_EVALS_CLAUDE_BIN is set; the refusal messages carry the hint and say no model call was made", () => {
  assert.equal(claudeBinary({}), "claude");
  assert.equal(claudeBinary({ SKILL_EVALS_CLAUDE_BIN: "" }), "claude");
  assert.equal(claudeBinary({ SKILL_EVALS_CLAUDE_BIN: "/x/claude" }), "/x/claude");
  assert.match(
    cannotStartMessage({ SKILL_EVALS_CLAUDE_BIN: "/x/claude" }),
    /cannot start `\/x\/claude`.*No model call was made/,
  );
  assert.ok(cannotStartMessage({}).includes(INSTALL_HINT));
  const plain = notLoggedInMessage(false);
  assert.match(plain, /Run `claude` and log in/);
  assert.match(plain, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(plain, /--use-api-key/);
  assert.doesNotMatch(plain, /was not requested/);
  assert.match(notLoggedInMessage(true), /ANTHROPIC_API_KEY is set but was not requested/);
});

// ------------------------------------------------------------------------------------ probeLogin

const probeOf = async (auth: AuthStub, env: Record<string, string> = {}) => {
  resetLoginProbe();
  const dir = temp();
  const bin = writeStubClaude(dir, undefined, "claude-stub.js", auth);
  const cwd = temp();
  const state = await probeLogin(
    { PATH: process.env["PATH"], SKILL_EVALS_CLAUDE_BIN: bin, ...env },
    { tempRoot: cwd },
  );
  return { state, bin, cwd };
};

test("R41: the contributor is logged in only when the command exits 0 and prints a JSON object whose loggedIn is true", async () => {
  const cases: [string, AuthStub, string][] = [
    ["exit 0, loggedIn true", { loggedIn: true }, "logged-in"],
    ["exit 1, loggedIn false", { loggedIn: false }, "not-logged-in"],
    ["exit 0, loggedIn false", { loggedIn: false, exitCode: 0 }, "not-logged-in"],
    ["exit 1 wins over loggedIn true", { loggedIn: true, exitCode: 1 }, "not-logged-in"],
    [
      "loggedIn absent",
      { loggedIn: true, raw: JSON.stringify({ email: DECOY_EMAIL }) },
      "not-logged-in",
    ],
    [
      "loggedIn is the string true",
      { loggedIn: true, raw: JSON.stringify({ loggedIn: "true" }) },
      "not-logged-in",
    ],
    ["junk output", { loggedIn: true, raw: "not json at all" }, "not-logged-in"],
    ["empty output", { loggedIn: true, raw: "" }, "not-logged-in"],
    [
      "a JSON array",
      { loggedIn: true, raw: JSON.stringify([{ loggedIn: true }]) },
      "not-logged-in",
    ],
    ["JSON null", { loggedIn: true, raw: "null" }, "not-logged-in"],
  ];
  for (const [what, auth, expected] of cases) {
    const r = await probeOf(auth);
    assert.equal(r.state, expected, what);
  }
});

test("R41: a binary that cannot be started is cannot-start, not not-logged-in", async () => {
  resetLoginProbe();
  const state = await probeLogin(
    { SKILL_EVALS_CLAUDE_BIN: "/nonexistent/claude" },
    { tempRoot: temp() },
  );
  assert.equal(state, "cannot-start");
});

test("R41: a probe that never answers times out as not-logged-in (the timer is faked: no real wait)", async () => {
  resetLoginProbe();
  const dir = temp();
  const bin = writeStubClaude(dir, undefined, "claude-stub.js", { loggedIn: true, hang: true });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = probeLogin(
      { PATH: process.env["PATH"], SKILL_EVALS_CLAUDE_BIN: bin },
      { tempRoot: temp() },
    );
    // the timer is armed synchronously by probeLogin; fire it well past any plausible limit
    mock.timers.tick(10 * 60_000);
    assert.equal(await pending, "not-logged-in");
  } finally {
    mock.timers.reset();
  }
});

test("R41, R42: the probe is `auth status --json` with no model call, the allowlisted environment only, no key and no token, and the temp root as its cwd", async () => {
  const r = await probeOf(
    { loggedIn: true },
    {
      HOME: "/contributor/home",
      USER: "contributor",
      HTTPS_PROXY: "http://p.invalid:1",
      https_proxy: "http://p.invalid:2",
      ANTHROPIC_API_KEY: "sk-not-requested",
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      SOME_OTHER: "x",
    },
  );
  assert.equal(r.state, "logged-in");
  const calls = readCalls(r.bin);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.argv, ["auth", "status", "--json"]);
  assert.equal(calls[0]?.env["HOME"], "/contributor/home");
  assert.equal(calls[0]?.env["USER"], "contributor");
  assert.equal(calls[0]?.env["HTTPS_PROXY"], "http://p.invalid:1");
  assert.equal(calls[0]?.env["https_proxy"], "http://p.invalid:2");
  for (const k of [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "SOME_OTHER",
    "SKILL_EVALS_CLAUDE_BIN",
  ])
    assert.equal(calls[0]?.env[k], undefined, k);
  assert.equal(fs.realpathSync(calls[0]?.cwd ?? ""), fs.realpathSync(r.cwd));
  assert.deepEqual(readCalls(r.bin, "model"), [], "the model entry point is never reached");
  assert.deepEqual(fs.readdirSync(r.cwd), [], "the probe writes nothing");
});

test("F4: the probe is memoised per binary, HOME, USER and CLAUDE_CONFIG_DIR: concurrent and repeated calls spawn one child; a different contributor or a reset spawns another", async () => {
  resetLoginProbe();
  const dir = temp();
  const bin = writeStubClaude(dir, undefined, "claude-stub.js", { loggedIn: true });
  const env = { PATH: process.env["PATH"], SKILL_EVALS_CLAUDE_BIN: bin, HOME: "/h1", USER: "u" };
  const root = temp();
  const states = await Promise.all(
    Array.from({ length: 8 }, () => probeLogin(env, { tempRoot: root })),
  );
  assert.deepEqual([...new Set(states)], ["logged-in"]);
  assert.equal(await probeLogin(env, { tempRoot: root }), "logged-in");
  assert.equal(readCalls(bin, "auth").length, 1);
  await probeLogin({ ...env, HOME: "/h2" }, { tempRoot: root });
  assert.equal(readCalls(bin, "auth").length, 2, "another HOME is another login");
  await probeLogin({ ...env, CLAUDE_CONFIG_DIR: "/c" }, { tempRoot: root });
  assert.equal(readCalls(bin, "auth").length, 3);
  resetLoginProbe();
  await probeLogin(env, { tempRoot: root });
  assert.equal(readCalls(bin, "auth").length, 4, "a new invocation probes again");
});

// -------------------------------------------------------------------------------- checkTempRoot

test("R32: checkTempRoot refuses a temporary directory inside HOME, naming TMPDIR, and accepts one outside HOME and any git work tree", () => {
  const base = temp();
  const home = path.join(base, "home");
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(home, "deep", "tmp"), { recursive: true });
  fs.mkdirSync(outside);
  const inside = checkTempRoot(path.join(home, "deep", "tmp"), home);
  assert.ok(inside !== undefined);
  assert.match(inside, /TMPDIR/);
  assert.match(inside, /inside your home directory/);
  assert.match(inside, /No model call was made/);
  assert.ok(checkTempRoot(home, home) !== undefined, "HOME itself is inside HOME");
  assert.equal(checkTempRoot(outside, home), undefined);
});

test("F3: the comparison is by real path and by path segment: a symlinked HOME or temp root is resolved, a name that merely starts like HOME is outside, and a failed git rev-parse is not 'inside'", () => {
  const base = temp();
  const realHome = path.join(base, "real-home");
  const link = path.join(base, "home-link");
  fs.mkdirSync(path.join(realHome, "tmp"), { recursive: true });
  fs.symlinkSync(realHome, link);
  // HOME given through a symlink, temp root given by its real path
  assert.ok(checkTempRoot(path.join(realHome, "tmp"), link) !== undefined);
  // temp root given through a symlink that points into HOME
  const sneaky = path.join(base, "innocent");
  fs.symlinkSync(path.join(realHome, "tmp"), sneaky);
  assert.ok(
    checkTempRoot(sneaky, realHome) !== undefined,
    "the real path of the temp root decides",
  );
  // a sibling whose name starts with HOME's name
  const lookalike = path.join(base, "real-home-2");
  fs.mkdirSync(lookalike);
  assert.equal(
    checkTempRoot(lookalike, realHome),
    undefined,
    "real-home-2 is not inside real-home",
  );
  // a directory that is not a git work tree: `git rev-parse` fails (exit 128) and that is not 'inside'
  assert.equal(checkTempRoot(lookalike, path.join(base, "elsewhere")), undefined);
  // a missing HOME directory does not throw
  assert.equal(checkTempRoot(lookalike, path.join(base, "missing", "home")), undefined);
});

test("R32: checkTempRoot refuses a temporary directory inside a git work tree, at any depth", () => {
  const repo = makeRepo();
  try {
    const nested = path.join(repo.root, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    for (const dir of [repo.root, nested]) {
      const msg = checkTempRoot(dir, path.join(repo.root, "..", "no-such-home"));
      assert.ok(msg !== undefined, dir);
      assert.match(msg, /inside a git work tree/);
      assert.match(msg, /TMPDIR/);
    }
  } finally {
    repo.cleanup();
  }
});

// ------------------------------------------------------------------- the runner, end to end

function runnerRig(auth: AuthStub, tempRoot: (iso: ReturnType<typeof isolatedDirs>) => string) {
  const dir = temp();
  const bin = writeSessionStub(dir, auth);
  const iso = isolatedDirs();
  const rig = makeRig({
    mock: false,
    tempRoot: tempRoot(iso),
    env: { SKILL_EVALS_CLAUDE_BIN: bin, HOME: iso.home, USER: "contributor" },
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 1),
      ),
  });
  return {
    rig,
    bin,
    iso,
    run: () => rig.run({ executor: undefined }),
    cleanup: () => {
      rig.cleanup();
      iso.cleanup();
    },
  };
}

test("R32: with the temporary directory inside HOME the runner exits 3 naming TMPDIR before any probe or model call, and writes nothing", async () => {
  const t = runnerRig({ loggedIn: true }, (iso) => {
    const inside = path.join(iso.home, "tmp");
    fs.mkdirSync(inside);
    return inside;
  });
  try {
    const r = await t.run();
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /TMPDIR/);
    assert.match(r.stderr, /inside your home directory/);
    assert.match(r.stderr, /No model call was made/);
    assert.equal(readCalls(t.bin).length, 0, "no probe, no executor, no judge");
    assert.equal(t.rig.executor.calls.length, 0);
    assert.equal(fs.existsSync(path.join(t.rig.out, "demo")), false);
    assert.equal(
      fs.existsSync(path.join(t.rig.repo.root, skillRel("demo"), "evals", "results.json")),
      false,
    );
    assert.equal(r.credentialSource, undefined);
  } finally {
    t.cleanup();
  }
});

test("R32: with the temporary directory inside a git work tree the runner exits 3 naming TMPDIR and the work tree, with no model call", async () => {
  const other = makeRepo();
  const t = runnerRig({ loggedIn: true }, () => {
    const inside = path.join(other.root, "scratch");
    fs.mkdirSync(inside);
    return inside;
  });
  try {
    const r = await t.run();
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /TMPDIR/);
    assert.match(r.stderr, /inside a git work tree/);
    assert.equal(readCalls(t.bin).length, 0);
    assert.equal(t.rig.executor.calls.length, 0);
  } finally {
    t.cleanup();
    other.cleanup();
  }
});

const walk = (dir: string, hits: string[], needles: string[]): void => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, hits, needles);
    else if (e.isFile()) {
      const text = fs.readFileSync(abs, "utf8");
      for (const n of needles) if (text.includes(n)) hits.push(`${abs}: ${n}`);
    }
  }
};

test("the login probe never leaks the account: neither the runner's output nor any written file holds the stub's e-mail address or organisation, on a login that succeeds or fails", async () => {
  for (const loggedIn of [true, false]) {
    const t = runnerRig({ loggedIn }, (iso) => iso.tempRoot);
    try {
      const r = await t.run();
      assert.equal(r.exitCode, loggedIn ? 0 : 3, r.text + r.stderr);
      assert.equal(readCalls(t.bin, "auth").length, 1, "the stub did print its account fields");
      assert.doesNotMatch(r.text + r.stderr, new RegExp(`${DECOY_EMAIL}|${DECOY_ORG}`));
      const hits: string[] = [];
      for (const dir of [t.rig.out, t.rig.repo.root, t.iso.tempRoot, t.iso.home])
        walk(dir, hits, [DECOY_EMAIL, DECOY_ORG, "decoy.person"]);
      assert.deepEqual(hits, [], "no written file holds an account field");
    } finally {
      t.cleanup();
    }
  }
});
