// setup-steps-rules-edge.test.ts — the branches of the rules steps the golden cells do not reach:
// the `find` semantics of the existing listing, the profile resolution, the optional org rules and
// the fail-closed policy of the bare writes. A temporary home and repository stand in for the real ones.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { listExisting } from "../lib/setup/steps-rules.ts";
import {
  PICKS,
  VALIDATION,
  box,
  rulesDescriptor,
  runRules,
  useRulesSandbox,
} from "./setup-steps-rules-fixtures.ts";

useRulesSandbox();
const posix = { skip: process.platform === "win32" };

describe("rules-existing", posix, () => {
  test("lists regular files and links by glob, in the manner of find -maxdepth 1 -type f -o -type l", () => {
    const dir = path.join(box.root, "list");
    fs.mkdirSync(path.join(dir, "sub.md"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a.md"), "");
    fs.writeFileSync(path.join(dir, ".hidden.md"), "");
    fs.writeFileSync(path.join(dir, "b.txt"), "");
    fs.writeFileSync(path.join(dir, "10_x.md"), "");
    fs.symlinkSync(path.join(dir, "missing"), path.join(dir, "dangling.md"));
    assert.deepEqual(listExisting(dir, "*.md").sort(), [
      ".hidden.md",
      "10_x.md",
      "a.md",
      "dangling.md",
    ]);
    assert.deepEqual(listExisting(dir, "[0-9][0-9]_*.md"), ["10_x.md"]);
    assert.deepEqual(listExisting(dir, "*.instructions.md"), []);
  });

  test("a rules directory that is itself a link lists nothing, so nothing is asked", async () => {
    const real = path.join(box.root, "real");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "00-soul.md"), "");
    fs.mkdirSync(path.join(box.home, ".claude"));
    fs.symlinkSync(real, path.join(box.home, ".claude", "rules"));
    const result = await runRules(rulesDescriptor("claude", ["rules-existing"]));
    assert.equal(result.status, 0);
    assert.equal(result.out, "");
  });

  test("Copilot creates its instructions directory here (mkdirInExisting); the others do not", async () => {
    assert.equal((await runRules(rulesDescriptor("copilot", ["rules-existing"]))).status, 0);
    assert.ok(fs.statSync(path.join(box.home, ".copilot", "instructions")).isDirectory());
    assert.equal((await runRules(rulesDescriptor("claude", ["rules-existing"]))).status, 0);
    assert.ok(!fs.existsSync(path.join(box.home, ".claude")));
  });

  test("without an answer on a closed input the question fails closed (exit 2) and nothing is removed", async () => {
    fs.mkdirSync(path.join(box.home, ".claude", "rules"), { recursive: true });
    fs.writeFileSync(path.join(box.home, ".claude", "rules", "00-soul.md"), "");
    const result = await runRules(rulesDescriptor("claude", ["rules-existing"]));
    assert.equal(result.status, 2);
    assert.ok(fs.existsSync(path.join(box.home, ".claude", "rules", "00-soul.md")));
  });

  test("refresh deletes only the files the glob matches", async () => {
    const dir = path.join(box.home, ".gemini");
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ["00_SOUL.md", "notes.md", "settings.json"])
      fs.writeFileSync(path.join(dir, name), "");
    const result = await runRules(rulesDescriptor("gemini", ["rules-existing"]), [
      "rules-action=refresh",
    ]);
    assert.equal(result.status, 0);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["notes.md", "settings.json"]);
  });
});

describe("rules-shared", posix, () => {
  test("the org rules are placed after the store when AGENTS.org.md exists, and skipped otherwise", async () => {
    const without = await runRules(rulesDescriptor("gemini", ["rules-shared"]), VALIDATION);
    assert.ok(!without.out.includes("66_ORG_RULES"));
    fs.writeFileSync(path.join(box.repo, "AGENTS.org.md"), "# org\n");
    const withOrg = await runRules(rulesDescriptor("gemini", ["rules-shared"]), VALIDATION);
    const lines = withOrg.out.split("\n").filter((l) => l.startsWith("  Copied"));
    assert.deepEqual(lines.slice(3, 6), [
      "  Copied dir: artifacts/core/system-context -> ~/.crewrig/system-context",
      "  Copied: AGENTS.org.md -> 66_ORG_RULES.md",
      "  Copied: SOUL.md -> 00_SOUL.md",
    ]);
    assert.equal(
      fs.readFileSync(path.join(box.home, ".gemini", "66_ORG_RULES.md"), "utf8"),
      "# org\n",
    );
  });

  test("Claude never places org rules; a store missing from the list is placed after the last entry", async () => {
    fs.writeFileSync(path.join(box.repo, "AGENTS.org.md"), "# org\n");
    const d = rulesDescriptor("claude", ["rules-shared"]);
    const result = await runRules(
      {
        ...d,
        rules: { ...d.rules, shared: d.rules.shared.filter((r) => r.src !== d.rules.store.src) },
      },
      VALIDATION,
    );
    const lines = result.out.split("\n").filter((l) => l.startsWith("  Copied"));
    assert.equal(lines.length, 5);
    assert.match(lines[4] ?? "", /^ {2}Copied dir: artifacts\/core\/system-context/);
    assert.ok(!result.out.includes("66_ORG_RULES"));
  });
});

