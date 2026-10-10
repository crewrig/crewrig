// setup-mempalace-callsite.test.ts — the arm table of requirement 26 (delta-01) and the call
// order of scripts/lib/setup/mempalace-callsite.ts, pinned against the golden cells of the shell
// oracle and the shell text itself. It is the analogue of test-setup-mempalace-rc-guard.sh: return
// codes 1 and 2 never throw and the step that follows still runs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Cli, Io } from "../lib/setup/context.ts";
import {
  armFor,
  runMempalaceStep,
  type EnsureRc,
  type MempalaceStepDeps,
} from "../lib/setup/mempalace-callsite.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "fixtures", "setup-golden");
const SCRIPTS = path.join(HERE, "..");
const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];
const RCS: readonly EnsureRc[] = [0, 1, 2];

const HTTP_READY = "  MemPalace reaches shared memory through the HTTP daemon.";
const STDIO_WARNING = [
  "  WARNING: mempalace stays on the stdio arrangement — no shared",
  "           daemon could be established. Sessions will contend for",
  "           the palace writer lock until the daemon is up.",
];
const LOCKOUT = [
  "  LOCKOUT WARNING: the daemon is verified serving but registration",
  "           could not be completed, so the stdio entry just written",
  "           will be refused by the shared writer lock (MCP error",
  "           -32001) in every session.",
];
const CONVERGED =
  "  Converged mempalace to the stdio http-wrapper entry (no serving daemon available).";
const CONVERGE_FAILED = "  ERROR: could not register even the stdio fallback for mempalace.";
const KEPT = "  Existing mempalace registration kept (the daemon is verified serving).";
const NO_REGISTRATION =
  "  WARNING: no mempalace registration could be written although the daemon is verified serving.";

function golden(cli: Cli, rc: EnsureRc): string {
  return readFileSync(path.join(GOLDEN, cli, `ensure-http-rc${rc}`, "stdout.golden"), "utf8");
}

function shellText(cli: Cli): string {
  return readFileSync(path.join(SCRIPTS, `setup-${cli}-interactive.sh`), "utf8");
}

/** The shell prints `echo "<line>"`; the lines of the table must be in the script text verbatim. */
function shellHas(cli: Cli, line: string): boolean {
  return shellText(cli).includes(`echo "${line}"`);
}

interface Recorder {
  readonly calls: string[];
  readonly out: string[];
  readonly deps: MempalaceStepDeps;
}

function recorder(
  cli: Cli,
  rc: EnsureRc | "throw",
  opts: { stdio?: boolean; registered?: boolean } = {},
): Recorder {
  const calls: string[] = [];
  const out: string[] = [];
  const io: Io = {
    out: (line) => void out.push(line),
    err: (line) => void calls.push(`err:${line}`),
    errRaw: (text) => void calls.push(`errRaw:${text}`),
  };
  const deps: MempalaceStepDeps = {
    ctx: { io },
    cli,
    ensure: async () => {
      calls.push("ensure");
      if (rc === "throw") throw new Error("boom");
      return rc;
    },
    registerStdio: () => {
      calls.push("registerStdio");
      return opts.stdio ?? true;
    },
    removeUserScope: () => void calls.push("removeUserScope"),
    isRegistered: () => {
      calls.push("isRegistered");
      return opts.registered ?? true;
    },
  };
  return { calls, out, deps };
}

describe("armFor: the table of requirement 26, line by line", () => {
  it("Claude rc 0 prints nothing and counts installed", () => {
    assert.deepEqual(armFor("claude", 0), { lines: [], installed: true, action: "none" });
  });

  it("Claude rc 1 converges to stdio, with the success and failure texts", () => {
    assert.deepEqual(armFor("claude", 1), {
      lines: [CONVERGED],
      installed: true,
      action: "converge-stdio",
    });
    assert.deepEqual(armFor("claude", 1, { stdioRegistered: false, existingEntry: true }), {
      lines: [CONVERGE_FAILED],
      installed: false,
      action: "converge-stdio",
    });
  });

  it("Claude rc 2 keeps an existing entry, or warns when there is none", () => {
    assert.deepEqual(armFor("claude", 2), {
      lines: [KEPT],
      installed: true,
      action: "keep-existing",
    });
    assert.deepEqual(armFor("claude", 2, { stdioRegistered: true, existingEntry: false }), {
      lines: [NO_REGISTRATION],
      installed: false,
      action: "keep-existing",
    });
  });

  for (const cli of ["gemini", "copilot", "antigravity"] as const) {
    it(`${cli}: rc 0 / 1 / 2 print the HTTP line, the warning, the four-line lockout`, () => {
      assert.deepEqual(armFor(cli, 0), { lines: [HTTP_READY], installed: true, action: "none" });
      assert.deepEqual(armFor(cli, 1), { lines: STDIO_WARNING, installed: true, action: "none" });
      assert.deepEqual(armFor(cli, 2), { lines: LOCKOUT, installed: true, action: "none" });
    });
  }

  it("aligns every continuation line under the text of the first line (eleven spaces)", () => {
    for (const lines of [STDIO_WARNING, LOCKOUT]) {
      for (const cont of lines.slice(1)) assert.equal(/^ {11}\S/.test(cont), true, cont);
    }
  });
});

