// setup-steps-rules.test.ts — the rules steps (steps-rules.ts, steps-rules-pick.ts) against the
// golden cells of the four shells: the printed lines (the stdout of the steps, minus the
// prompter's `[answer]` echo, must appear verbatim in the golden stdout) and the written tree (the
// rules files, markers, store and validation.conf must be the golden paths). The questions are
// pre-answered with `--answer`; a temporary home and repository stand in for the real ones.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { CLIS } from "../lib/setup/context.ts";
import type { Cli } from "../lib/setup/context.ts";
import {
  PICKS,
  VALIDATION,
  box,
  golden,
  goldenRulesPaths,
  normalized,
  rulesData,
  rulesDescriptor,
  runRules,
  seedRule,
  useRulesSandbox,
  writtenRulesPaths,
} from "./setup-steps-rules-fixtures.ts";

useRulesSandbox();

const SEEDS: Readonly<Record<Cli, string>> = {
  claude: "00-soul.md",
  gemini: "00_SOUL.md",
  copilot: "99-custom.instructions.md",
  antigravity: "99_CUSTOM.md",
};
const cellOf = (cli: Cli, cell: string): string =>
  cell === "catalogue-pick-declined" && (cli === "copilot" || cli === "antigravity")
    ? "declined-catalogue-pick"
    : cell;

/** The existing + shared steps, then the selection, as two runs (the shells' prints are not contiguous). */
async function twoRuns(cli: Cli, first: string[], second: string[]) {
  const a = await runRules(rulesDescriptor(cli, ["rules-existing", "rules-shared"]), first);
  const b = await runRules(rulesDescriptor(cli, ["rules-selection"]), second);
  return { a, b, out: normalized(a.out) + normalized(b.out) };
}

function assertInGolden(cli: Cli, cell: string, ...parts: string[]): void {
  const text = golden(cli, cellOf(cli, cell));
  for (const part of parts) assert.ok(text.includes(part), `golden ${cli}/${cell} lacks:\n${part}`);
}

function assertTree(cli: Cli, cell: string): void {
  assert.deepEqual(writtenRulesPaths(cli).sort(), goldenRulesPaths(cli, cellOf(cli, cell)).sort());
}

for (const cli of CLIS) {
  describe(`rules steps: ${cli}`, { skip: process.platform === "win32" }, () => {
    test("default-answers: shared block, picks and profile print the golden lines and write the golden tree", async () => {
      const { a, b } = await twoRuns(cli, VALIDATION, PICKS);
      assert.equal(a.status, 0);
      assert.equal(b.status, 0);
      assertInGolden(cli, "default-answers", normalized(a.out), normalized(b.out));
      assertTree(cli, "default-answers");
    });

    test("rules-kept: the listing and the keep message, nothing written, the later steps skip", async () => {
      seedRule(cli, SEEDS[cli]);
      const keep = ["rules-action=keep"];
      const first = await runRules(
        rulesDescriptor(cli, ["rules-existing", "rules-shared", "rules-selection"]),
        keep,
      );
      assert.equal(first.status, 0);
      assertInGolden(cli, "rules-kept", normalized(first.out));
      assert.ok(fs.existsSync(path.join(box.home, rulesData(cli).homes.rulesDir, SEEDS[cli])));
      assert.ok(!fs.existsSync(path.join(box.home, ".crewrig")));
      assert.equal(first.err, "");
    });

    test("rules-refreshed: the existing files are deleted, the full flow runs", async () => {
      seedRule(cli, SEEDS[cli]);
      const { a, b } = await twoRuns(cli, ["rules-action=refresh", ...VALIDATION], PICKS);
      assert.equal(a.status, 0);
      assertInGolden(cli, "rules-refreshed", normalized(a.out), normalized(b.out));
      assertTree(cli, "rules-refreshed");
      assert.ok(!fs.existsSync(path.join(box.home, rulesData(cli).homes.rulesDir, "99_CUSTOM.md")));
    });

    test("empty-catalogue: no question, the notices on stderr, stale markers removed", async () => {
      // Claude and Gemini empty all three catalogues; Copilot and Antigravity only the teams.
      const all = cli === "claude" || cli === "gemini";
      for (const dir of all ? ["teams", "expertise", "level"] : ["teams"]) {
        for (const name of fs.readdirSync(path.join(box.repo, "config", dir))) {
          if (name.endsWith(".md")) fs.rmSync(path.join(box.repo, "config", dir, name));
        }
      }
      const home = rulesData(cli).homes.cliHome;
      fs.mkdirSync(path.join(box.home, home), { recursive: true });
      for (const kind of ["team", "expertise", "level"]) {
        fs.writeFileSync(path.join(box.home, home, `.selected_${kind}`), "STALE\n");
      }
      const picks = all ? [] : PICKS.slice(1);
      const { a, b } = await twoRuns(cli, VALIDATION, picks);
      assert.equal(a.status + b.status, 0);
      assertInGolden(cli, "empty-catalogue", normalized(a.out), normalized(b.out));
      assert.match(
        b.err,
        /No team catalogue entries found under .*config.teams — skipping team selection\./,
      );
      assert.equal(b.err.includes("No expertise catalogue"), all);
      assertTree(cli, "empty-catalogue");
      if (all) assertTree(cli, "empty-catalogue-stale-markers");
    });

    test("catalogue-pick-declined: the declined kinds print the notice and remove their marker", async () => {
      const picks =
        cli === "copilot" || cli === "antigravity"
          ? ["catalogue.level=", "catalogue.expertise=", "catalogue.team=ATLAS"]
          : ["catalogue.team=ATLAS", "catalogue.expertise=", "catalogue.level="];
      const { a, b } = await twoRuns(cli, VALIDATION, picks);
      assert.equal(a.status + b.status, 0);
      assertInGolden(cli, "catalogue-pick-declined", normalized(a.out), normalized(b.out));
      assert.ok(b.err.includes("No expertise selected — skipping expertise selection."));
      assert.ok(b.err.includes("No level selected — skipping level selection."));
      assertTree(cli, "catalogue-pick-declined");
    });
  });
}