describe("rules-selection: the profile", posix, () => {
  const profile = (): string => path.join(box.home, ".claude", "rules", "30-profile.md");
  const src = (): string => path.join(box.repo, "config", "PROFILE.md");
  const select = (answers: string[]) =>
    runRules(rulesDescriptor("claude", ["rules-selection"]), [...PICKS, ...answers]);

  test("a profile equal to the repository one prints that it is up to date", async () => {
    fs.mkdirSync(path.dirname(profile()), { recursive: true });
    fs.copyFileSync(src(), profile());
    const result = await select([]);
    assert.ok(result.out.endsWith("Level: CONFIRMED\n\nProfile is up to date.\n"));
  });

  test("a differing profile asks profile-method: keep-local leaves it, overwrite moves it to .ori", async () => {
    fs.mkdirSync(path.dirname(profile()), { recursive: true });
    fs.writeFileSync(profile(), "local\n");
    const kept = await select(["profile-method=keep-local"]);
    assert.match(
      kept.out,
      /Local profile differs from repository version\.\n.*\nKeeping local profile\.\n$/s,
    );
    assert.equal(fs.readFileSync(profile(), "utf8"), "local\n");
    const over = await select(["profile-method=overwrite"]);
    assert.ok(
      over.out.endsWith("  Copied: PROFILE.md -> rules/30-profile.md (backup saved as .ori)\n"),
    );
    assert.equal(fs.readFileSync(`${profile()}.ori`, "utf8"), "local\n");
    assert.deepEqual(fs.readFileSync(profile()), fs.readFileSync(src()));
  });

  test("Copilot (direct) asks nothing about the profile and prints none of its lines", async () => {
    const result = await runRules(rulesDescriptor("copilot", ["rules-selection"]), PICKS);
    assert.ok(!result.out.includes("profile"));
    assert.ok(
      !fs.existsSync(path.join(box.home, ".copilot", "instructions", "30-profile.instructions.md")),
    );
  });
});

describe("rules-selection: markers and the fail-closed policy", posix, () => {
  test("the marker holds the entry name and a line feed; a skipped kind removes it", async () => {
    const result = await runRules(rulesDescriptor("claude", ["rules-selection"]), [
      "catalogue.team=ATLAS",
      "catalogue.expertise=",
      "catalogue.level=",
    ]);
    assert.equal(result.status, 0);
    assert.equal(
      fs.readFileSync(path.join(box.home, ".claude", ".selected_team"), "utf8"),
      "ATLAS\n",
    );
    assert.ok(!fs.existsSync(path.join(box.home, ".claude", ".selected_expertise")));
  });

  test("an unwritable marker prints one Error line and exits 1", async () => {
    fs.mkdirSync(path.join(box.home, ".claude", ".selected_team"), { recursive: true });
    const result = await runRules(rulesDescriptor("claude", ["rules-selection"]), PICKS);
    assert.equal(result.status, 1);
    assert.match(result.err, /^Error: cannot write .*\.selected_team: .+\n$/);
  });

  test("after keep, the selection step prints and writes nothing", async () => {
    fs.mkdirSync(path.join(box.home, ".claude", "rules"), { recursive: true });
    fs.writeFileSync(path.join(box.home, ".claude", "rules", "00-soul.md"), "");
    const steps = ["rules-existing", "rules-selection"] as const;
    const result = await runRules(rulesDescriptor("claude", steps), ["rules-action=keep"]);
    assert.equal(result.status, 0);
    assert.ok(!result.out.includes("Select your"));
    assert.deepEqual(fs.readdirSync(path.join(box.home, ".claude")).sort(), ["rules"]);
  });
});
