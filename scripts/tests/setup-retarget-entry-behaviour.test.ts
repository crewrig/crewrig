// setup-retarget-entry-behaviour.test.ts — the behaviour assertions that three Bash suites used to
// read out of the TEXT of the shell setups, now run against the TypeScript entry (ticket #1335,
// spec 0256 requirement 9, PR D2). Each test runs the real entry (scripts/setup-<cli>-interactive.ts)
// in a sandboxed HOME with the stubs of the golden harness (the `ts` leg) and asserts on the status,
// the stdout and the file tree it produced. The Bash suites call this file with `node --test` and
// report each test by name:
//   * scripts/tests/test-setup-gemini-md-cleanup.sh        -> "legacy GEMINI.md cleanup"
//   * scripts/tests/test-artifact-build-install-scope.sh   -> "overlay tiers"
//   * scripts/tests/test-antigravity-component-install.sh  -> "antigravity tier install failure"
// Pinned against the unchanged shell by the setup-golden cells named at each describe (the golden
// suites run the shell leg and the ts leg against the same fixtures). Behavioural, so it runs on
// Linux and macOS; the golden suites themselves stay Linux-only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { realHomeGuard } from "./lib/real-home-guard.ts";
import { casesFor } from "./lib/setup-golden-all.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import type { CaseResult } from "./lib/setup-golden-run.ts";
import type { Cli, GoldenCase } from "./lib/setup-golden-types.ts";
import type { SetupSandbox } from "./lib/setup-sandbox.ts";
import { hasJq } from "./lib/setup-stubs.ts";

const skip =
  process.platform !== "linux"
    ? "the sandbox stubs assume the Linux pipx layout and systemd"
    : hasJq()
      ? undefined
      : "a real jq is required";

function cell(cli: Cli, id: string): GoldenCase {
  const found = casesFor(cli).find((c) => c.id === id);
  assert.ok(found, `golden cell ${cli}/${id} does not exist`);
  return found;
}

/** Run a golden cell on the TypeScript entry; the real home is fingerprinted around the run. */
async function run(c: GoldenCase): Promise<CaseResult> {
  const guard = realHomeGuard();
  try {
    return await runSetupCase(c, "ts");
  } finally {
    guard.assertUnchanged();
  }
}

const paths = (r: CaseResult): string[] =>
  r.tree.filter((e) => e.kind !== "removed").map((e) => e.path);
const landed = (r: CaseResult, p: string): boolean => paths(r).includes(p);

describe("legacy GEMINI.md cleanup", { skip }, () => {
  // Pin: goldens gemini/legacy-gemini-md-marker, gemini/legacy-gemini-md-no-marker,
  // antigravity/legacy-gemini-md-with-marker, antigravity/legacy-gemini-md-without-marker.
  const LEGACY = "<HOME>/.gemini/GEMINI.md";
  const matrix: ReadonlyArray<readonly [Cli, string, string, string]> = [
    [
      "gemini",
      "legacy-gemini-md-marker",
      "legacy-gemini-md-no-marker",
      "<HOME>/.gemini/00_SOUL.md",
    ],
    [
      "antigravity",
      "legacy-gemini-md-with-marker",
      "legacy-gemini-md-without-marker",
      "<HOME>/.gemini/antigravity-cli/00_SOUL.md",
    ],
  ];
  for (const [cli, withMarker, withoutMarker, witness] of matrix) {
    // Vacuity guard of every case: status 0 and the setup's own context file landed, so a run that
    // did nothing (and so removed nothing) cannot pass the "removed" assertion.
    it(`${cli}: a CrewRig-generated GEMINI.md (crewrig-section marker) is deleted`, async () => {
      const r = await run(cell(cli, withMarker));
      assert.equal(r.status, 0, r.stderr);
      assert.ok(landed(r, witness), `the run did not install ${witness}`);
      assert.ok(!landed(r, LEGACY), "the marked GEMINI.md is still there");
    });
    it(`${cli}: a custom GEMINI.md without the marker is preserved`, async () => {
      const r = await run(cell(cli, withoutMarker));
      assert.equal(r.status, 0, r.stderr);
      assert.ok(landed(r, witness), `the run did not install ${witness}`);
      assert.ok(landed(r, LEGACY), "the operator's GEMINI.md was deleted");
    });
    it(`${cli}: an absent GEMINI.md completes cleanly and creates none`, async () => {
      const { seed: _seed, ...unseeded } = cell(cli, withMarker);
      const r = await run(unseeded);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(landed(r, witness), `the run did not install ${witness}`);
      assert.ok(!landed(r, LEGACY), "the run created a GEMINI.md");
    });
  }
});

