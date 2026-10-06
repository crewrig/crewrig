// mempalace-transcript-windows.test.ts — the `windows-mempalace-transcript`
// job's hook proof (spec 0247 R31(a), R31(b); plan step 23).
//
// (a) runs on every platform, as the guard's (a) does, so the Linux
//     capability exercises it too: hooks/mempalace-transcript.ts against the
//     loopback stub daemon, asserting the request's room and content, the
//     bearer header, the standard-error lines of R15 and, in Antigravity mode,
//     the `{}` acknowledgement of R5 on standard output.
// (b) needs Windows and is skipped elsewhere with an explicit SKIP line: the
//     command line scripts/lib/hook-command.ts produces for each of the four
//     CLIs (R20) runs through the invocation row 37 records for it (`bash -c`
//     for Claude Code, `powershell.exe -NoProfile -NonInteractive -Command`
//     for Gemini CLI and Copilot CLI, `cmd /c` with row 37f's wrapping for
//     Antigravity CLI), and the hook is asserted to have run: the stub
//     received its record.
//
// The hook runs as a CLI runs it: `node <entry> <args>`, no Node.js flag, the
// payload on standard input, a fresh home directory and a token file named by
// MEMPALACE_DAEMON_TOKEN_FILE, so nothing of the host's MemPalace is read.
// The budgets of R31(c) are the job's own steps, not this suite's.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { GUARDED_PREFIX, hookCommandLine, type Cli } from "../lib/hook-command.ts";
import { resolveReal } from "../lib/paths.ts";
import { releasedPort } from "./lib/transcript-timing-fixtures.ts";
import { GIT_BASH, invocation, LEGS, runInvocation } from "./lib/windows-invocation.ts";
import { startStub, type RunningStub, type StubMode, type StubRequest } from "./lib/with-stub-daemon.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK_TS = path.join(REPO, "hooks", "mempalace-transcript.ts");
const WINDOWS = process.platform === "win32";
const SKIP_WINDOWS = WINDOWS ? false : "SKIP: Windows-only leg (runs on windows-latest)";

const TOKEN = "windows-proof-token";
const SESSION = "winproof-1234-abcd";
const SESSION8 = SESSION.slice(0, 8);

let tmp = "";
let home = "";
let project = "";
let tokenFile = "";
before(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "transcript-windows-")));
  home = path.join(tmp, "home");
  project = path.join(tmp, "proof-project");
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  tokenFile = path.join(tmp, "token");
  fs.writeFileSync(tokenFile, `  ${TOKEN}\n`);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The hook's environment: the stub's endpoint, the token file, an empty home, no inherited session. */
function hookEnv(endpoint: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(GEMINI|CLAUDE|COPILOT)_(SESSION_ID|PROJECT_DIR)$/.test(key) ||
      /^MEMPALACE_/.test(key) ||
      ["NODE_OPTIONS", "NODE_TEST_CONTEXT", "TOKEN_PATH_MOCK"].includes(key)
    ) {
      delete env[key];
    }
  }
  return { ...env, ...endpoint, MEMPALACE_DAEMON_TOKEN_FILE: tokenFile, HOME: home, USERPROFILE: home };
}

