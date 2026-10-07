// mempalace-transcript-daemon.test.ts — the one request the transcript hook
// sends and how its outcome is logged (spec 0247 R13, R15, R17; plan
// verification duty 4; PR A seat finding i1-F1).
//
// Black-box runs against the loopback stub daemon in each of its modes, the
// `hang` mode bounded at 5 s (replacing the source-text case of issue #90 that
// spec 0247 R32 removed from scripts/tests/test-mempalace-transcript-hook.sh),
// a closed port, QUIET gating, diagnostics on stderr with stdout empty
// (replacing the removed case of issue #93), and a spawn-spy proof that the
// only process ever started is `git rev-parse --show-toplevel`, with neither
// the token nor the content on its argument list. A few answers no stub mode
// gives (a 3xx, an empty 2xx, an oversized body) are put to `addDrawer`
// in-process against a throwaway server.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { addDrawer, classifyAnswer, requestBody } from "../lib/mempalace-transcript/daemon.ts";
import type { SpyRecord } from "./lib/spawn-spy.ts";
import {
  closedPort,
  daemonEnv,
  lines,
  makeHome,
  runHook,
  SPAWN_SPY,
  startStub,
  today,
  writeToken,
  type Stub,
  type StubMode,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, realTmp, type Result } from "./lib/worktree-fixtures.ts";

const TOKEN = "s3cr3t-token-value";
const PROMPT_TEXT = "a prompt that must stay off every argv";
const PAYLOAD = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  prompt: PROMPT_TEXT,
  session_id: "sess-12345678",
  cwd: "/w/proj",
});
const ROOM = `proj-${today()}-sess-123`;
const FAILED = (rc: number): string =>
  `mempalace-transcript: FAILED to persist user-prompt (rc=${rc}): `;

let home: string;
let token: string;
const stubs = new Map<StubMode, Stub>();

before(async () => {
  home = makeHome();
  token = writeToken(path.join(home, "t"), `${TOKEN}\n`);
  for (const mode of ["ok", "rpc-error", "is-error", "http-500-html", "hang"] as const) {
    stubs.set(mode, await startStub(mode));
  }
});
after(async () => {
  for (const stub of stubs.values()) await stub.stop();
  cleanupAll();
});

function hook(
  port: number,
  extra: Record<string, string> = {},
  args = ["claude-code"],
  payload = PAYLOAD,
): Result {
  return runHook(args, payload, { env: daemonEnv(home, port, token, extra), timeoutMs: 30_000 });
}

describe("the request (R13)", () => {
  test("one POST /mcp, JSON content type, bearer header, the add_drawer call with id 1", () => {
    const stub = stubs.get("ok")!;
    const before = stub.requests().length;
    const res = hook(stub.port);
    assert.equal(res.status, 0, res.stderr);
    const sent = stub.requests().slice(before);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
      method: "POST",
      url: "/mcp",
      contentType: "application/json",
      authorization: `Bearer ${TOKEN}`,
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "mempalace_add_drawer",
          arguments: {
            wing: "transcripts",
            room: ROOM,
            content: `[USER] ${PROMPT_TEXT}`,
            added_by: "transcript-hook",
          },
        },
      },
    });
  });

  test("requestBody is that object, serialised", () => {
    assert.deepEqual(JSON.parse(requestBody("r", "c")), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "mempalace_add_drawer",
        arguments: { wing: "transcripts", room: "r", content: "c", added_by: "transcript-hook" },
      },
    });
  });
});

