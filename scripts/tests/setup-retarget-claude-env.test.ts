// setup-retarget-claude-env.test.ts - the Claude Code env patch that scripts/tests/hook-transcript-floor.test.ts
// used to read from the TEXT of scripts/setup-claude-interactive.sh (a regex on `ENV_PATCH=...` under
// `if [ "$SR_TRANSCRIPT_WIRED" = "1" ]`), now observed by RUNNING the TypeScript entry
// (scripts/setup-claude-interactive.ts) in the golden sandbox and reading the patched
// `~/.claude/settings.json` env block (spec 0256 requirement 9, PR D2).
// Pinned against the unchanged shell by the golden cells claude/transcript-optin-yes (env with both keys),
// transcript-optin-no and transcript-optin-apply-declined (no patch); the interpreter-less case cannot be run
// through the entry (a missing MemPalace stops the setup before the recording step, exit 1), so it is
// pinned by the unit assertion on claudeEnvPatch below and by the step test named next.
// The step-level behaviour is also covered by scripts/tests/setup-steps-hooks.test.ts. Linux only (golden harness).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import { realHomeGuard } from "./lib/real-home-guard.ts";
import { casesFor } from "./lib/setup-golden-all.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import type { GoldenCase } from "./lib/setup-golden-types.ts";
import type { SetupSandbox } from "./lib/setup-sandbox.ts";
import { hasJq } from "./lib/setup-stubs.ts";
import { claudeEnvPatch } from "../lib/setup/session-recording.ts";

const skip =
  process.platform !== "linux"
    ? "the setup golden harness runs on Linux only"
    : hasJq()
      ? undefined
      : "a real jq is required";

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly home: string;
  /** `~/.claude/settings.json` at the end of the run, undefined when absent. */
  readonly settings: Record<string, unknown> | undefined;
}

/** Run a golden case on the TypeScript leg, reading settings.json before the sandbox is removed. */
async function run(c: GoldenCase): Promise<Run> {
  let settings: Record<string, unknown> | undefined;
  let home = "";
  const wrapped: GoldenCase = {
    ...c,
    seed: (sb: SetupSandbox) => {
      c.seed?.(sb);
      const dispose = sb.dispose;
      (sb as { dispose: () => void }).dispose = () => {
        const file = path.join(sb.home, ".claude/settings.json");
        home = fs.realpathSync(sb.home);
        settings = fs.existsSync(file)
          ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
          : undefined;
        dispose();
      };
    },
  };
  const res = await runSetupCase(wrapped, "ts");
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, home, settings };
}

const cell = (id: string): GoldenCase => {
  const found = casesFor("claude").find((c) => c.id === id);
  assert.ok(found, `golden cell ${id} exists`);
  return found;
};
const env = (r: Run): Record<string, unknown> =>
  (r.settings?.["env"] ?? {}) as Record<string, unknown>;

describe("Claude Code env patch, observed by running the TypeScript entry", { skip }, () => {
  let guard: ReturnType<typeof realHomeGuard> | undefined;
  before(() => {
    guard = realHomeGuard();
  });

  test("the patch function: consent only when wired, interpreter only when detected", () => {
    assert.deepEqual(claudeEnvPatch(false, "/usr/bin/python3").patch, {});
    assert.deepEqual(claudeEnvPatch(true, "").patch, { MEMPALACE_TRANSCRIPT_ENABLED: "1" });
    assert.deepEqual(claudeEnvPatch(true, "/p/python").patch, {
      MEMPALACE_TRANSCRIPT_ENABLED: "1",
      MEMPALACE_PYTHON: "/p/python",
    });
  });

  test("yes + Apply: settings.json env holds the consent and the detected interpreter", async () => {
    // pin: golden claude/transcript-optin-yes
    const r = await run(cell("transcript-optin-yes"));
    try {
      assert.equal(r.status, 0, r.stderr); // vacuity guard: the run completed and wrote settings.json
      assert.ok(r.settings !== undefined, "settings.json landed");
      assert.equal(env(r)["MEMPALACE_TRANSCRIPT_ENABLED"], "1");
      assert.equal(
        env(r)["MEMPALACE_PYTHON"],
        path.join(r.home, ".local/share/pipx/venvs/mempalace/bin/python"),
      );
      assert.match(r.stdout, /Session recording wired to /);
    } finally {
      guard?.assertUnchanged();
    }
  });

  test("offer declined or Apply declined: no env patch at all", async () => {
    // pins: golden claude/transcript-optin-no and transcript-optin-apply-declined
    for (const id of ["transcript-optin-no", "transcript-optin-apply-declined"]) {
      const r = await run(cell(id));
      try {
        assert.equal(r.status, 0, `${id}: ${r.stderr}`);
        assert.ok(!("MEMPALACE_TRANSCRIPT_ENABLED" in env(r)), `${id}: no consent patched`);
        assert.ok(!("MEMPALACE_PYTHON" in env(r)), `${id}: no interpreter patched`);
        assert.doesNotMatch(r.stdout, /Session recording wired to /);
      } finally {
        guard?.assertUnchanged();
      }
    }
  });
});
