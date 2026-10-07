// mempalace-session-check.test.ts — the session-start check, black box
// (spec 0246 R1-R3, R5-R7, R9, R10, R16 as amended by delta-01; plan v4 steps
// 4 and 8, seat finding v4-F7).
//
// Every case runs scripts/mempalace-session-check.ts through `sh -c` on the
// hook command of plan v4 *Contracts*, as a CLI would, in a scratch HOME with a
// fixture launcher aimed at a fake endpoint on 127.0.0.1:0
// (session-check-harness.ts). The writer's own round trip through the INSTALLED
// copy is in session-check-hooks.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  CHECK_TS,
  type Cli,
  REGISTRATION_TS,
  SENTINEL,
  SETUP_SCRIPT,
  THROTTLE_TS,
  assertNoCliInvoked,
  emittedWarning,
  filesUnder,
  httpEntry,
  launcherPath,
  makeSandbox,
  mkfifo,
  plantToken,
  refusedPort,
  runCheck,
  startFakeServer,
  stdioEntry,
  writeConfig,
  writeFileDeep,
  writeLauncher,
  type FakeServer,
  type Sandbox,
} from "./lib/session-check-harness.ts";
import {
  ANTIGRAVITY_SESSION_CHECK,
  SESSION_CHECK_CHANNELS,
} from "../lib/mempalace-registration.ts";

/** The CLIs that print anything under the committed channel constants. */
const SPEAKING = (["claude", "gemini", "copilot", "antigravity"] as const).filter((cli) => {
  const ch = SESSION_CHECK_CHANNELS[cli];
  return ch.user !== null || ch.model !== null;
});

/** A `PreInvocation` payload; ignored by the CLIs that do not read stdin. */
function payloadFor(conversation: string, invocationNum = 1): string {
  const key = ANTIGRAVITY_SESSION_CHECK.key ?? "conversationId";
  return JSON.stringify({ invocationNum, initialNumSteps: 0, [key]: conversation });
}

/** R9's budget, with margin for a loaded CI runner on top of the 1.9 s deadline. */
const BUDGET_MS = 2000;