function runHook(args: string[], input: string, endpoint: Readonly<Record<string, string>>): Run {
  const res = spawnSync(process.execPath, [HOOK_TS, ...args], {
    input,
    encoding: "utf8",
    env: hookEnv(endpoint),
    cwd: project,
    windowsHide: true,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** A `UserPromptSubmit` payload of Claude Code's shape, its project in native separators. */
function promptPayload(prompt: string): string {
  return JSON.stringify({ session_id: SESSION, cwd: project, hook_event_name: "UserPromptSubmit", prompt });
}

/** An Antigravity `Stop` payload. */
function agyPayload(): string {
  return JSON.stringify({
    conversationId: SESSION,
    workspacePaths: [project],
    terminationReason: "completed",
  });
}

/** `<project>-<YYYY-MM-DD>-<first 8 of session>` (R9). */
const ROOM = new RegExp(`^proof-project-\\d{4}-\\d{2}-\\d{2}-${SESSION8}$`);

interface DrawerArgs {
  wing: string;
  room: string;
  content: string;
  added_by: string;
}

/** The one request the stub received, checked against R13 and returned as its drawer arguments. */
function oneDrawer(requests: StubRequest[]): DrawerArgs {
  assert.equal(requests.length, 1, JSON.stringify(requests));
  const [req] = requests;
  assert.ok(req !== undefined);
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/mcp");
  assert.match(req.contentType ?? "", /^application\/json/);
  assert.equal(req.authorization, `Bearer ${TOKEN}`);
  const body = req.body as { method: string; params: { name: string; arguments: DrawerArgs } };
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "mempalace_add_drawer");
  const args = body.params.arguments;
  assert.equal(args.wing, "transcripts");
  assert.equal(args.added_by, "transcript-hook");
  assert.match(args.room, ROOM);
  return args;
}

async function withStub<T>(mode: StubMode, fn: (stub: RunningStub) => T): Promise<T> {
  const stub = await startStub({ mode });
  try {
    return fn(stub);
  } finally {
    await stub.stop();
  }
}

describe("the entry against the stub daemon (R31(a))", () => {
  test("direct form: room, content, bearer header and the persisted line", async () => {
    await withStub("ok", (stub) => {
      const res = runHook(["claude-code"], promptPayload("windows proof prompt"), stub.env);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "");
      const drawer = oneDrawer(stub.requests());
      assert.equal(drawer.content, "[USER] windows proof prompt");
      assert.equal(
        res.stderr,
        `mempalace-transcript: persisted user-prompt to transcripts/${drawer.room}\n`,
      );
    });
  });

  test("Antigravity mode: `{}` on standard output and the Antigravity entry", async () => {
    await withStub("ok", (stub) => {
      const res = runHook(["antigravity-cli", "Stop"], agyPayload(), stub.env);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "{}\n");
      const drawer = oneDrawer(stub.requests());
      assert.equal(drawer.content, "[AGENT] Session turn completed (completed)");
      assert.match(res.stderr, /^mempalace-transcript: persisted agent-response to transcripts\//);
    });
  });

  test("an `error.message` answer: ADD_FAILED and the rc=3 line, exit 0", async () => {
    await withStub("rpc-error", (stub) => {
      const res = runHook(["claude-code"], promptPayload("refused"), stub.env);
      assert.equal(res.status, 0, res.stderr);
      oneDrawer(stub.requests());
      assert.equal(
        res.stderr,
        "ADD_FAILED: lease held\nmempalace-transcript: FAILED to persist user-prompt (rc=3): \n",
      );
    });
  });

  test("a `result.isError` answer: ADD_FAILED with the result text, rc=3", async () => {
    await withStub("is-error", (stub) => {
      const res = runHook(["gemini-cli"], promptPayload("refused"), stub.env);
      assert.equal(res.status, 0, res.stderr);
      oneDrawer(stub.requests());
      assert.equal(
        res.stderr,
        "ADD_FAILED: drawer refused\nmempalace-transcript: FAILED to persist user-prompt (rc=3): \n",
      );
    });
  });

  test("nothing listening: DAEMON_UNREACHABLE and the rc=4 line, `{}` still written", async () => {
    const port = await releasedPort();
    const res = runHook(["antigravity-cli", "Stop"], agyPayload(), {
      MEMPALACE_MCP_HOST: "127.0.0.1",
      MEMPALACE_MCP_PORT: String(port),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "{}\n");
    const lines = res.stderr.split("\n");
    assert.match(lines[0] ?? "", new RegExp(`^DAEMON_UNREACHABLE: 127\\.0\\.0\\.1:${port} — `));
    assert.equal(lines[1], "mempalace-transcript: FAILED to persist agent-response (rc=4): ");
    assert.equal(lines.length, 3, res.stderr);
  });
});

/** The arguments each CLI's registration passes the hook (R20). */
function hookArgs(cli: Cli): string[] {
  switch (cli) {
    case "claude":
      return ["claude-code"];
    case "gemini":
      return ["gemini-cli"];
    case "copilot":
      return ["copilot-cli"];
    case "antigravity":
      return ["antigravity-cli", "Stop"];
  }
}

describe(
  "each CLI's command line, through its interpreter (R31(b))",
  { skip: SKIP_WINDOWS },
  () => {
    before(() => {
      assert.ok(fs.existsSync(GIT_BASH), `${GIT_BASH} is missing: row 37's Git Bash path moved`);
    });

    for (const { cli, interpreter } of LEGS) {
      test(`${cli}: the module's command runs under ${interpreter} and the record reaches the stub`, async () => {
        const built = hookCommandLine({
          cli: cli as Cli,
          surface: "hooks",
          platform: "win32",
          scriptPath: resolveReal(HOOK_TS),
          args: hookArgs(cli as Cli),
        });
        assert.ok(built.ok, built.ok ? "" : built.refusal);
        if (cli === "antigravity") {
          assert.ok(built.command.startsWith(GUARDED_PREFIX), built.command);
        }
        await withStub("ok", (stub) => {
          const input = cli === "antigravity" ? agyPayload() : promptPayload(`proof from ${cli}`);
          const res = runInvocation(invocation(interpreter, built.command), {
            input,
            cwd: project,
            env: hookEnv(stub.env),
          });
          assert.equal(res.status, 0, `${res.stdout}${res.stderr}\n${built.command}`);
          const drawer = oneDrawer(stub.requests());
          if (cli === "antigravity") {
            assert.equal(res.stdout.trim(), "{}", built.command);
            assert.equal(drawer.content, "[AGENT] Session turn completed (completed)");
          } else {
            assert.equal(res.stdout, "", built.command);
            assert.equal(drawer.content, `[USER] proof from ${cli}`);
          }
          assert.match(res.stderr, /^mempalace-transcript: persisted /m, built.command);
        });
      });
    }
  },
);
