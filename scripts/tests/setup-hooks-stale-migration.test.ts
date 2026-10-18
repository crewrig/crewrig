// setup-hooks-stale-migration.test.ts — spec 0268 R1-R8 (ticket #1725): one setup run per CLI over
// a pre-#1715 hook registration (every framework entry still the removed `.sh` form, a stale and a
// current entry on one event, foreign hooks) migrates it BEFORE any question, whatever the answers.
//
// Harness: `runSetup` of scripts/lib/setup/flow.ts with the three hook steps only, an injected
// spawner (nothing is ever executed) and a `mkdtemp` root that holds the HOME and a stand-in
// checkout with only the `.ts` siblings. Nothing outside that root is read or written. The
// fixtures are scripts/tests/fixtures/hooks-stale/<cli>.json; `@REPO@` and `@HOME@` stand for the
// stand-in checkout and home.
//
// The no-answer run ends at the later `transcripts` question (`NoAnswerError`, exit 2); no case
// asserts that a run finishes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  type Cli,
  FOREIGN_VIEWER,
  backupsOf,
  readJson,
  STALE,
  frameworkEntries,
  install,
  run,
  snapshot,
  staleLeft,
  strings,
  world,
} from "./setup-hooks-stale-harness.ts";

const CLIS: Cli[] = ["claude", "gemini", "copilot", "antigravity"];