async function withServer<T>(
  mode: Parameters<typeof startFakeServer>[0],
  fn: (s: FakeServer) => Promise<T>,
): Promise<T> {
  const server = await startFakeServer(mode);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

type Fixture =
  | "ok"
  | "absent-no-file"
  | "absent-no-entry"
  | "stdio"
  | "wrong-endpoint"
  | "content"
  | "non-strict";

/** Puts the CLI's registration into the state the fixture names. */
function arrange(sb: Sandbox, cli: Cli, fixture: Fixture, expected: string): void {
  const entry = (e: unknown): unknown => ({
    mcpServers: { other: { command: "x" }, mempalace: e },
  });
  switch (fixture) {
    case "ok":
      writeConfig(sb, cli, entry(httpEntry(cli, expected)));
      break;
    case "absent-no-file":
      fs.rmSync(sb.config(cli), { force: true });
      break;
    case "absent-no-entry":
      writeConfig(sb, cli, { mcpServers: { other: { command: "x", env: { TOKEN: SENTINEL } } } });
      break;
    case "stdio":
      writeConfig(sb, cli, entry(stdioEntry()));
      break;
    case "wrong-endpoint":
      writeConfig(
        sb,
        cli,
        entry(httpEntry(cli, `http://u:${SENTINEL}@127.0.0.1:41000/mcp?token=${SENTINEL}`)),
      );
      break;
    case "content":
      writeConfig(sb, cli, entry({ headers: { Authorization: `Bearer ${SENTINEL}` } }));
      break;
    case "non-strict":
      writeConfig(sb, cli, `﻿${JSON.stringify(entry(httpEntry(cli, expected)))}`);
      break;
  }
}

/** What each fixture's warning must say (R5, delta-01 R5). */
const MARKS: Record<Exclude<Fixture, "ok">, (cli: Cli) => string[]> = {
  "absent-no-file": (cli) => [SETUP_SCRIPT[cli]],
  "absent-no-entry": () => ["task mempalace:switch-http"],
  stdio: () => ["task mempalace:switch-http", "refused"],
  "wrong-endpoint": () => [
    "wrong-endpoint",
    "http://127.0.0.1:41000/mcp",
    "task mempalace:switch-http",
  ],
  content: () => ["task mempalace:repair"],
  "non-strict": () => ["not a single strict JSON document", "task mempalace:switch-http"],
};

/** The output carries the warning on exactly the channels SESSION_CHECK_CHANNELS names (R7). */
function assertChannels(cli: Cli, stdout: string, warning: string): void {
  const spec = SESSION_CHECK_CHANNELS[cli];
  const out = JSON.parse(stdout) as Record<string, unknown>;
  const expected: Record<string, unknown> = {};
  for (const field of [spec.user, spec.model]) {
    if (field === null) continue;
    const [head, leaf] = field.split(".");
    if (leaf === undefined) expected[head as string] = warning;
    else if ((head as string).endsWith("[]")) {
      // `name[].leaf`: an array holding one object (Antigravity's injectSteps).
      expected[(head as string).slice(0, -2)] = [{ [leaf]: warning }];
    } else {
      const inner = (expected[head as string] as Record<string, unknown> | undefined) ?? {};
      inner[leaf] = warning;
      if (head === "hookSpecificOutput") inner.hookEventName = spec.event;
      expected[head as string] = inner;
    }
  }
  assert.deepEqual(out, expected);
  assert.ok(stdout.endsWith("}\n"), "one JSON object and a newline");
}

describe("per-CLI output for each class (R3, R5, R7)", () => {
  for (const cli of SPEAKING) {
    test(`${cli}: ok is silent; every other class warns once, on its channels, with its repair`, async () => {
      await withServer("auth-refusal", async (server) => {
        const sb = makeSandbox();
        writeLauncher(sb, server.port);
        const expected = server.url;

        for (const fixture of Object.keys(MARKS).concat("ok") as Fixture[]) {
          arrange(sb, cli, fixture, expected);

          // A fresh conversation each time, so Antigravity's throttle lets every run through.
          const r = await runCheck(sb, cli, { input: payloadFor(`${cli}-${fixture}`) });

          assert.equal(r.status, 0);
          assert.equal(r.stderr, "", `${fixture}: ${r.stderr}`);
          if (fixture === "ok") {
            assert.equal(r.stdout, "", "ok must be silent (R6)");
            continue;
          }
          const w = emittedWarning(r.stdout);
          assert.ok(w !== null, `${fixture}: no warning`);
          assertChannels(cli, r.stdout, w);
          assert.ok(w.includes(cli), `${fixture}: CLI not named: ${w}`);
          for (const mark of MARKS[fixture](cli))
            assert.ok(w.includes(mark), `${fixture}: "${mark}" missing: ${w}`);
          assert.ok(Buffer.byteLength(w) <= 600);
          if (fixture === "absent-no-file") assert.ok(!w.includes("switch-http"), w);
        }
        assert.ok(server.requests.length > 0);
        assertNoCliInvoked(sb);
      });
    });
  }

  test("antigravity: the warning arrives through injectSteps on a conversation's first invocation only", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      arrange(sb, "antigravity", "absent-no-entry", server.url);

      const first = await runCheck(sb, "antigravity", { input: payloadFor("conv-1", 1) });
      const later = [];
      for (let n = 2; n <= 4; n++) {
        later.push(await runCheck(sb, "antigravity", { input: payloadFor("conv-1", n) }));
      }

      assert.equal(first.status, 0);
      const parsed = JSON.parse(first.stdout) as {
        injectSteps?: Array<{ ephemeralMessage?: unknown }>;
      };
      const w = parsed.injectSteps?.[0]?.ephemeralMessage;
      assert.equal(typeof w, "string", first.stdout);
      assert.deepEqual(parsed, { injectSteps: [{ ephemeralMessage: w }] });
      assert.ok(
        (w as string).includes("antigravity") &&
          (w as string).includes("task mempalace:switch-http"),
        String(w),
      );
      for (const r of later) assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
      assert.equal(server.requests.length, 1, "a suppressed invocation must not probe");
      assertNoCliInvoked(sb);
    });
  });
});

