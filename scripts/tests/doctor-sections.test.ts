// doctor-sections.test.ts — black-box oracle of `doctor-mempalace` (spec 0252
// requirements 20, 22, 24; plan v3 steps 33 and 35). The TypeScript entry and its bash
// shim are run as processes against an isolated HOME: the three labelled sections, the
// verdict, an exit status that does not depend on the entry, and the absence of the
// fourth section on POSIX. The Windows fourth section (*4. Background service
// mechanism*) is driven in process through the single os-inspect seam and a stand-in
// `schtasks` on POSIX (registered, running and absent states, the prohibiting policy,
// UNDETERMINED, snapshot failure; the exit status never changes), and on win32 through
// the real entry against the real Task Scheduler (no task is created).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { doctorMempalace } from "../lib/service/doctor-run.ts";
import { POLICY_SCRIPT, setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import type { InspectRunner } from "../lib/service/os-inspect.ts";
import { installFakeSchtasks } from "./lib/fake-schtasks.ts";
import type { FakeSchtasks } from "./lib/fake-schtasks.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const posix = process.platform !== "win32";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-doctor-sections-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const SECTIONS = [
  "1. What a session actually launches",
  "2. What resolves on your PATH",
  "3. What a fresh setup would select",
  "Verdict",
];
const FOURTH = "4. Background service mechanism";
const MCP_TASK = "\\CrewRig\\mempalace-mcp-server";
const CHROMA_TASK = "\\CrewRig\\mempalace-chroma-server";

function home(name: string, claudeJson?: unknown): string {
  const dir = fs.mkdtempSync(path.join(root, `${name}-`));
  if (claudeJson !== undefined) {
    fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify(claudeJson));
  }
  return dir;
}

function isolatedEnv(h: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: h, USERPROFILE: h };
  for (const k of Object.keys(env)) if (k.startsWith("MEMPALACE_MCP_")) delete env[k];
  env["MEMPALACE_MCP_PORT"] = "9"; // nothing listens: the daemon-conflict probe fails
  return env;
}

