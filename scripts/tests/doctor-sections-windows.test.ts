// doctor-sections-windows.test.ts — the Windows fourth section of `doctor-mempalace`
// (*4. Background service mechanism*; spec 0252 requirements 20, 22, 24), driven in
// process through the single os-inspect seam and a stand-in `schtasks` on POSIX
// (registered, running and absent states, the prohibiting policy, UNDETERMINED, snapshot
// failure; the exit status never changes), and on win32 through the real entry against
// the real Task Scheduler (no task is created). Split from doctor-sections.test.ts.

import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { doctorMempalace } from "../lib/service/doctor-run.ts";
import { POLICY_SCRIPT, setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import type { InspectRunner } from "../lib/service/os-inspect.ts";
import { installFakeSchtasks } from "./lib/fake-schtasks.ts";
import type { FakeSchtasks } from "./lib/fake-schtasks.ts";
import {
  CHROMA_TASK,
  FOURTH,
  MCP_TASK,
  REPO,
  entries,
  home,
  isolatedEnv,
  posix,
  root,
} from "./lib/doctor-fixture.ts";

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