describe("overlay tiers", { skip }, () => {
  // Pin: goldens <cli>/overlay-yes and <cli>/overlay-no (the shell leg of the same cells). The
  // `tiers` step installs the library tier unconditionally and each overlay tier (community, org)
  // only on its own yes/no question; a tier is offered when its built directory exists.
  const skillsRoot: Record<Cli, string> = {
    claude: "<HOME>/.claude/skills",
    gemini: "<HOME>/.gemini/skills",
    copilot: "<HOME>/.copilot/skills",
    antigravity: "<HOME>/.gemini/config/skills",
  };
  // The library tier is staged by `ensure_tier_built` (the build runs in the sandbox); the overlay
  // tiers are seeded as `<tier>-demo` (Claude, Gemini) / `<tier>-skill` (Copilot, Antigravity).
  const demo = (cli: Cli, tier: string): string =>
    `${skillsRoot[cli]}/${tier}-${cli === "copilot" || cli === "antigravity" ? "skill" : "demo"}`;
  for (const cli of ["claude", "gemini", "copilot", "antigravity"] as const) {
    it(`${cli}: yes installs the community and org components`, async () => {
      const r = await run(cell(cli, "overlay-yes"));
      assert.equal(r.status, 0, r.stderr);
      for (const tier of ["community", "org"])
        assert.ok(
          landed(r, `${demo(cli, tier)}/SKILL.md`),
          `${tier} did not land at ${demo(cli, tier)}`,
        );
    });
    it(`${cli}: no installs neither overlay tier and says so`, async () => {
      const r = await run(cell(cli, "overlay-no"));
      assert.equal(r.status, 0, r.stderr);
      for (const tier of ["community", "org"]) {
        // Vacuity guard: the overlay question was reached and declined (the skip line), so an absent
        // tier below is a decision of the step and not a run that never got there.
        assert.match(r.stdout, new RegExp(`'${tier}'( skills)? install skipped\\.`), tier);
        assert.ok(!landed(r, `${demo(cli, tier)}/SKILL.md`), `${tier} landed without opt-in`);
      }
    });
  }
});