describe("the outcome against each stub mode (R15, i1-F1)", () => {
  test("ok: the persisted line alone on stderr, stdout empty", () => {
    const res = hook(stubs.get("ok")!.port);
    assert.equal(res.stdout, "");
    assert.equal(
      res.stderr,
      `mempalace-transcript: persisted user-prompt to transcripts/${ROOM}\n`,
    );
  });

  test("ok with QUIET=1: nothing at all; any other QUIET value logs", () => {
    const port = stubs.get("ok")!.port;
    assert.equal(hook(port, { MEMPALACE_TRANSCRIPT_QUIET: "1" }).stderr, "");
    for (const value of ["0", "true", ""]) {
      assert.match(
        hook(port, { MEMPALACE_TRANSCRIPT_QUIET: value }).stderr,
        /persisted user-prompt/,
      );
    }
  });

  const failures: Array<[StubMode, (port: number) => string, number]> = [
    ["rpc-error", () => "ADD_FAILED: lease held", 3],
    ["is-error", () => "ADD_FAILED: drawer refused", 3],
    ["http-500-html", (port) => `DAEMON_UNREACHABLE: 127.0.0.1:${port} — HTTP 500`, 4],
  ];
  for (const [mode, diagnostic, rc] of failures) {
    test(`${mode}: the diagnostic then FAILED (rc=${rc}), QUIET or not, stdout empty, exit 0`, () => {
      const port = stubs.get(mode)!.port;
      for (const quiet of [{}, { MEMPALACE_TRANSCRIPT_QUIET: "1" }] as Array<
        Record<string, string>
      >) {
        const res = hook(port, quiet);
        assert.equal(res.status, 0);
        assert.equal(res.stdout, "");
        assert.equal(res.stderr, `${diagnostic(port)}\n${FAILED(rc)}\n`);
      }
    });
  }

  test("hang: bounded at 5 s, DAEMON_UNREACHABLE rc=4, exit 0 (issue #90)", () => {
    const port = stubs.get("hang")!.port;
    const start = performance.now();
    const res = hook(port, {}, ["antigravity-cli", "Stop"], JSON.stringify({ prompt: "p" }));
    const elapsed = performance.now() - start;
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "{}\n");
    assert.deepEqual(lines(res.stderr), [
      `DAEMON_UNREACHABLE: 127.0.0.1:${port} — no answer within 5 s`,
      FAILED(4),
    ]);
    assert.ok(elapsed >= 4900 && elapsed < 9000, `${elapsed.toFixed(0)} ms`);
  });

  test("a closed port: DAEMON_UNREACHABLE naming the refusal, rc=4", async () => {
    const port = await closedPort();
    const res = hook(port);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "");
    assert.deepEqual(lines(res.stderr), [
      `DAEMON_UNREACHABLE: 127.0.0.1:${port} — ECONNREFUSED`,
      FAILED(4),
    ]);
  });

  test("a port that cannot be dialled: DAEMON_UNREACHABLE rc=4, exit 0", () => {
    const res = runHook(["claude-code"], PAYLOAD, {
      env: daemonEnv(home, 0, token, { MEMPALACE_MCP_PORT: "not-a-port" }),
    });
    assert.equal(res.status, 0);
    assert.match(lines(res.stderr)[0] ?? "", /^DAEMON_UNREACHABLE: 127\.0\.0\.1:not-a-port — /);
    assert.equal(lines(res.stderr)[1], FAILED(4));
  });

  test("Antigravity mode: the acknowledgement alone on stdout in every mode", () => {
    for (const mode of ["ok", "rpc-error", "is-error", "http-500-html"] as const) {
      const on = hook(
        stubs.get(mode)!.port,
        { MEMPALACE_TRANSCRIPT_ENABLED: "1" },
        ["Stop"],
        JSON.stringify({ prompt: "p" }),
      );
      assert.equal(on.stdout, "{}\n", mode);
      assert.equal(on.status, 0);
      assert.match(on.stderr, mode === "ok" ? /persisted/ : /FAILED to persist/);
    }
  });
});