describe("the probe goes to a loopback host only (R10; security review #1474)", () => {
  // `127.1`, `127.000.000.001`, `127.0.0.01` and `0x7f.0.0.1` all resolve to 127.0.0.1 through
  // getaddrinfo (measured), so a
  // check that probed them would reach the fake server listening there.
  for (const host of [
    "127.999.0.1",
    "127.0.0.256",
    "example.invalid",
    "127.1",
    "127.000.000.001",
    "127.0.0.01",
    "0x7f.0.0.1",
  ]) {
    test(`launcher host ${host}: no request, exit 0, the not-serving warning`, async () => {
      await withServer("auth-refusal", async (server) => {
        const sb = makeSandbox();
        writeLauncher(sb, server.port, host);
        arrange(sb, "claude", "absent-no-entry", `http://${host}:${server.port}/mcp`);

        const r = await runCheck(sb, "claude");

        assert.equal(r.status, 0);
        assert.equal(server.requests.length, 0, `the check probed ${host}`);
        const w = emittedWarning(r.stdout) ?? "";
        assert.ok(w.includes("task mempalace:status") && w.includes("claude"), w);
        assert.ok(r.ms < BUDGET_MS, `${Math.round(r.ms)} ms`);
        assertNoCliInvoked(sb);
      });
    });
  }

  test("launcher host localhost is loopback: the probe is sent", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port, "localhost");
      arrange(sb, "claude", "absent-no-entry", `http://localhost:${server.port}/mcp`);

      const r = await runCheck(sb, "claude");

      assert.equal(server.requests.length, 1);
      assert.ok((emittedWarning(r.stdout) ?? "").includes("task mempalace:switch-http"), r.stdout);
    });
  });
});

describe("silence (R1, R6)", () => {
  test("no launcher installed: silent, and no request even with MEMPALACE_MCP_PORT aimed at a live server", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      arrange(sb, "claude", "absent-no-entry", server.url);
      const env = { MEMPALACE_MCP_PORT: String(server.port), MEMPALACE_MCP_HOST: "127.0.0.1" };

      const r = await runCheck(sb, "claude", { env });

      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
      assert.equal(server.requests.length, 0);
      assertNoCliInvoked(sb);
    });
  });

  test("a launcher with unsubstituted placeholders counts as no daemon: silent, no request", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeFileDeep(launcherPath(sb), 'MCP_HOST="__MCP_HOST__"\nMCP_PORT="__MCP_PORT__"\n');
      arrange(sb, "claude", "absent-no-entry", server.url);

      const r = await runCheck(sb, "claude", { env: { MEMPALACE_MCP_PORT: String(server.port) } });

      assert.deepEqual([r.status, r.stdout], [0, ""]);
      assert.equal(server.requests.length, 0);
    });
  });

  test("an unsupported platform: silent, no request", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      arrange(sb, "claude", "absent-no-entry", server.url);

      const r = await runCheck(sb, "claude", { extraArgs: " --platform win32" });

      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
      assert.equal(server.requests.length, 0);
      assertNoCliInvoked(sb);
    });
  });
});

describe("the serving predicate (R2, R5, R6)", () => {
  test("a 2xx JSON-RPC answer counts as serving; the probe carries no credential", async () => {
    await withServer("mcp-result", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      arrange(sb, "claude", "absent-no-entry", server.url);

      const r = await runCheck(sb, "claude");

      assert.ok((emittedWarning(r.stdout) ?? "").includes("task mempalace:switch-http"), r.stdout);
      assert.equal(server.requests.length, 1);
      const [probe] = server.requests;
      assert.equal(probe?.method, "POST");
      assert.equal(probe?.url, "/mcp");
      assert.equal(probe?.headers.authorization, undefined);
    });
  });

  for (const mode of ["healthz-only", "refused"] as const) {
    test(`${mode}: not serving; stdio stays silent, an absent registration names task mempalace:status`, async () => {
      const server = mode === "refused" ? null : await startFakeServer(mode);
      try {
        const port = server?.port ?? (await refusedPort());
        const sb = makeSandbox();
        writeLauncher(sb, port);

        arrange(sb, "copilot", "stdio", `http://127.0.0.1:${port}/mcp`);
        const quiet = await runCheck(sb, "copilot");
        arrange(sb, "copilot", "absent-no-entry", `http://127.0.0.1:${port}/mcp`);
        const loud = await runCheck(sb, "copilot");

        assert.deepEqual([quiet.status, quiet.stdout], [0, ""]);
        const w = emittedWarning(loud.stdout) ?? "";
        assert.ok(w.includes("task mempalace:status") && w.includes("copilot"), w);
        assert.ok(!w.includes("switch-http"), w);
        assertNoCliInvoked(sb);
      } finally {
        await server?.close();
      }
    });
  }

  test("an endpoint that accepts and never answers: exit 0 within 2 s, one warning naming task mempalace:status", async () => {
    await withServer("hang", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      arrange(sb, "claude", "ok", server.url);

      const r = await runCheck(sb, "claude");

      assert.equal(r.status, 0);
      assert.ok(r.ms < BUDGET_MS, `${Math.round(r.ms)} ms`);
      assert.ok((emittedWarning(r.stdout) ?? "").includes("task mempalace:status"), r.stdout);
      assertNoCliInvoked(sb);
    });
  });
});

