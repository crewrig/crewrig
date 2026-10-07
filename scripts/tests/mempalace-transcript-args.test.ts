// mempalace-transcript-args.test.ts — argument shapes, enablement, the
// Antigravity acknowledgement, the exit status and the cheap guard of the
// transcript hook (spec 0247 R3-R7, R9), black-box against the stub daemon.
//
// Also the Git top level from a linked worktree (R9, issue #92), which replaces
// the source-text case of scripts/tests/test-mempalace-transcript-hook.sh that
// spec 0247 R32 removed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  closedPort,
  daemonEnv,
  drawerArgs,
  lines,
  makeHome,
  runHook,
  SPAWN_SPY,
  startStub,
  today,
  writeToken,
  type Stub,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, makeFixture, realTmp, type Result } from "./lib/worktree-fixtures.ts";

const PROMPT = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: "hello",
  session_id: "abcdefghij",
  cwd: "/work/proj",
});
const SHAPES_LINE =
  "mempalace-transcript: expected no argument, <event>, claude-code, gemini-cli, copilot-cli or antigravity-cli <event>\n";

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

/** Run the hook and return its result with the requests it caused. */
function run(
  args: readonly string[],
  enabled: string | undefined,
  input: string | null = PROMPT,
  extra: Record<string, string | undefined> = {},
  options: { cwd?: string; nodeArgs?: string[] } = {},
): Result & { sent: number } {
  const beforeCount = stub.requests().length;
  const res = runHook(args, input, {
    env: daemonEnv(home, stub.port, token, { MEMPALACE_TRANSCRIPT_ENABLED: enabled, ...extra }),
    cwd: options.cwd,
    nodeArgs: options.nodeArgs,
  });
  return { ...res, sent: stub.requests().length - beforeCount };
}

function recorded(res: Result & { sent: number }, stdout: string): void {
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.sent, 1, res.stderr);
  assert.equal(res.stdout, stdout);
  assert.match(res.stderr, /^mempalace-transcript: persisted user-prompt to transcripts\/\S+\n$/);
}

function silent(res: Result & { sent: number }, stdout: string): void {
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.sent, 0);
  assert.equal(res.stderr, "");
  assert.equal(res.stdout, stdout);
}

describe("shape (a): no argument or an empty first one, gated on ENABLED=1 (R3, R4)", () => {
  test("no argument records when ENABLED=1, nothing on stdout", () => recorded(run([], "1"), ""));
  test("an empty first argument is shape (a)", () => recorded(run([""], "1"), ""));
  test("an empty first argument ignores further arguments", () =>
    recorded(run(["", "Stop", "x"], "1"), ""));
  for (const value of [undefined, "", "0", "true", "yes"]) {
    test(`ENABLED=${String(value)}: silent, nothing sent`, () => silent(run([], value), ""));
  }
});

describe("shape (b): the legacy Antigravity form (R3, R4, R5)", () => {
  test("`Stop` records when ENABLED=1 and acknowledges", () =>
    recorded(run(["Stop"], "1"), "{}\n"));
  test("`Stop extra` is shape (b): the extra argument is ignored", () =>
    recorded(run(["Stop", "extra"], "1"), "{}\n"));
  test("disabled: only the acknowledgement", () => silent(run(["Stop"], undefined), "{}\n"));
  test("ENABLED empty is not ENABLED=1 in the legacy form", () =>
    silent(run(["Stop"], ""), "{}\n"));
});

describe("shape (c): the direct form records unless killed (R3, R4)", () => {
  for (const id of ["claude-code", "gemini-cli", "copilot-cli"]) {
    test(`${id}: records with ENABLED unset, nothing on stdout`, () =>
      recorded(run([id], undefined), ""));
    test(`${id}: ENABLED empty is unset`, () => recorded(run([id], ""), ""));
    test(`${id}: ENABLED=1 records`, () => recorded(run([id], "1"), ""));
    test(`${id}: ENABLED=0 is the kill-switch`, () => silent(run([id], "0"), ""));
  }
  test("antigravity-cli <event>: records and acknowledges", () =>
    recorded(run(["antigravity-cli", "Stop"], undefined), "{}\n"));
  test("antigravity-cli <event>: the kill-switch still acknowledges", () =>
    silent(run(["antigravity-cli", "Stop"], "off"), "{}\n"));
});

describe("a CLI identifier with the wrong number of arguments (R3)", () => {
  const cases: Array<[string[], string]> = [
    [["antigravity-cli"], "{}\n"],
    [["antigravity-cli", "Stop", "x"], "{}\n"],
    [["claude-code", "Stop"], ""],
    [["gemini-cli", ""], ""],
    [["copilot-cli", "a", "b"], ""],
  ];
  for (const [args, stdout] of cases) {
    test(`${JSON.stringify(args)}: one line naming the shapes, nothing sent, exit 0`, () => {
      const res = run(args, "1");
      assert.equal(res.status, 0);
      assert.equal(res.sent, 0);
      assert.equal(res.stderr, SHAPES_LINE);
      assert.equal(res.stdout, stdout);
    });
  }

  test("no process is spawned", () => {
    const log = path.join(realTmp("crewrig-mt-spy-"), "spy.jsonl");
    const res = run(
      ["claude-code", "Stop"],
      undefined,
      PROMPT,
      { SPAWN_SPY_LOG: log },
      {
        nodeArgs: ["--import", SPAWN_SPY],
      },
    );
    assert.equal(res.stderr, SHAPES_LINE);
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "", "");
  });
});