for (const cli of CLIS) {
  describe(`stale .sh migration — ${cli}`, () => {
    test("(a) a run with no terminal and no answer migrates every framework entry and reports it (R1, R2, R4, R5, R8)", async () => {
      const fx = install(cli);
      const before = snapshot();
      assert.ok(staleLeft().length >= 3, "fixture must hold stale entries");

      const res = await run(cli);

      // R1/R2: nothing framework-owned is left on the removed shell form, with no answer given.
      assert.deepEqual(staleLeft(), [], `stale .sh entries still registered:\n${res.text}`);
      // R4: one entry per hook per event (the stale+current pair collapsed).
      const entries = frameworkEntries(fx.file);
      assert.equal(
        new Set(entries).size,
        entries.length,
        `duplicate framework entries: ${entries.join("\n")}`,
      );
      // R5: foreign hooks and every other key are byte-identical in meaning.
      const after = readJson(fx.file) as Record<string, unknown>;
      const original = JSON.parse(before.get(fx.primary) ?? "{}") as Record<string, unknown>;
      if (cli !== "antigravity") {
        const { hooks: _a, ...restAfter } = after;
        const { hooks: _b, ...restBefore } = original;
        assert.deepEqual(restAfter, restBefore);
      }
      const foreignOf = (cfg: unknown): string[] =>
        strings(cfg).filter((s) => s.includes("ORCA_AGENT_HOOK_PORT") || s === FOREIGN_VIEWER);
      assert.deepEqual(foreignOf(after), foreignOf(original), "foreign hooks changed");
      if (cli === "antigravity") {
        const agy = path.join(world.home, ".gemini/antigravity-cli/settings.json");
        const settings = readJson(agy) as { statusLine: { command: string }; other: number };
        assert.equal(settings.other, 1);
        assert.match(settings.statusLine.command, /antigravity-statusline-shim\.ts/);
        assert.doesNotMatch(settings.statusLine.command, /\.sh/);
        const marker = readJson(
          path.join(world.home, ".crewrig/usage/state/antigravity-statusline.json"),
        ) as Record<string, string>;
        assert.equal(marker["installedStatusLineCommand"], settings.statusLine.command);
      }
      // R6: a backup was made before the first write.
      assert.ok(backupsOf(fx.file).length >= 1, "no backup of the rewritten file");
      // R8: every migrated entry is reported, usage capture and statusLine.command included.
      const wanted = cli === "antigravity" ? ["antigravity-statusline-shim"] : ["usage-capture"];
      for (const script of [...wanted, "mempalace-transcript", "worktree-git-guard"]) {
        assert.ok(
          res.text.split("\n").some((l) => /rewrote/.test(l) && l.includes(script)),
          `no report line for ${script}:\n${res.text}`,
        );
      }
      if (cli === "claude") {
        assert.match(res.text, /No longer used \(left on disk\).*mempalace-transcript\.sh/);
        assert.ok(fs.existsSync(path.join(world.home, ".claude/hooks/mempalace-transcript.sh")));
      }
    });

    test("(b) a second run leaves every file byte-identical and makes no backup (R3)", async () => {
      install(cli);
      await run(cli);
      assert.deepEqual(staleLeft(), [], "run 1 must migrate before run 2 is meaningful");
      const first = snapshot();
      await run(cli);
      const second = snapshot();
      assert.deepEqual(
        [...second.keys()].sort(),
        [...first.keys()].sort(),
        "a file appeared (backup?)",
      );
      for (const [rel, bytes] of first) assert.equal(second.get(rel), bytes, `${rel} changed`);
    });

    test("(c) a later explicit remove still recognises the migrated direct form", async () => {
      const fx = install(cli);
      await run(cli);
      assert.deepEqual(staleLeft(), [], "run 1 must migrate before remove is meaningful");
      const migrated = snapshot();
      const res = await run(cli, { answers: ["transcripts=no", "usage-capture-keep=remove"] });
      assert.notEqual(
        migrated.get(cli === "antigravity" ? ".gemini/antigravity-cli/settings.json" : fx.primary),
        snapshot().get(
          cli === "antigravity" ? ".gemini/antigravity-cli/settings.json" : fx.primary,
        ),
        `remove changed nothing:\n${res.text}`,
      );
      if (cli === "antigravity") {
        const settings = readJson(
          path.join(world.home, ".gemini/antigravity-cli/settings.json"),
        ) as Record<string, unknown>;
        assert.equal(
          (settings["statusLine"] as { command?: string } | undefined)?.command,
          undefined,
        );
        assert.equal(settings["other"], 1);
        assert.ok(
          !fs.existsSync(path.join(world.home, ".crewrig/usage/state/antigravity-statusline.json")),
        );
      } else {
        const left = strings(readJson(fx.file)).filter((s) =>
          /hooks\/usage-capture\.(ts|sh)/.test(s),
        );
        assert.deepEqual(left, [], "usage-capture entries survived remove");
        assert.ok(strings(readJson(fx.file)).includes(FOREIGN_VIEWER), "foreign hook removed");
      }
    });

    test("(d) a Node floor failure leaves the file as it is and lists each stale entry (R7)", async () => {
      const fx = install(cli);
      const before = snapshot();
      const res = await run(cli, { floorFails: true });
      const after = snapshot();
      for (const [rel, bytes] of before) assert.equal(after.get(rel), bytes, `${rel} changed`);
      assert.equal(after.size, before.size, "a file was written");
      const stale = strings(readJson(fx.file))
        .filter((s) => STALE.test(s))
        .map(
          (s) => /(usage-capture|mempalace-transcript|worktree-git-guard)\.sh/.exec(s)?.[0] ?? "",
        )
        .filter((s) => s !== "");
      const scripts = [...new Set(stale)];
      if (cli === "antigravity") scripts.push("antigravity-statusline-shim.sh");
      for (const script of scripts) {
        assert.ok(
          res.text.split("\n").some((l) => l.includes(script)),
          `stale ${script} not listed:\n${res.text}`,
        );
      }
      assert.ok(
        cli === "antigravity"
          ? /statusLine/.test(res.text)
          : /Stop|AfterModel|agentStop/.test(res.text),
        `events/statusLine not listed:\n${res.text}`,
      );
    });

    test("(e) a hook file that is not JSON is left unchanged and the reason is reported (R6)", async () => {
      const fx = install(cli);
      fs.writeFileSync(fx.file, "this is { not json\n");
      const before = snapshot();
      const res = await run(cli);
      assert.equal(fs.readFileSync(fx.file, "latin1"), before.get(fx.primary));
      assert.equal(backupsOf(fx.file).length, 0);
      assert.match(res.text, /not a JSON|not valid JSON|invalid JSON/i);
    });
  });
}