describe("claude install mechanics", { skip }, () => {
  // Spec 0201 R10-R12, formerly asserted on `install_tier_to_home` extracted from the shell text.
  // Pin: goldens claude/overlay-yes (the shell leg installs the same staged tiers through the real
  // function). The org tier is staged with one agent; a stale nested agent directory and two decoys
  // are seeded BEFORE the run (seeding after it would test nothing).
  const org = (sb: SetupSandbox, rel: string, text: string): void => {
    const file = path.join(sb.repo, "dist/org/.claude", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const withAgent =
    (stale: boolean) =>
    (sb: SetupSandbox): void => {
      cell("claude", "overlay-yes").seed?.(sb);
      org(sb, "agents/demo-org-agent.md", "---\nname: demo-org-agent\n---\nbody\n");
      const agents = path.join(sb.home, ".claude/agents");
      fs.mkdirSync(path.join(agents, "unrelated-agent"), { recursive: true });
      fs.writeFileSync(path.join(agents, "unrelated-agent/AGENT.md"), "unrelated\n");
      fs.writeFileSync(path.join(agents, "operator-note.md"), "operator note\n");
      if (stale) {
        fs.mkdirSync(path.join(agents, "demo-org-agent"), { recursive: true });
        fs.writeFileSync(path.join(agents, "demo-org-agent/AGENT.md"), "stale nested content\n");
      }
    };
  const A = "<HOME>/.claude/agents";
  it("R10: an opted-in org agent lands as a flat file; R11: the stale same-name directory is removed; R12: unrelated entries stay", async () => {
    const r = await run({ ...cell("claude", "overlay-yes"), seed: withAgent(true) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(landed(r, `${A}/demo-org-agent.md`), "the org agent is not a flat file");
    assert.equal(r.tree.find((e) => e.path === `${A}/demo-org-agent.md`)?.kind, "file");
    assert.ok(
      !paths(r).some((p) => p.startsWith(`${A}/demo-org-agent/`)),
      "stale directory kept (R11)",
    );
    assert.ok(landed(r, `${A}/operator-note.md`), "operator-note.md was removed (R12)");
    assert.ok(landed(r, `${A}/unrelated-agent/AGENT.md`), "unrelated-agent/ was removed (R12)");
  });
  it("R11 no-op clause: an install into a HOME with no stale directory exits 0 and places the file", async () => {
    const r = await run({ ...cell("claude", "overlay-yes"), seed: withAgent(false) });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(landed(r, `${A}/demo-org-agent.md`));
  });
});

describe("antigravity tier install failure", { skip }, () => {
  // Pin: golden antigravity/tier-install-failure (the shell leg of the same cell: a library tier
  // staging a skill directory with no SKILL.md, so `install_antigravity_tier_to_home` fails and the
  // setup's `|| exit 1` aborts). The ts leg must do the same, and nothing after the tier step runs.
  it("a library skill that cannot be placed aborts non-zero before any later step", async () => {
    const r = await run(cell("antigravity", "tier-install-failure"));
    assert.notEqual(r.status, 0, "an install failure did not abort the setup");
    assert.match(r.stderr, /ERROR: tier 'library' staged 1 skill\(s\) and placed none/);
    // The steps before the tier install ran (vacuity guard: the failure is the tier's, not an
    // early abort) ...
    assert.match(
      r.stdout,
      /Installing library components to .*\.gemini\/config\/skills \(automatic\)/,
    );
    assert.ok(landed(r, "<HOME>/.gemini/antigravity-cli/00_SOUL.md"));
    // ... and nothing after it did: no completion banner, no later prompt, no migration output.
    assert.doesNotMatch(r.stdout, /Setup complete/);
    assert.doesNotMatch(
      r.stdout,
      /Antigravity CLI usage capture|session recording|install skipped/,
    );
    assert.deepEqual(
      r.fzfRecords.filter((q) => /session recording|usage capture|components to/i.test(q.header)),
      [],
      "a later step asked its question after the failure",
    );
  });
});

describe("antigravity install call sites", { skip }, () => {
  // Spec 0116 delta-01 R24: not only that the deployment is reached but what it is reached WITH.
  // Pin: goldens antigravity/antigravity-superseded-migration (library tier -> skills root, then the
  // migration with the superseded root and the artifacts root) and antigravity/overlay-yes (the
  // overlay call passes the overlay tier), run against the shell by the golden suite.
  const SKILLS = "<HOME>/.gemini/config/skills";
  it("the library install passes the tier and the skills root; the migration passes the superseded root and the artifacts root", async () => {
    const r = await run(cell("antigravity", "antigravity-superseded-migration"));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      landed(r, `${SKILLS}/pin-skill/SKILL.md`),
      "the library skill missed the skills root",
    );
    // The superseded copy is gone (it was seeded before the run, so only the migration removes it).
    assert.ok(
      !paths(r).some((p) => p.startsWith("<HOME>/.gemini/antigravity-cli/skills/pin-skill")),
    );
    assert.match(r.stdout, /Migrated away: <HOME>\/\.gemini\/antigravity-cli\/skills\/pin-skill/);
  });
  it("the migration runs whichever way the overlay questions were answered", async () => {
    for (const id of ["overlay-yes", "overlay-no"]) {
      const r = await run(cell("antigravity", id));
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Migrating components left at the superseded placement/, id);
    }
  });
});
