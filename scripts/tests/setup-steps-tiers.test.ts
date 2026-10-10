// setup-steps-tiers.test.ts — the `tiers` step of steps-tiers.ts: strategy dispatch, the overlay
// opt-ins and the failure paths, against the goldens overlay-yes/no and tier-install-failure of
// antigravity and tier-optins / tier-optin-org-declined of gemini.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SetupDescriptor, StepRegistry } from "../lib/setup/descriptor.ts";
import { tierSteps } from "../lib/setup/steps-tiers.ts";
import { descriptor, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";
import { exists, golden, printed, put, read, slice } from "./setup-steps-agy-fixtures.ts";

useSandbox();

const SKILL = "---\nname: s\ndescription: d\n---\nbody\n";

function withBuild(build: () => Promise<number>): StepRegistry {
  const tiers = tierSteps["tiers"];
  assert.ok(tiers !== undefined);
  return {
    tiers: (env) => tiers({ ...env, deps: { ...env.deps, seams: { tierBuild: { build } } } }),
  };
}

const agyDescriptor = (): SetupDescriptor => ({
  ...descriptor(["tiers"], "antigravity"),
  strategies: { mcp: "antigravityMcp", tiers: "antigravity", usageCapture: "statusline" },
});

const agyStage = (): void => {
  for (const tier of ["library", "community", "org"])
    put(`dist/${tier}/.agents/skills/${tier}-skill/SKILL.md`, SKILL);
};
const both = ["--answer", "overlay.community=yes", "--answer", "overlay.org=yes"];
const none = ["--answer", "overlay.community=no", "--answer", "overlay.org=no"];

describe("tiers (antigravity strategy)", () => {
  const fragment = (cell: string): string =>
    slice(
      golden("antigravity", cell, "stdout.golden"),
      "Installing library components",
      "Migrating components left",
      -1,
    );

  test("overlay yes installs library, community and org (golden overlay-yes)", async () => {
    agyStage();
    const result = await run(agyDescriptor(), tierSteps, { argv: both });
    assert.equal(printed(result.out), fragment("overlay-yes"));
    assert.equal(result.status, 0);
    assert.ok(exists(".gemini/config/skills/org-skill/SKILL.md"));
  });

  test("overlay no installs the library only and prints the skip lines (golden overlay-no)", async () => {
    agyStage();
    const result = await run(agyDescriptor(), tierSteps, { argv: none });
    assert.equal(printed(result.out), fragment("overlay-no"));
    assert.equal(exists(".gemini/config/skills/community-skill"), false);
  });

  test("does not run the superseded migration: that is its own step", async () => {
    agyStage();
    const result = await run(agyDescriptor(), tierSteps, { argv: none });
    assert.doesNotMatch(result.out, /Migrating components/);
  });

  test("a library tier whose skill cannot be placed exits 1 (golden tier-install-failure)", async () => {
    put("dist/library/.agents/skills/broken-skill/README.md", "no SKILL.md here\n");
    const result = await run(agyDescriptor(), tierSteps, { argv: none });
    const out = golden("antigravity", "tier-install-failure", "stdout.golden");
    assert.equal(
      printed(result.out),
      slice(out, "Installing library components", undefined, -1).replace(/\n+$/, "\n"),
    );
    const want = golden("antigravity", "tier-install-failure", "stderr.golden")
      .split("\n")
      .filter((l) => !l.startsWith("Warning:"))
      .join("\n");
    assert.equal(result.err, want);
    assert.equal(result.status, 1);
    assert.equal(golden("antigravity", "tier-install-failure", "status.golden").trim(), "1");
  });

  test("a library that is not built is built in process; a failed build exits 1", async () => {
    const calls: string[] = [];
    const ok = await run(
      agyDescriptor(),
      withBuild(async () => {
        calls.push("b");
        return 0;
      }),
      {
        argv: none,
      },
    );
    assert.equal(ok.status, 0);
    assert.deepEqual(calls, ["b"]);
    assert.match(ok.out, /Tier not built \(no .*dist.library.\.agents\) — building automatically/);
    const bad = await run(
      agyDescriptor(),
      withBuild(async () => 1),
      { argv: none },
    );
    assert.equal(bad.status, 1);
    assert.match(bad.err, /ERROR: automatic build failed for target 'antigravity'\./);
  });

  test("a closed standard input names the overlay question and exits 2", async () => {
    agyStage();
    const result = await run(agyDescriptor(), tierSteps);
    assert.equal(result.status, 2);
    assert.match(result.err, /no answer for 'overlay\.community'/);
  });
});

describe("tiers (standard strategy)", () => {
  const stage = (): void => {
    for (const tier of ["community", "org"]) {
      put(`dist/${tier}/.gemini/skills/${tier}-skill/SKILL.md`, SKILL);
      put(`dist/${tier}/.gemini/agents/${tier}-agent.md`, "agent\n");
    }
  };
  const gemini = (): SetupDescriptor => descriptor(["tiers"], "gemini");
  const tail = (text: string): string => text.replace(/\n+$/, "");

  test("gemini: both overlays accepted (golden tier-optins)", async () => {
    stage();
    const result = await run(
      gemini(),
      withBuild(async () => 0),
      { argv: both },
    );
    const out = golden("gemini", "tier-optins", "stdout.golden");
    const want = slice(out, "  Tier 'library' not built", "  Session recording disabled");
    assert.ok(
      printed(result.out).startsWith(
        `\nInstalling library components to ${sandbox.tmp}/.gemini/skills (automatic)...\nTier not built`,
      ),
    );
    assert.ok(tail(printed(result.out)).endsWith(tail(want)));
    assert.ok(exists(".gemini/agents/org-agent.md"));
  });

  test("gemini: org declined (golden tier-optin-org-declined)", async () => {
    put("dist/org/.gemini/skills/org-skill/SKILL.md", SKILL);
    const result = await run(
      gemini(),
      withBuild(async () => 0),
      { argv: none },
    );
    const out = golden("gemini", "tier-optin-org-declined", "stdout.golden");
    const want = slice(out, "  Tier 'library' not built", "  Session recording disabled");
    assert.ok(tail(printed(result.out)).endsWith(tail(want)));
    assert.equal(exists(".gemini/skills/org-skill"), false);
  });

  test("claude: library skills and flat agents land under ~/.claude", async () => {
    put("dist/library/.claude/skills/lib-skill/SKILL.md", SKILL);
    put("dist/library/.claude/agents/lib-agent.md", "agent\n");
    const result = await run(descriptor(["tiers"], "claude"), tierSteps, { argv: none });
    assert.equal(result.status, 0);
    assert.match(
      result.out,
      /Installed skill: library\/lib-skill -> ~\/\.claude\/skills\/lib-skill\n/,
    );
    assert.match(
      result.out,
      /Installed agent: library\/lib-agent -> ~\/\.claude\/agents\/lib-agent\.md\n/,
    );
    assert.equal(read(".claude/agents/lib-agent.md"), "agent\n");
  });

  test("copilot: skills only, no leading blank line before the library line", async () => {
    put("dist/library/.github/skills/lib-skill/SKILL.md", SKILL);
    const result = await run(descriptor(["tiers"], "copilot"), tierSteps, { argv: none });
    assert.equal(result.status, 0);
    assert.ok(
      result.out.startsWith(
        `Installing library skills to ${sandbox.tmp}/.copilot/skills (automatic)...\n`,
      ),
    );
    assert.ok(exists(".copilot/skills/lib-skill/SKILL.md"));
  });

  test("the standard strategy refuses to run for antigravity (programming error, not an install failure)", async () => {
    await assert.rejects(
      run(descriptor(["tiers"], "antigravity"), tierSteps),
      /standard strategy cannot install for antigravity/,
    );
  });

  test("a bare copy failure the shell let abort fails closed: one Error line, exit 1", async () => {
    put("dist/library/.claude/skills/lib-skill/SKILL.md", SKILL);
    put(".claude/skills", "a file where the skills directory belongs\n");
    const result = await run(descriptor(["tiers"], "claude"), tierSteps, { argv: none });
    assert.equal(result.status, 1);
    assert.match(result.err, /^Error: cannot install the components: .+\n$/);
  });
});
