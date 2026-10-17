// antigravity-manage-sandbox.test.ts — scripts/manage-antigravity-component.sh run in a sandbox
// repository (G19-G21 of test-antigravity-component-install.sh, spec 0263): the per-component
// migration sweeps only the names the run placed, and a placement-less install migrates nothing.
// G17/G18 (declarations) are asserted by print-manage-declarations.test.ts. POSIX-only: the entry
// is the bash shim and the sandbox PATH is a symlink farm.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

import { stageSkill } from "./lib/antigravity-fixtures.ts";
import { createInstallSandbox, runEntry } from "./lib/install-sandbox.ts";
import { REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const NPM_HINT = "run 'npm ci --omit=dev --workspaces=false' first";

describe("manage-antigravity-component sandbox", { skip: SKIP_POSIX }, () => {
  before(() => {
    for (const pkg of ["js-yaml", "argparse"])
      assert.ok(
        fs.existsSync(path.join(REPO, "node_modules", pkg)),
        `the sandbox run needs node_modules/${pkg}: ${NPM_HINT}`,
      );
  });

  it("G19/G20: the sweep reaches only the placed name, and a placement-less install migrates nothing", () => {
    const sb = createInstallSandbox();
    const { tree, home } = sb;
    tree.write(".gitignore", "dist/\ncli-home*/\npackage.json\nnode_modules/\n");
    const lib = tree.resolve("artifacts/library");
    stageSkill(lib, "fx-served");
    stageSkill(lib, "fx-other");
    stageSkill(tree.resolve("dist/library/.agents"), "fx-served");
    const sup = path.join(home, ".gemini/antigravity-cli");
    stageSkill(sup, "fx-served");
    stageSkill(sup, "fx-other");
    stageSkill(sup, "fx-user-notes", false);
    const notes = path.join(sup, "skills/fx-user-notes");
    fs.writeFileSync(path.join(notes, "notes.txt"), "keep me\n");
    const readNotes = (): string =>
      fs.readFileSync(path.join(notes, "SKILL.md"), "utf8") +
      fs.readFileSync(path.join(notes, "notes.txt"), "utf8");
    const before = readNotes();

    const first = runEntry(sb, "manage-antigravity-component", [
      "install",
      "antigravity-skills",
      "fx-served",
    ]);
    // Precondition: a run that placed nothing proves nothing below.
    assert.equal(first.status, 0, first.stderr);
    assert.ok(fs.existsSync(path.join(home, ".gemini/config/skills/fx-served/SKILL.md")));
    assert.ok(first.stdout.includes("Copied: fx-served"), first.stdout);
    assert.ok(!fs.existsSync(path.join(sup, "skills/fx-served")), "fx-served survives superseded");
    assert.match(first.stdout, /Migrated away[\s\S]*fx-served/);
    assert.ok(fs.existsSync(path.join(sup, "skills/fx-other/SKILL.md")));
    assert.equal(readNotes(), before);

    // Nothing placed, nothing migrated.
    tree.remove("artifacts/library/skills/fx-served");
    tree.remove("artifacts/library/skills/fx-other");
    tree.remove("dist/library/.agents/skills/fx-served");
    tree.write("artifacts/library/skills/.gitkeep", "");
    tree.write("dist/library/.agents/skills/.gitkeep", "");
    const second = runEntry(sb, "manage-antigravity-component", ["install", "antigravity-skills"]);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.ok(!second.stdout.includes("Migrated away"), second.stdout);
    assert.ok(fs.existsSync(path.join(sup, "skills/fx-other/SKILL.md")));
  });
});