describe("never blocks, never fails (R9)", () => {
  test("a deleted check file, a missing node, or a node that fails: exit 0, no output", async () => {
    const sb = makeSandbox();
    const brokenNode = path.join(sb.root, "old-node");
    fs.writeFileSync(brokenNode, "#!/bin/sh\necho 'SyntaxError: Unexpected token' >&2\nexit 1\n", {
      mode: 0o755,
    });
    const noNodePath = [sb.stubBin, "/usr/bin", "/bin"].join(path.delimiter);
    const cases: Array<[string, Parameters<typeof runCheck>[2]]> = [
      [
        "deleted check file",
        { checkFile: path.join(sb.root, "gone", "mempalace-session-check.ts") },
      ],
      [
        "no node anywhere",
        { nodeBin: path.join(sb.root, "no-such-node"), env: { PATH: noNodePath } },
      ],
      ["a node that fails", { nodeBin: brokenNode, env: { PATH: noNodePath } }],
    ];
    for (const [name, opts] of cases) {
      const r = await runCheck(sb, "claude", opts);
      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], name);
    }
    assertNoCliInvoked(sb);
  });

  test("the launcher as a FIFO: exit 0 within 2 s, silent", async () => {
    const sb = makeSandbox();
    mkfifo(launcherPath(sb));

    const r = await runCheck(sb, "claude");

    assert.deepEqual([r.status, r.stdout], [0, ""]);
    assert.ok(r.ms < BUDGET_MS, `${Math.round(r.ms)} ms`);
  });

  for (const kind of ["FIFO", "directory"] as const) {
    test(`the configuration as a ${kind}: exit 0 within 2 s, unrecognised with the not-strict warning (v4-F7)`, async () => {
      await withServer("auth-refusal", async (server) => {
        const sb = makeSandbox();
        writeLauncher(sb, server.port);
        if (kind === "FIFO") mkfifo(sb.config("gemini"));
        else fs.mkdirSync(sb.config("gemini"), { recursive: true });

        const r = await runCheck(sb, "gemini");

        assert.equal(r.status, 0);
        assert.ok(r.ms < BUDGET_MS, `${Math.round(r.ms)} ms`);
        const w = emittedWarning(r.stdout) ?? "";
        assert.ok(
          w.includes("not a single strict JSON document") && w.includes("~/.gemini/settings.json"),
          w,
        );
        assert.ok(!w.includes("mempalace:repair") && !w.includes("setup-gemini"), w);
        assertNoCliInvoked(sb);
      });
    });
  }
});

