// setup-flow.test.ts — runSetup (spec 0256 requirements 3, 11, 13-16): the step order is the
// descriptor's, the one-key link question precedes the prompter and hands it the remainder, a closed
// stdin stops at the first question with exit 2, a SetupExit status propagates and stops the later
// steps, the unused-answer warning is printed once after a completed run, and nothing calls
// `process.exit`. Fake descriptors and fake steps; the real home and repository are never touched.

import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

import type { StepFn, StepId, StepRegistry } from "../lib/setup/descriptor.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { LINK_ABORT_LINE, LINK_WARNING_LINES } from "../lib/setup/link-key.ts";
import { NO_ANSWER, descriptor, recorder, run, useSandbox } from "./setup-flow-fixtures.ts";

useSandbox();

describe("runSetup", () => {
  test("runs the steps in the descriptor's order, whatever the registry order", async () => {
    const log: string[] = [];
    const steps: StepRegistry = {};
    for (const id of ["summary", "mcp", "rules-existing", "banner"] as const)
      steps[id] = recorder(log, id);
    const result = await run(descriptor(["banner", "rules-existing", "mcp", "summary"]), steps);
    assert.deepEqual(log, ["banner", "rules-existing", "mcp", "summary"]);
    assert.equal(result.status, 0);
  });

  test("the common banner prints the descriptor's title", async () => {
    const result = await run(descriptor(["banner"]), {});
    const line = "====================================";
    assert.equal(result.out, `${line}\n  Fake Setup\n${line}\n\n`);
  });

  test("the link question runs before the prompter and leaves the rest of the pipe to it", async () => {
    const log: string[] = [];
    const result = await run(
      descriptor(["banner", "link-confirm", "rules-existing"]),
      { banner: recorder(log, "banner"), "rules-existing": recorder(log, "rules", true) },
      { argv: ["--link"], stdin: "y\nkeep\n" },
    );
    assert.deepEqual(log, ["banner", "rules", "rules=keep"]);
    assert.equal(result.status, 0);
    for (const line of LINK_WARNING_LINES) assert.ok(result.out.includes(`${line}\n`));
  });

  test("without --link the question is not asked and the first line is the first answer", async () => {
    const log: string[] = [];
    const result = await run(
      descriptor(["link-confirm", "rules-existing"]),
      { "rules-existing": recorder(log, "rules", true) },
      { stdin: "refresh\n" },
    );
    assert.deepEqual(log, ["rules", "rules=refresh"]);
    assert.ok(!result.out.includes("WARNING"));
  });

  test("a key other than y aborts the link question with exit 1 and no later step", async () => {
    const log: string[] = [];
    const result = await run(
      descriptor(["link-confirm", "mcp"]),
      { mcp: recorder(log, "mcp") },
      { argv: ["--link"], stdin: "n\n" },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(log, []);
    assert.ok(result.out.includes(`${LINK_ABORT_LINE}\n`));
  });

  test("Copilot has no link-confirm: --link prints nothing and the prompter exists from the start", async () => {
    const log: string[] = [];
    const result = await run(
      descriptor(["rules-existing"], "copilot"),
      { "rules-existing": recorder(log, "rules", true) },
      { argv: ["--link"], stdin: "keep\n" },
    );
    assert.deepEqual(log, ["rules", "rules=keep"]);
    assert.ok(!result.out.includes("WARNING"));
  });

  test("a closed stdin stops at the first question with exit 2 and runs nothing after it", async () => {
    const log: string[] = [];
    const result = await run(descriptor(["banner", "rules-existing", "mcp"]), {
      banner: recorder(log, "banner"),
      "rules-existing": recorder(log, "rules", true),
      mcp: recorder(log, "mcp"),
    });
    assert.equal(result.status, 2);
    assert.deepEqual(log, ["banner", "rules"]);
    assert.ok(result.err.includes(`${NO_ANSWER}\n`));
  });

  test("a SetupExit status propagates and the failing step stops every later one (Chroma-style)", async () => {
    const log: string[] = [];
    const chroma: StepFn = async ({ ctx }) => {
      ctx.io.err("ERROR: chroma daemon install failed");
      throw new SetupExit(1);
    };
    const result = await run(descriptor(["banner", "mcp", "tiers", "summary"]), {
      banner: recorder(log, "banner"),
      mcp: chroma,
      tiers: recorder(log, "tiers"),
      summary: recorder(log, "summary"),
    });
    assert.equal(result.status, 1);
    assert.deepEqual(log, ["banner"]);
    assert.equal(result.err, "ERROR: chroma daemon install failed\n");
    const other = await run(descriptor(["mcp"]), {
      mcp: async () =>
        void (() => {
          throw new SetupExit(130);
        })(),
    });
    assert.equal(other.status, 130);
  });

  test("an unknown error is rethrown, and a step with no body is an explicit error", async () => {
    // Every id is registered by now, so a registry entry set to `undefined` (the override wins in
    // the spread) stands for a step that no file registered.
    const unregistered = { summary: undefined } as unknown as StepRegistry;
    await assert.rejects(
      run(descriptor(["summary"]), unregistered),
      /step 'summary' has no implementation/,
    );
    const fake = descriptor(["nonexistent-step" as unknown as StepId]);
    await assert.rejects(run(fake, {}), /step 'nonexistent-step' has no implementation/);
  });

  test("an unused --answer is named once on stderr after a completed run; a used one is not", async () => {
    const unused = await run(
      descriptor(["banner"]),
      { banner: recorder([], "banner") },
      { argv: ["--answer", "tls-delegation=yes", "--answer=mempalace-install=no"] },
    );
    assert.equal(
      unused.err,
      "Warning: --answer given for a question that was not asked: tls-delegation, mempalace-install\n",
    );
    const used = await run(
      descriptor(["rules-existing"]),
      { "rules-existing": recorder([], "r", true) },
      { argv: ["--answer", "rules-action=keep"] },
    );
    assert.equal(used.err, "");
    assert.ok(used.out.includes("[answer] rules-action=keep\n"));
    const failed = await run(
      descriptor(["mcp"]),
      {
        mcp: async () => {
          throw new SetupExit(1);
        },
      },
      { argv: ["--answer", "tls-delegation=yes"] },
    );
    assert.equal(failed.err, "");
  });

  test("a malformed --answer is a usage error before any step", async () => {
    const log: string[] = [];
    const result = await run(
      descriptor(["banner"]),
      { banner: recorder(log, "banner") },
      { argv: ["--answer", "nope"] },
    );
    assert.equal(result.status, 2);
    assert.deepEqual(log, []);
  });

  test("the run never calls process.exit", async () => {
    const exit = mock.method(process, "exit", () => {
      throw new Error("process.exit called");
    });
    try {
      await run(descriptor(["mcp"]), {
        mcp: async () => {
          throw new SetupExit(3);
        },
      });
      await run(descriptor(["rules-existing"]), { "rules-existing": recorder([], "r", true) });
      assert.equal(exit.mock.callCount(), 0);
    } finally {
      exit.mock.restore();
    }
  });
});