describe("armFor against the golden cells and the shell text", () => {
  it("finds the golden fixtures (vacuity guard)", () => {
    for (const cli of CLIS) for (const rc of RCS) assert.ok(golden(cli, rc).length > 100);
  });

  for (const cli of CLIS) {
    for (const rc of RCS) {
      it(`${cli} rc ${rc}: the printed lines are the golden stdout fragment`, () => {
        const arm = armFor(cli, rc);
        const text = golden(cli, rc);
        if (arm.lines.length === 0) {
          // Claude rc 0 prints nothing: none of the other arms' lines may be in its cell.
          for (const other of [CONVERGED, KEPT, NO_REGISTRATION, HTTP_READY, ...LOCKOUT]) {
            assert.equal(text.includes(other), false, other);
          }
          return;
        }
        assert.ok(text.includes(`${arm.lines.join("\n")}\n`), `${cli} rc ${rc}`);
      });
    }
  }

  it("every line of the table is an `echo` of its CLI's setup script, none on stderr", () => {
    for (const cli of CLIS) {
      for (const rc of RCS) {
        for (const facts of [true, false]) {
          const arm = armFor(cli, rc, { stdioRegistered: facts, existingEntry: facts });
          for (const line of arm.lines) assert.equal(shellHas(cli, line), true, `${cli}: ${line}`);
        }
      }
      for (const line of shellText(cli).split("\n")) {
        if (
          /MemPalace reaches|mempalace stays|LOCKOUT|Converged|stdio fallback|registration kept/.test(
            line,
          )
        ) {
          assert.equal(line.includes(">&2"), false, line);
        }
      }
    }
  });
});

describe("runMempalaceStep: order of calls per CLI", () => {
  it("Claude ensures first and does nothing else on rc 0", async () => {
    const r = recorder("claude", 0);
    assert.deepEqual(await runMempalaceStep(r.deps), { installed: true });
    assert.deepEqual(r.calls, ["ensure"]);
    assert.deepEqual(r.out, []);
  });

  it("Claude rc 1 removes the user-scope entry, then registers stdio, then prints", async () => {
    const r = recorder("claude", 1);
    assert.deepEqual(await runMempalaceStep(r.deps), { installed: true });
    assert.deepEqual(r.calls, ["ensure", "removeUserScope", "registerStdio"]);
    assert.deepEqual(r.out, [CONVERGED]);
  });

  it("Claude rc 1 with a failing stdio registration prints the error and is not installed", async () => {
    const r = recorder("claude", 1, { stdio: false });
    assert.deepEqual(await runMempalaceStep(r.deps), { installed: false });
    assert.deepEqual(r.out, [CONVERGE_FAILED]);
  });

  it("Claude rc 1 survives a failing removal (`|| true`)", async () => {
    const r = recorder("claude", 1);
    const deps = {
      ...r.deps,
      removeUserScope: () => {
        throw new Error("claude not found");
      },
    };
    assert.deepEqual(await runMempalaceStep(deps), { installed: true });
    assert.deepEqual(r.out, [CONVERGED]);
  });

  it("Claude rc 2 keeps an existing entry: no removal, no stdio registration", async () => {
    const r = recorder("claude", 2, { registered: true });
    assert.deepEqual(await runMempalaceStep(r.deps), { installed: true });
    assert.deepEqual(r.calls, ["ensure", "isRegistered"]);
    assert.deepEqual(r.out, [KEPT]);
  });

  it("Claude rc 2 without an entry warns and is not installed, still no stdio write", async () => {
    const r = recorder("claude", 2, { registered: false });
    assert.deepEqual(await runMempalaceStep(r.deps), { installed: false });
    assert.deepEqual(r.calls, ["ensure", "isRegistered"]);
    assert.deepEqual(r.out, [NO_REGISTRATION]);
  });

  for (const cli of ["gemini", "copilot", "antigravity"] as const) {
    for (const rc of RCS) {
      it(`${cli} rc ${rc}: the stdio entry is written BEFORE the ensure, nothing removed`, async () => {
        const r = recorder(cli, rc);
        assert.deepEqual(await runMempalaceStep(r.deps), { installed: true });
        assert.deepEqual(r.calls, ["registerStdio", "ensure"]);
        assert.deepEqual(r.out, armFor(cli, rc).lines);
      });
    }

    it(`${cli}: no stdio entry written means no ensure and nothing printed`, async () => {
      const r = recorder(cli, 0, { stdio: false });
      assert.deepEqual(await runMempalaceStep(r.deps), { installed: false });
      assert.deepEqual(r.calls, ["registerStdio"]);
      assert.deepEqual(r.out, []);
    });
  }
});

describe("runMempalaceStep: return codes 1 and 2 never abort the run", () => {
  for (const cli of CLIS) {
    for (const rc of [1, 2] as const) {
      it(`${cli} rc ${rc}: resolves, and a following step runs`, async () => {
        const r = recorder(cli, rc);
        const following: string[] = [];
        await assert.doesNotReject(async () => {
          await runMempalaceStep(r.deps);
          following.push("org-mcp");
        });
        assert.deepEqual(following, ["org-mcp"]);
        assert.ok(r.out.length > 0);
        assert.equal(
          r.calls.some((c) => c.startsWith("err")),
          false,
          "nothing goes to stderr",
        );
      });
    }
  }

  it("an unexpected return code matches no arm: nothing printed, Claude not installed", async () => {
    const claude = recorder("claude", 3 as unknown as EnsureRc);
    assert.deepEqual(await runMempalaceStep(claude.deps), { installed: false });
    assert.deepEqual(claude.out, []);
    const gemini = recorder("gemini", 3 as unknown as EnsureRc);
    assert.deepEqual(await runMempalaceStep(gemini.deps), { installed: true });
    assert.deepEqual(gemini.out, []);
  });
});