describe("no secret, no side effect (R10)", () => {
  test("a sentinel in the token file and every fixture never reaches any output, request or written file", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      plantToken(sb);
      const leaks: string[] = [];
      for (const cli of ["claude", "gemini", "copilot", "antigravity"] as const) {
        for (const fixture of [
          "ok",
          "absent-no-file",
          "absent-no-entry",
          "stdio",
          "wrong-endpoint",
          "content",
          "non-strict",
        ] as Fixture[]) {
          arrange(sb, cli, fixture, server.url);
          const before = new Map(filesUnder(sb.home).map((f) => [f, fs.statSync(f).mtimeMs]));

          const r = await runCheck(sb, cli, {
            input: `{"invocationNum":1,"conversationId":"${cli}-${fixture}"}`,
          });

          if (r.stdout.includes(SENTINEL) || r.stderr.includes(SENTINEL))
            leaks.push(`${cli} ${fixture}: output`);
          for (const f of filesUnder(sb.home)) {
            const written = before.get(f) !== fs.statSync(f).mtimeMs;
            if (written && fs.readFileSync(f, "utf8").includes(SENTINEL))
              leaks.push(`${cli} ${fixture}: wrote ${f}`);
          }
        }
      }
      for (const q of server.requests) {
        if (JSON.stringify(q).includes(SENTINEL)) leaks.push(`request ${q.method} ${q.url}`);
        assert.equal(q.headers.authorization, undefined);
        assert.equal(q.url, "/mcp");
      }
      assert.deepEqual(leaks, []);
      assert.ok(server.requests.length > 0);
      assertNoCliInvoked(sb);
    });
  });

  test("the installed sources start no child process: no child_process import (R4, R10)", () => {
    for (const file of [CHECK_TS, REGISTRATION_TS, THROTTLE_TS]) {
      const src = fs.readFileSync(file, "utf8");
      assert.ok(!/child_process/.test(src), `${path.basename(file)} references child_process`);
      assert.ok(
        !/\bfrom\s+["'](?!node:|\.\/)/.test(src),
        `${path.basename(file)} imports outside the standard library and its own tree`,
      );
    }
  });

  test("the check modifies no assistant configuration", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      for (const fixture of ["stdio", "wrong-endpoint", "content", "non-strict"] as Fixture[]) {
        arrange(sb, "copilot", fixture, server.url);
        const before = fs.readFileSync(sb.config("copilot"));
        const mtime = fs.statSync(sb.config("copilot")).mtimeMs;

        await runCheck(sb, "copilot");

        assert.deepEqual(fs.readFileSync(sb.config("copilot")), before, fixture);
        assert.equal(fs.statSync(sb.config("copilot")).mtimeMs, mtime, fixture);
      }
    });
  });
});

// --- delta-02: Gemini comments, non-object mcpServers, url/serverUrl ---------------

/** A correct Gemini HTTP entry, as JSON text. */
const geminiEntry = (url: string): string => JSON.stringify(httpEntry("gemini", url));

/** Delta-02 R5: the Gemini setup text for a commented file that is not ok. */
function assertGeminiSetupWarning(w: string | null, label: string): void {
  assert.ok(w !== null, `${label}: no warning`);
  assert.ok(
    w.includes("gemini") && w.includes("scripts/setup-gemini-interactive.sh"),
    `${label}: ${w}`,
  );
  assert.match(w, /comment/i, `${label}: does not say the setup drops the comments`);
  assert.match(w, /backup/i, `${label}: does not mention the timestamped backup`);
  assert.ok(
    !w.includes("switch-http") && !w.includes("mempalace:repair"),
    `${label}: names a jq-based task: ${w}`,
  );
  assert.ok(Buffer.byteLength(w) <= 600);
}