describe("answers no stub mode gives (R15), in-process", () => {
  let server: http.Server;
  let reply: (res: http.ServerResponse) => void = () => {};
  const saved = {
    host: process.env["MEMPALACE_MCP_HOST"],
    port: process.env["MEMPALACE_MCP_PORT"],
  };

  before(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => reply(res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env["MEMPALACE_MCP_HOST"] = "127.0.0.1";
    process.env["MEMPALACE_MCP_PORT"] = String((server.address() as AddressInfo).port);
  });
  after(() => {
    server.closeAllConnections();
    server.close();
    for (const [key, value] of [
      ["MEMPALACE_MCP_HOST", saved.host],
      ["MEMPALACE_MCP_PORT", saved.port],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function outcome(answer: (res: http.ServerResponse) => void): Promise<unknown> {
    reply = answer;
    return addDrawer({ room: "r", content: "c", token: "t" });
  }
  const where = (): string => `127.0.0.1:${process.env["MEMPALACE_MCP_PORT"] ?? ""}`;

  test("a redirect is a non-2xx status", async () => {
    assert.deepEqual(await outcome((res) => res.writeHead(302, { Location: "/x" }).end()), {
      ok: false,
      status: 4,
      diagnostic: `DAEMON_UNREACHABLE: ${where()} — HTTP 302`,
    });
  });

  test("an empty 2xx body is not JSON", async () => {
    assert.deepEqual(await outcome((res) => res.writeHead(204).end()), {
      ok: false,
      status: 4,
      diagnostic: `DAEMON_UNREACHABLE: ${where()} — response is not JSON`,
    });
  });

  test("a body past 1 MiB is not read further", async () => {
    const result = (await outcome((res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(`"${"x".repeat(2 * 1024 * 1024)}"`);
    })) as { status: number; diagnostic: string };
    assert.equal(result.status, 4);
    assert.match(result.diagnostic, /response larger than 1048576 bytes$/);
  });

  test("any JSON with no error.message and no result.isError true is a success", async () => {
    assert.deepEqual(await outcome((res) => res.writeHead(200).end("{}")), { ok: true });
    assert.deepEqual(await outcome((res) => res.writeHead(201).end('{"error":{"message":""}}')), {
      ok: true,
    });
  });
});

describe("classifyAnswer (R15)", () => {
  test("error.message wins over result.isError; a number is rendered", () => {
    assert.deepEqual(
      classifyAnswer("h:1", 200, '{"error":{"message":42},"result":{"isError":true}}'),
      {
        ok: false,
        status: 3,
        diagnostic: "ADD_FAILED: 42",
      },
    );
  });

  test("result.isError true with no text gives an empty message", () => {
    assert.deepEqual(classifyAnswer("h:1", 200, '{"result":{"isError":true}}'), {
      ok: false,
      status: 3,
      diagnostic: "ADD_FAILED: ",
    });
  });

  test("result.isError other than true is a success", () => {
    for (const value of ["false", "null", "1", '"yes"']) {
      assert.deepEqual(
        classifyAnswer("h:1", 200, `{"result":{"isError":${value}}}`),
        { ok: true },
        value,
      );
    }
  });
});

describe("no process but `git rev-parse --show-toplevel`; no token or content on any argv (R13, R17, duty 4)", () => {
  function spied(payload: string): SpyRecord[] {
    const log = path.join(realTmp("crewrig-mt-spy-"), "spy.jsonl");
    const cwd = realTmp("crewrig-mt-cwd-");
    const res = runHook(["claude-code"], payload, {
      env: daemonEnv(home, stubs.get("ok")!.port, token, { SPAWN_SPY_LOG: log }),
      nodeArgs: ["--import", SPAWN_SPY],
      cwd,
    });
    assert.equal(res.status, 0, res.stderr);
    // Exactly the success line: a warning from the preloaded spy would show here (i1-F3).
    assert.match(res.stderr, /^mempalace-transcript: persisted [^\n]*\n$/);
    if (!fs.existsSync(log)) return [];
    return fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SpyRecord);
  }

  test("a persisted run with no project directory named: one spawnSync of git", () => {
    const records = spied(JSON.stringify({ prompt: PROMPT_TEXT, session_id: "s" }));
    assert.equal(records.length, 1, JSON.stringify(records));
    assert.equal(records[0]!.fn, "spawnSync");
    assert.match(path.basename(records[0]!.file), /^git(\.exe)?$/);
    assert.deepEqual(records[0]!.args, ["rev-parse", "--show-toplevel"]);
    for (const record of records) {
      const argv = [record.file, ...record.args].join("\u0000");
      assert.ok(!argv.includes(TOKEN) && !argv.includes(PROMPT_TEXT));
    }
  });

  test("a project directory named in the payload: nothing spawned at all", () => {
    assert.deepEqual(spied(PAYLOAD), []);
  });
});