describe("the payload guard (R6, R7)", () => {
  const malformed = ["{bad", "", "[]", "42", "null", '"text"', "{} trailing", "\u0000"];
  for (const input of malformed) {
    test(`payload ${JSON.stringify(input)}: exit 0, nothing sent, nothing on stderr`, () => {
      silent(run(["claude-code"], undefined, input), "");
      silent(run(["Stop"], "1", input), "{}\n");
    });
  }

  test("a closed standard input behaves as an empty payload", () => {
    silent(run(["claude-code"], undefined, null), "");
    silent(run(["antigravity-cli", "Stop"], undefined, null), "{}\n");
  });

  test("PostToolUse: nothing sent, nothing on stderr, no process spawned", () => {
    const log = path.join(realTmp("crewrig-mt-spy-"), "spy.jsonl");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      prompt: "x",
    });
    const res = run(
      ["claude-code"],
      undefined,
      payload,
      { SPAWN_SPY_LOG: log },
      {
        nodeArgs: ["--import", SPAWN_SPY],
      },
    );
    silent(res, "");
    assert.equal(fs.existsSync(log), false, "nothing spawned");
    silent(run(["antigravity-cli", "PostToolUse"], undefined, "{}"), "{}\n");
  });

  test("disabled: no process spawned, the payload not needed", () => {
    const log = path.join(realTmp("crewrig-mt-spy-"), "spy.jsonl");
    silent(
      run([], undefined, "{bad", { SPAWN_SPY_LOG: log }, { nodeArgs: ["--import", SPAWN_SPY] }),
      "",
    );
    assert.equal(fs.existsSync(log), false);
  });
});

describe("the acknowledgement on every Antigravity path (R5)", () => {
  test("nothing to record", () => silent(run(["PostInvocation"], "1", "{}"), "{}\n"));

  test("a failed persistence", async () => {
    const port = await closedPort();
    const res = runHook(["antigravity-cli", "Stop"], "{}", { env: daemonEnv(home, port, token) });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "{}\n");
    assert.match(res.stderr, /^DAEMON_UNREACHABLE: /);
  });

  test("a missing token file", () => {
    const res = runHook(["antigravity-cli", "Stop"], "{}", {
      env: daemonEnv(home, stub.port, path.join(home, "absent")),
    });
    assert.equal(res.stdout, "{}\n");
    assert.match(res.stderr, /token file not found/);
  });
});

describe("the Git top level names the project (R9, issue #92)", () => {
  const payload = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    prompt: "p",
    session_id: "s1234567xyz",
  });

  test("from a subdirectory of a LINKED worktree: the worktree's own top level", () => {
    const fx = makeFixture({ ticket: "1329" });
    const res = run(["claude-code"], undefined, payload, {}, { cwd: fx.sub });
    assert.equal(res.status, 0, res.stderr);
    const room = drawerArgs(stub.requests().at(-1)!)["room"];
    assert.equal(room, `1329-${today()}-s1234567`);
    assert.equal(lines(res.stderr).length, 1);
  });

  test("outside any repository: the working directory's last component", () => {
    const dir = path.join(realTmp("crewrig-mt-cwd-"), "plain-dir");
    fs.mkdirSync(dir);
    run(
      ["claude-code"],
      undefined,
      payload,
      { GIT_CEILING_DIRECTORIES: path.dirname(dir) },
      { cwd: dir },
    );
    assert.equal(drawerArgs(stub.requests().at(-1)!)["room"], `plain-dir-${today()}-s1234567`);
  });

  test("a project directory in the payload wins over the Git top level", () => {
    const fx = makeFixture({ ticket: "77" });
    run(
      ["claude-code"],
      undefined,
      JSON.stringify({ prompt: "p", cwd: "/x/named" }),
      {},
      { cwd: fx.wt },
    );
    assert.match(String(drawerArgs(stub.requests().at(-1)!)["room"]), /^named-/);
  });

  test("Antigravity mode: workspacePaths[0], else the Git top level", () => {
    const fx = makeFixture({ ticket: "88" });
    run(
      ["Stop"],
      "1",
      JSON.stringify({ conversationId: "conv-1234567", workspacePaths: ["/w/agy"] }),
      {},
      {
        cwd: fx.wt,
      },
    );
    assert.equal(drawerArgs(stub.requests().at(-1)!)["room"], `agy-${today()}-conv-123`);
    run(["Stop"], "1", JSON.stringify({ conversationId: "c" }), {}, { cwd: fx.sub });
    assert.equal(drawerArgs(stub.requests().at(-1)!)["room"], `88-${today()}-c`);
  });
});