describe("Gemini settings with comments (delta-02 R4, R5)", () => {
  test("a working commented configuration, with // inside a string, starts silently", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      writeConfig(
        sb,
        "gemini",
        `// team proxy\n{\n  "$schema": "https://example.invalid//schema.json",\n` +
          `  /* the shared daemon */\n  "mcpServers": { "mempalace": ${geminiEntry(server.url)} }\n}\n`,
      );

      const r = await runCheck(sb, "gemini");

      assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
      assert.equal(server.requests.length, 1);
      assertNoCliInvoked(sb);
    });
  });

  test("a commented configuration without the entry, or with a stdio entry, points at the Gemini setup", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      const cases: Array<[string, string]> = [
        ["absent", `// hand edited\n{ "mcpServers": { /* nothing yet */ } }\n`],
        ["stdio", `{ "mcpServers": { "mempalace": { "command": "python3" } } } // local\n`],
        [
          "wrong endpoint",
          `/* pinned */ { "mcpServers": { "mempalace": ${geminiEntry("http://127.0.0.1:41000/mcp")} } }`,
        ],
      ];
      for (const [label, text] of cases) {
        writeConfig(sb, "gemini", text);

        const r = await runCheck(sb, "gemini");

        assert.equal(r.status, 0);
        assertGeminiSetupWarning(emittedWarning(r.stdout), label);
      }
      assertNoCliInvoked(sb);
    });
  });

  test("comment-like sequences inside string literals are left untouched", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      // A stripper that read into strings would delete the entry between "/*" and "*/",
      // or cut the line at "//": either way the registration would no longer read ok.
      writeConfig(
        sb,
        "gemini",
        `{"a":"x /* not a comment","mcpServers":{"mempalace":${geminiEntry(server.url)}},"b":"*/ y // z","c":"\\" // still a string"}`,
      );

      const r = await runCheck(sb, "gemini");

      assert.deepEqual([r.status, r.stdout], [0, ""], r.stdout);
    });
  });

  test("a block comment that is never closed runs to the end of the file", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);

      writeConfig(
        sb,
        "gemini",
        `{"mcpServers":{"mempalace":${geminiEntry(server.url)}}} /* unclosed`,
      );
      const tail = await runCheck(sb, "gemini");
      writeConfig(sb, "gemini", `{"mcpServers":{"mempalace":${geminiEntry(server.url)}} /* }`);
      const swallowed = await runCheck(sb, "gemini");

      assert.deepEqual(
        [tail.status, tail.stdout],
        [0, ""],
        "comment to EOF after a complete document: ok",
      );
      const w = emittedWarning(swallowed.stdout) ?? "";
      assert.ok(w.includes("not a single strict JSON document"), `closing brace swallowed: ${w}`);
    });
  });

  test("a trailing comma is not strict, on Gemini as elsewhere", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      writeConfig(sb, "gemini", `{"mcpServers":{"mempalace":${geminiEntry(server.url)}},}`);

      const r = await runCheck(sb, "gemini");

      const w = emittedWarning(r.stdout) ?? "";
      assert.ok(
        w.includes("not a single strict JSON document") && w.includes("~/.gemini/settings.json"),
        w,
      );
      assert.ok(!w.includes("mempalace:repair"), w);
    });
  });

  test("comments are stripped for Gemini only: the same commented file is not strict on Copilot", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      writeConfig(
        sb,
        "copilot",
        `// note\n{"mcpServers":{"mempalace":${JSON.stringify(httpEntry("copilot", server.url))}}}`,
      );

      const r = await runCheck(sb, "copilot");

      assert.ok(
        (emittedWarning(r.stdout) ?? "").includes("not a single strict JSON document"),
        r.stdout,
      );
    });
  });
});

describe("a non-object mcpServers (delta-02 R3, R4, R5)", () => {
  for (const value of ["[]", '"s"']) {
    test(`mcpServers ${value}: unrecognised, rewrite advice, then switch-http, never repair`, async () => {
      await withServer("auth-refusal", async (server) => {
        const sb = makeSandbox();
        writeLauncher(sb, server.port);
        writeConfig(sb, "copilot", `{"mcpServers": ${value}}`);

        const r = await runCheck(sb, "copilot");

        const w = emittedWarning(r.stdout) ?? "";
        assert.ok(w.includes("copilot") && w.includes("~/.copilot/mcp-config.json"), w);
        assert.ok(w.includes("not a single strict JSON document"), w);
        // R5: the rewrite advice first, then switch-http as the step after the rewrite.
        const advice = w.indexOf('by making "mcpServers" an object');
        assert.ok(advice >= 0, `no advice to make mcpServers an object: ${w}`);
        assert.ok(
          advice < w.indexOf("task mempalace:switch-http"),
          `switch-http missing or first: ${w}`,
        );
        assert.ok(!w.includes("mempalace:repair"), w);
        assertNoCliInvoked(sb);
      });
    });
  }
});

describe("an entry carrying both url and serverUrl compares .url // .serverUrl (delta-02 R3)", () => {
  test("url correct, serverUrl wrong: ok; url wrong, serverUrl correct: wrong-endpoint naming the url", async () => {
    await withServer("auth-refusal", async (server) => {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      const other = "http://127.0.0.1:41000/mcp";

      writeConfig(sb, "claude", {
        mcpServers: { mempalace: { type: "http", url: server.url, serverUrl: other } },
      });
      const good = await runCheck(sb, "claude");
      writeConfig(sb, "claude", {
        mcpServers: { mempalace: { type: "http", url: other, serverUrl: server.url } },
      });
      const bad = await runCheck(sb, "claude");

      assert.deepEqual([good.status, good.stdout], [0, ""]);
      const w = emittedWarning(bad.stdout) ?? "";
      assert.ok(w.includes("wrong-endpoint") && w.includes(other), w);
      assertNoCliInvoked(sb);
    });
  });
});