function runProcess(
  command: string,
  args: string[],
  h: string,
): { status: number | null; out: string } {
  const r = spawnSync(command, args, {
    cwd: REPO,
    env: isolatedEnv(h),
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const entries: Array<
  [string, (h: string) => { status: number | null; out: string }, string | false]
> = [
  [
    "TypeScript entry",
    (h) => runProcess(process.execPath, ["scripts/doctor-mempalace.ts"], h),
    false,
  ],
  [
    "bash shim",
    (h) => runProcess("bash", ["scripts/doctor-mempalace.sh"], h),
    !posix && "bash shims are POSIX-only",
  ],
];

describe("the three sections and the verdict", () => {
  for (const [name, run, skip] of entries) {
    test(
      `${name}: labelled sections, a finding for a missing interpreter, restart note`,
      { skip },
      () => {
        const h = home("missing", {
          mcpServers: {
            mempalace: {
              command: "/nonexistent/python",
              args: [path.join(h0(), "scripts", "mempalace-http-wrapper.py")],
            },
          },
        });
        const r = run(h);
        for (const heading of SECTIONS) assert.ok(r.out.includes(heading), `missing ${heading}`);
        assert.match(
          r.out,
          /MemPalace doctor — which MemPalace will actually answer on this machine/,
        );
        assert.match(r.out, /NOT PRESENT — this CLI has no MCP configuration on this machine/);
        assert.match(r.out, /NOT OK — \d+ finding\(s\):/);
        assert.match(r.out, /NOTE: A memory-server session that is already running keeps serving/);
        assert.equal(r.status, 1);
        // The fourth section is Windows only: present on win32, absent everywhere else.
        assert.equal(r.out.includes(FOURTH), !posix, "the fourth section is Windows only");
      },
    );
  }

  test(
    "an HTTP registration is reported by endpoint, auth is not shown, and is not a finding on its own",
    { skip: !posix },
    () => {
      const h = home("http", {
        mcpServers: {
          mempalace: {
            url: "http://127.0.0.1:41893/mcp",
            headers: { Authorization: "Bearer s3cret" },
          },
        },
      });
      const a = entries[0]![1](h);
      const b = entries[1]![1](h);
      assert.match(a.out, /transport:\s+http \(shared daemon, spec 0113\)/);
      assert.match(a.out, /bearer header present \(value not shown\)/);
      assert.ok(!a.out.includes("s3cret"));
      assert.equal(a.status, b.status, "the shim returns the entry's exit status");
      assert.equal(a.out, b.out, "the shim returns the entry's output");
    },
  );

  test("a registration with no Authorization header is flagged loudly", { skip: !posix }, () => {
    const h = home("noauth", { mcpServers: { mempalace: { url: "http://127.0.0.1:41893/mcp" } } });
    assert.match(entries[0]![1](h).out, /NO Authorization HEADER/);
  });

  test("an unguarded argv is reported and is not a finding on its own", { skip: !posix }, () => {
    const h = home("unguarded", { mcpServers: { mempalace: { command: "echo", args: ["hi"] } } });
    const r = entries[0]![1](h);
    assert.match(r.out, /UNGUARDED — this argv routes through no MemPalace wrapper at all,/);
    assert.ok(!/UNGUARDED[\s\S]*finding[\s\S]*UNGUARDED/.test(r.out));
  });

  test("an interpreter-less wrapper and a missing wrapper are reported", { skip: !posix }, () => {
    const a = home("malformed", {
      mcpServers: { mempalace: { command: "mempalace-http-wrapper.py", args: [] } },
    });
    assert.match(entries[0]![1](a).out, /MALFORMED — the wrapper is the first argv element/);
    const b = home("nowrapper", {
      mcpServers: {
        mempalace: { command: "python3", args: ["/nonexistent/mempalace-http-wrapper.py"] },
      },
    });
    const r = entries[0]![1](b);
    assert.match(
      r.out,
      /WRAPPER MISSING — \/nonexistent\/mempalace-http-wrapper\.py does not resolve/,
    );
    assert.equal(r.status, 1);
  });
});

/** This checkout's `scripts/` directory (a wrapper that exists, so the interpreter is the finding). */
function h0(): string {
  return path.join(REPO, "scripts", "lib");
}

describe("the Windows fourth section through the os-inspect seam", () => {
  let fake: FakeSchtasks;
  beforeEach(() => {
    fake = installFakeSchtasks();
  });
  afterEach(() => {
    fake.cleanup();
    setInspectRunnerForTests(undefined);
  });

  const snapshot = (task: string, state: number, lastResult: number): string =>
    JSON.stringify({
      task: { present: true, hresult: 0, state, lastResult, enginePid: state === 4 ? 4242 : null },
      processes: [],
      forTask: task,
    });

  function runner(policy: string | null, snap: (task: string) => string | null): InspectRunner {
    return (spec) => {
      if (spec.args.includes(POLICY_SCRIPT)) {
        return policy === null ? { ok: false, reason: "refused" } : { ok: true, stdout: policy };
      }
      const task = spec.env["CREWRIG_TASK_PATH"] ?? "";
      const text = snap(task);
      return text === null ? { ok: false, reason: "timeout" } : { ok: true, stdout: text };
    };
  }

  async function report(
    platform: NodeJS.Platform,
    h: string,
  ): Promise<{ status: number; out: string }> {
    const lines: string[] = [];
    const status = await doctorMempalace({
      env: isolatedEnv(h),
      home: h,
      scriptDir: path.join(REPO, "scripts"),
      platform,
      io: { out: (l) => void lines.push(l) },
      windows: { schtasksPath: process.execPath },
    });
    return { status, out: lines.join("\n") };
  }

  const q = { skip: !posix };

  test("registered and running: both tasks, last result 0x41301", q, async () => {
    fake.seed(MCP_TASK, "<Task/>");
    fake.seed(CHROMA_TASK, "<Task/>");
    setInspectRunnerForTests(runner('{"prohibited":false}', (t) => snapshot(t, 4, 0x41301)));
    const r = await report("win32", home("w-run"));
    assert.ok(r.out.includes(FOURTH));
    assert.match(
      r.out,
      new RegExp(
        `MCP daemon task \\(${MCP_TASK.replaceAll("\\", "\\\\")}\\)\\n\\s+registered:\\s+yes\\n\\s+running:\\s+yes\\n\\s+last result:\\s+0x41301`,
      ),
    );
    assert.match(r.out, /ChromaDB daemon task[\s\S]*registered:\s+yes[\s\S]*running:\s+yes/);
    assert.match(r.out, /not prohibited by any policy this report can read/);
    assert.ok(!r.out.includes("cannot be installed"));
  });

  test("absent: not registered, not running, no last result", q, async () => {
    setInspectRunnerForTests(
      runner('{"prohibited":false}', () =>
        JSON.stringify({
          task: {
            present: false,
            hresult: 0x80070002 | 0,
            state: 0,
            lastResult: 0,
            enginePid: null,
          },
          processes: [],
        }),
      ),
    );
    const r = await report("win32", home("w-absent"));
    assert.match(
      r.out,
      /registered:\s+NO\n\s+running:\s+no\n\s+last result:\s+none \(no such task\)/,
    );
  });

  test(
    "a prohibiting policy says the daemon cannot be installed and assistants stay in stdio",
    q,
    async () => {
      setInspectRunnerForTests(runner('{"prohibited":true}', () => null));
      const r = await report("win32", home("w-prohibited"));
      assert.match(r.out, /task creation policy:\s+PROHIBITED/);
      assert.match(r.out, /The shared daemon cannot be installed on this machine/);
      assert.match(
        r.out,
        /Each assistant therefore stays in stdio mode,\n\s+one session at a time\./,
      );
    },
  );

  test("an unreadable policy is UNDETERMINED and says an install will answer", q, async () => {
    for (const policy of [null, "this is not json {", '{"prohibited":"yes"}']) {
      setInspectRunnerForTests(runner(policy, () => null));
      const r = await report("win32", home("w-undetermined"));
      assert.match(r.out, /task creation policy:\s+UNDETERMINED/);
      assert.match(r.out, /an install will answer/);
      assert.ok(!r.out.includes("cannot be installed"));
    }
  });

  test(
    "a failed snapshot is UNDETERMINED for running and last result, presence from /Query",
    q,
    async () => {
      fake.seed(MCP_TASK, "<Task/>");
      setInspectRunnerForTests(runner('{"prohibited":false}', () => null));
      const r = await report("win32", home("w-snapfail"));
      assert.match(
        r.out,
        /MCP daemon task[\s\S]*registered:\s+yes\n\s+running:\s+UNDETERMINED \(timeout\)\n\s+last result:\s+UNDETERMINED \(timeout\)/,
      );
      assert.match(r.out, /ChromaDB daemon task[\s\S]*registered:\s+NO/);
    },
  );

  test("the section never changes the exit status and creates no probe task", q, async () => {
    const h = home("w-exit");
    for (const policy of ['{"prohibited":true}', null, '{"prohibited":false}']) {
      setInspectRunnerForTests(runner(policy, () => null));
      const withSection = await report("win32", h);
      const without = await report("linux", h);
      assert.equal(withSection.status, without.status);
      assert.ok(!without.out.includes(FOURTH));
    }
    const verbs = fake.calls().map((c) => c[0]);
    assert.ok(
      verbs.every((v) => v === "/Query"),
      `doctor issued ${verbs.join(",")}`,
    );
    assert.equal(fake.creates().length, 0);
  });

  test("an absent schtasks.exe is reported and the policy is still read", q, async () => {
    setInspectRunnerForTests(runner('{"prohibited":true}', () => null));
    const lines: string[] = [];
    await doctorMempalace({
      env: isolatedEnv(home("w-notool")),
      scriptDir: path.join(REPO, "scripts"),
      platform: "win32",
      io: { out: (l) => void lines.push(l) },
      windows: { schtasksPath: path.join(root, "no-such-schtasks.exe") },
    });
    const out = lines.join("\n");
    assert.match(out, /schtasks\.exe:\s+ABSENT/);
    assert.match(out, /task creation policy:\s+PROHIBITED/);
  });
});

describe("Windows: the real entry against the real Task Scheduler", () => {
  test(
    "the fourth section is reported, informational, with both CrewRig tasks",
    { skip: posix },
    () => {
      const h = home("win-real");
      const r = entries[0]![1](h);
      assert.ok(r.out.includes(FOURTH));
      assert.match(r.out, /schtasks\.exe:\s+PRESENT/);
      assert.match(r.out, /task creation policy:\s+(PROHIBITED|not prohibited|UNDETERMINED)/);
      assert.ok(r.out.includes(MCP_TASK) && r.out.includes(CHROMA_TASK));
      assert.match(r.out, /registered:\s+NO[\s\S]*registered:\s+NO/);
      assert.ok(r.status === 0 || r.status === 1);
    },
  );
});
