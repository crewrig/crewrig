// mempalace-transcript-shim.test.ts — hooks/mempalace-transcript.sh, the
// forwarding shim (spec 0247 R2 as reworded by delta-01, scenario "The shim
// stops cleanly below the floor"; plan seat finding v1-F1).
//
// Three branches, each run through `bash <shim>` the way a legacy command line
// runs it: `node` absent (one shell-authored line), a `node` reporting major 20
// (the floor guard's diagnostic, the entry not run), and a healthy `node` (the
// entry's status and streams forwarded, standard input included). On both
// failure branches the exit status is 0 and the Antigravity acknowledgement is
// written exactly when the first argument is non-empty and none of
// `claude-code`, `gemini-cli`, `copilot-cli` — `antigravity-cli` included, so
// its wrong-arity case still acknowledges.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import {
  daemonEnv,
  drawerArgs,
  HOOK_SH,
  lines,
  makeHome,
  startStub,
  writeToken,
  type Stub,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, SKIP_POSIX, which, type Result } from "./lib/worktree-fixtures.ts";

const BASH = which("bash") ?? "/bin/bash";
const PROMPT = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "through the shim",
  cwd: "/w/proj",
});

/** [arguments, acknowledged?] — the v1-F1 rows. */
const ROWS: Array<[string[], boolean]> = [
  [["antigravity-cli", "Stop"], true],
  [["antigravity-cli"], true],
  [["Stop"], true],
  [["Stop", "extra"], true],
  [["PreInvocation"], true],
  [["claude-code"], false],
  [["gemini-cli"], false],
  [["copilot-cli"], false],
  [["claude-code", "Stop"], false],
  [[], false],
  [["", "Stop"], false],
];

let stub: Stub;
let home: string;
let token: string;

before(async () => {
  stub = await startStub("ok");
  home = makeHome();
  token = writeToken(path.join(home, "t"));
});
after(async () => {
  await stub.stop();
  cleanupAll();
});

function shim(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input = PROMPT,
): Result & { sent: number } {
  const before = stub.requests().length;
  const res = spawnSync(BASH, [HOOK_SH, ...args], {
    env,
    input,
    encoding: "utf8",
    cwd: home,
    timeout: 30_000,
  });
  return {
    status: res.status,
    signal: res.signal,
    stdout: res.stdout,
    stderr: res.stderr,
    sent: stub.requests().length - before,
  };
}

/** The daemon variables over a PATH environment, recording enabled for every shape. */
function over(pathEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...daemonEnv(home, stub.port, token, { MEMPALACE_TRANSCRIPT_ENABLED: "1" }),
    PATH: pathEnv["PATH"],
  };
}

describe("node absent from the search path (R2(a))", { skip: SKIP_POSIX }, () => {
  for (const [args, ack] of ROWS) {
    test(`${JSON.stringify(args)}: one line, exit 0, stdout ${ack ? "{}" : "empty"}`, () => {
      const res = shim(args, over(pathWithoutNode()));
      assert.equal(res.status, 0);
      assert.equal(res.stderr, "mempalace-transcript: node required\n");
      assert.equal(res.stdout, ack ? "{}\n" : "");
      assert.equal(res.sent, 0);
    });
  }
});

describe("node below the floor (R2(b))", { skip: SKIP_POSIX }, () => {
  for (const [args, ack] of ROWS) {
    test(`${JSON.stringify(args)}: the floor guard's diagnostic, the entry not run, exit 0`, () => {
      const res = shim(args, over(pathWithFakeNode()));
      assert.equal(res.status, 0, res.stderr);
      assert.equal(lines(res.stderr).length, 1, res.stderr);
      assert.match(res.stderr, /v20\.11\.1/);
      assert.match(res.stderr, /requires Node\.js >= 24/);
      assert.doesNotMatch(res.stderr, /mempalace-transcript:/, "the entry did not run");
      assert.equal(res.stdout, ack ? "{}\n" : "");
      assert.equal(res.sent, 0);
    });
  }
});

describe(
  "a healthy node: the entry runs with the shim's arguments and standard input (R2)",
  { skip: SKIP_POSIX },
  () => {
    test("direct form: the payload reaches the entry and the daemon; stdout empty", () => {
      const res = shim(["claude-code"], over(process.env));
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "");
      assert.equal(res.sent, 1);
      assert.equal(drawerArgs(stub.requests().at(-1)!)["content"], "[USER] through the shim");
      assert.match(
        res.stderr,
        /^mempalace-transcript: persisted user-prompt to transcripts\/proj-/,
      );
    });

    test("Antigravity mode: the entry's single acknowledgement, not two", () => {
      for (const args of [["antigravity-cli", "Stop"], ["Stop"]]) {
        const res = shim(args, over(process.env));
        assert.equal(res.stdout, "{}\n", JSON.stringify(args));
        assert.equal(res.sent, 1);
      }
    });

    test("the entry's own diagnostics are forwarded unchanged", () => {
      const res = shim(["claude-code", "Stop"], over(process.env));
      assert.equal(res.status, 0);
      assert.equal(res.stdout, "");
      assert.equal(
        res.stderr,
        "mempalace-transcript: expected no argument, <event>, claude-code, gemini-cli, copilot-cli or antigravity-cli <event>\n",
      );
      assert.equal(res.sent, 0);
    });

    test("the legacy gate is the entry's: no argument and ENABLED unset records nothing", () => {
      const env = over(process.env);
      delete env["MEMPALACE_TRANSCRIPT_ENABLED"];
      const res = shim([], env);
      assert.deepEqual([res.status, res.stdout, res.stderr, res.sent], [0, "", "", 0]);
    });

    test("the shim resolves the entry next to itself, whatever the working directory", () => {
      const res = spawnSync(BASH, [path.relative(home, HOOK_SH), "gemini-cli"], {
        env: over(process.env),
        input: PROMPT,
        encoding: "utf8",
        cwd: home,
      });
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stderr, /persisted user-prompt/);
    });
  },
);
