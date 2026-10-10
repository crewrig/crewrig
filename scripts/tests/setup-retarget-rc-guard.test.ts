// setup-retarget-rc-guard.test.ts — the MemPalace HTTP call site of the four setups, run through the
// real flow runner with the `ensureMempalaceHttp` seam stubbed to return 0, 1 and 2 (spec 0256
// requirement 9, PR D2; requirement 26 as replaced by delta-01). It replaces the behaviour half of
// test-setup-mempalace-rc-guard.sh, which extracted the `_mempalace_rc=0 ... esac` fragment from
// the shell text and ran it under its own `set -e`.
//
// Retired with the shell text (PR E): the anchor-line extraction and the `set -e` survival, a
// shell-syntax property. Its behavioural replacement is here: for rc 1 and rc 2 the step resolves,
// exits 0, prints the documented text, and the step AFTER it still runs.
//
// Pins against the unchanged shell: the golden cells <cli>/ensure-http-rc0, -rc1, -rc2 (stdout of
// the shell oracle) and the shell-text assertions of setup-mempalace-callsite.test.ts, which keep
// reading the four `.sh` while they exist. This file reads the golden cells too, so the substrings
// asserted below cannot drift from the shell transcript.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Cli } from "../lib/setup/context.ts";
import type { StepRegistry } from "../lib/setup/descriptor.ts";
import { runMempalaceStep, type EnsureRc } from "../lib/setup/mempalace-callsite.ts";
import { descriptor, run, useSandbox } from "./setup-flow-fixtures.ts";

useSandbox();

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "setup-golden");
const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];
const RCS: readonly EnsureRc[] = [0, 1, 2];

// The substrings of the R26 table, per (cli, rc); `null` means nothing is printed.
const EXPECTED: Record<Cli, Record<EnsureRc, string | null>> = {
  claude: {
    0: null,
    1: "Converged mempalace to the stdio http-wrapper entry",
    2: "Existing mempalace registration kept",
  },
  gemini: {
    0: "MemPalace reaches shared memory through the HTTP daemon.",
    1: "WARNING: mempalace stays on the stdio arrangement",
    2: "LOCKOUT WARNING: the daemon is verified serving",
  },
  copilot: {
    0: "MemPalace reaches shared memory through the HTTP daemon.",
    1: "WARNING: mempalace stays on the stdio arrangement",
    2: "LOCKOUT WARNING: the daemon is verified serving",
  },
  antigravity: {
    0: "MemPalace reaches shared memory through the HTTP daemon.",
    1: "WARNING: mempalace stays on the stdio arrangement",
    2: "LOCKOUT WARNING: the daemon is verified serving",
  },
};

/** Every R26 line of every arm: a cell prints its own and none of the others. */
const ALL_LINES = [
  ...new Set(Object.values(EXPECTED).flatMap((byRc) => Object.values(byRc))),
].filter((s): s is string => s !== null);

interface Outcome {
  readonly status: number;
  readonly out: string;
  readonly err: string;
  readonly log: string[];
}

/**
 * The flow of the call site: a `mcp` step that runs `runMempalaceStep` exactly as the four
 * `mcp-<cli>-step.ts` do (`ensure` is the stubbed `ensureMempalaceHttp`: it resolves `rc`),
 * then a later `summary` step that records it ran. Only the effects around the arm are fakes.
 */
async function runCallSite(cli: Cli, rc: EnsureRc): Promise<Outcome> {
  const log: string[] = [];
  const steps: StepRegistry = {
    mcp: async ({ ctx }) => {
      const result = await runMempalaceStep({
        ctx,
        cli,
        ensure: async () => (log.push("ensure"), rc),
        registerStdio: () => (log.push("registerStdio"), true),
        removeUserScope: () => void log.push("removeUserScope"),
        isRegistered: () => (log.push("isRegistered"), true),
      });
      log.push(`installed=${result.installed}`);
    },
    summary: async () => void log.push("summary"),
  };
  const r = await run(descriptor(["mcp", "summary"], cli), steps);
  return { status: r.status, out: r.out, err: r.err, log };
}

describe("the MemPalace call site, run through the flow with the ensure seam stubbed", () => {
  for (const cli of CLIS) {
    for (const rc of RCS) {
      it(`${cli} rc ${rc}: prints the documented text, exits 0 and continues to the later steps`, async () => {
        const r = await runCallSite(cli, rc);
        // Vacuity guard: the run reached the ensure seam and finished the whole flow.
        assert.ok(r.log.includes("ensure"), "the seam was consulted");
        assert.equal(r.status, 0, r.err);
        // The shell survival property: the step after the call site ran, for rc 1 and rc 2 too.
        assert.ok(r.log.includes("summary"), `a later step ran: ${r.log.join(",")}`);
        assert.equal(r.err, "", "nothing goes to stderr");
        const expected = EXPECTED[cli][rc];
        if (expected === null) {
          for (const line of ALL_LINES) assert.equal(r.out.includes(line), false, line);
        } else {
          assert.ok(r.out.includes(expected), `${cli} rc ${rc}: ${expected} in ${r.out}`);
          for (const line of ALL_LINES.filter((l) => l !== expected))
            assert.equal(r.out.includes(line), false, `unexpected: ${line}`);
        }
      });

      it(`${cli} rc ${rc}: the substring is in the shell oracle's golden cell`, () => {
        const expected = EXPECTED[cli][rc];
        const golden = readFileSync(
          path.join(GOLDEN, cli, `ensure-http-rc${rc}`, "stdout.golden"),
          "utf8",
        );
        assert.ok(golden.length > 100, "the golden cell exists (vacuity guard)");
        if (expected !== null) assert.ok(golden.includes(expected), expected);
      });
    }
  }

  it("Claude rc 1 removes the user-scope entry then registers stdio; rc 2 only looks for an entry", async () => {
    assert.deepEqual((await runCallSite("claude", 1)).log, [
      "ensure",
      "removeUserScope",
      "registerStdio",
      "installed=true",
      "summary",
    ]);
    assert.deepEqual((await runCallSite("claude", 2)).log, [
      "ensure",
      "isRegistered",
      "installed=true",
      "summary",
    ]);
  });

  it("Gemini, Copilot and Antigravity write the stdio entry BEFORE the ensure, whatever the rc", async () => {
    for (const cli of ["gemini", "copilot", "antigravity"] as const) {
      for (const rc of RCS) {
        const r = await runCallSite(cli, rc);
        assert.deepEqual(r.log.slice(0, 2), ["registerStdio", "ensure"], `${cli} rc ${rc}`);
      }
    }
  });
});
