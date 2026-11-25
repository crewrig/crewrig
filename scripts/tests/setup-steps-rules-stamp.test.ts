// setup-steps-rules-stamp.test.ts — the deployed rules and store are stamped copies (spec 0316
// R11, R12): the marker bytes, link mode, a reinstall over a linked install, the fail-closed paths.
// A temporary home and a private artifacts tree stand in for the real ones.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  VALIDATION,
  box,
  rulesDescriptor,
  runRules,
  useRulesSandbox,
} from "./setup-steps-rules-fixtures.ts";

useRulesSandbox();
const posix = { skip: process.platform === "win32" };

// Spec 0316 R11, R12: a deployed rule or store file is a stamped copy, in copy and in link mode.
describe("rules-shared: stamped copies (spec 0316 R11, R12)", posix, () => {
  const sourceFiles = (): string[] => {
    const out: string[] = [];
    for (const dir of ["rules", "system-context"]) {
      const abs = path.join(box.repo, "artifacts", "core", dir);
      for (const name of fs.readdirSync(abs)) out.push(path.join(abs, name));
    }
    return out.sort();
  };
  const snapshot = (): string[] => sourceFiles().map((f) => `${f}\n${fs.readFileSync(f, "utf8")}`);

  /** A private artifacts tree: a stamped installer must never be able to touch the real sources. */
  function privateArtifacts(): void {
    const real = fs.realpathSync(path.join(box.repo, "artifacts"));
    fs.unlinkSync(path.join(box.repo, "artifacts"));
    for (const dir of ["rules", "system-context", "claude-profiles"]) {
      fs.cpSync(path.join(real, "core", dir), path.join(box.repo, "artifacts", "core", dir), {
        recursive: true,
      });
    }
  }
  const first = (file: string): string => fs.readFileSync(file, "utf8").split("\n")[0] ?? "";
  const MARKER =
    /^<!-- crewrig-provenance: package="crewrig" version="1\.0\.0" canonical="https:\/\/[^"]+" feedback="https:\/\/[^"]+" -->$/;
  const deployed = (): string[] => [
    path.join(box.home, ".claude", "rules", "60-tools.md"),
    path.join(box.home, ".claude", "rules", "60-memory.md"),
    ...fs
      .readdirSync(path.join(box.home, ".crewrig", "system-context"))
      .map((n) => path.join(box.home, ".crewrig", "system-context", n)),
  ];

  for (const link of [false, true]) {
    test(`${link ? "link" : "copy"} mode: first line is the marker, the authored block is gone`, async () => {
      privateArtifacts();
      const result = await runRules(
        rulesDescriptor("claude", ["rules-shared"]),
        VALIDATION,
        "",
        link ? ["--link"] : [],
      );
      assert.equal(result.status, 0, result.err);
      assert.equal(result.err, "");
      assert.equal(deployed().length, 7);
      for (const file of deployed()) {
        assert.ok(MARKER.test(first(file)), `${file}: ${first(file)}`);
        assert.ok(!fs.lstatSync(file).isSymbolicLink(), `${file} must be a copy`);
        const text = fs.readFileSync(file, "utf8");
        assert.ok(!text.includes("provenance:\n  version"), `${file} keeps the authored block`);
        assert.ok(!text.includes("${CANONICAL_REPO}"));
      }
      assert.ok(!fs.lstatSync(path.join(box.home, ".crewrig", "system-context")).isSymbolicLink());
      assert.match(result.out, /Copied: artifacts\/core\/rules\/60-tools\.md/);
      assert.match(result.out, /Copied dir: artifacts\/core\/system-context/);
    });
  }

  test("a reinstall over a LINKED install leaves the sources byte-identical (v1-F2)", async () => {
    privateArtifacts();
    const before = snapshot();
    // The previous install: links into the repository, as on the maintainer's machine.
    fs.mkdirSync(path.join(box.home, ".claude", "rules"), { recursive: true });
    fs.mkdirSync(path.join(box.home, ".crewrig"), { recursive: true });
    for (const name of ["60-tools.md", "60-memory.md"]) {
      fs.symlinkSync(
        path.join(box.repo, "artifacts", "core", "rules", name),
        path.join(box.home, ".claude", "rules", name),
      );
    }
    fs.symlinkSync(
      path.join(box.repo, "artifacts", "core", "system-context"),
      path.join(box.home, ".crewrig", "system-context"),
    );
    for (const link of [true, false]) {
      const result = await runRules(
        rulesDescriptor("claude", ["rules-shared"]),
        VALIDATION,
        "",
        link ? ["--link"] : [],
      );
      assert.equal(result.status, 0, result.err);
      assert.deepEqual(snapshot(), before);
      for (const file of deployed()) assert.ok(!fs.lstatSync(file).isSymbolicLink());
    }
  });

  test("a source without an authored version fails the step, names the file and places nothing", async () => {
    privateArtifacts();
    const file = path.join(box.repo, "artifacts", "core", "system-context", "obsidian-protocol.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/ {2}version: "[^"]*"\n/, ""));
    const result = await runRules(rulesDescriptor("claude", ["rules-shared"]), VALIDATION);
    assert.equal(result.status, 1);
    assert.match(result.err, /obsidian-protocol\.md/);
    assert.match(result.err, /version/);
    assert.ok(!fs.existsSync(path.join(box.home, ".claude", "rules", "60-tools.md")));
    assert.ok(!fs.existsSync(path.join(box.home, ".crewrig")));
  });

  test("a malformed crewrig.config.toml fails closed instead of throwing", async () => {
    privateArtifacts();
    fs.writeFileSync(path.join(box.repo, "crewrig.config.toml"), "bad-key = x\n");
    const result = await runRules(rulesDescriptor("claude", ["rules-shared"]), VALIDATION);
    assert.equal(result.status, 1);
    assert.match(result.err, /^Error: cannot stamp the rules/m);
  });

  test("without a crewrig.config.toml the placeholders stay literal and nothing is printed", async () => {
    privateArtifacts();
    fs.rmSync(path.join(box.repo, "crewrig.config.toml"));
    const result = await runRules(rulesDescriptor("claude", ["rules-shared"]), VALIDATION);
    assert.equal(result.status, 0, result.err);
    assert.equal(result.err, "");
    const line = first(path.join(box.home, ".claude", "rules", "60-tools.md"));
    assert.equal(
      line,
      '<!-- crewrig-provenance: package="crewrig" version="1.0.0" canonical="${CANONICAL_REPO}" feedback="${CANONICAL_REPO}" -->',
    );
  });

  test("a marker already present in a source is replaced, not duplicated (R6)", async () => {
    privateArtifacts();
    const file = path.join(box.repo, "artifacts", "core", "rules", "60-tools.md");
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      text.replace(
        "-->\n\n",
        '-->\n\n<!-- crewrig-provenance: package="stale" version="0.0.1" -->\n',
      ),
    );
    const result = await runRules(rulesDescriptor("claude", ["rules-shared"]), VALIDATION);
    assert.equal(result.status, 0, result.err);
    const out = fs.readFileSync(path.join(box.home, ".claude", "rules", "60-tools.md"), "utf8");
    assert.equal(out.split("crewrig-provenance:").length, 2);
    assert.ok(!out.includes("stale"));
  });

  test("claude-profiles is still placed by installDir, never stamped (v1-F1)", async () => {
    privateArtifacts();
    const d = rulesDescriptor("claude", ["home-dirs"]);
    const profiles = {
      src: "artifacts/core/claude-profiles",
      dest: ".claude/profiles",
      label: "artifacts/core/claude-profiles -> ~/.claude/profiles",
    };
    const withDirs = { ...d, rules: { ...d.rules, homeDirs: [profiles] } };
    const copied = await runRules(withDirs);
    assert.equal(copied.status, 0, copied.err);
    assert.match(copied.out, /Copied dir: artifacts\/core\/claude-profiles/);
    const linked = await runRules(withDirs, [], "", ["--link"]);
    assert.equal(linked.status, 0, linked.err);
    assert.match(linked.out, /Linked dir: artifacts\/core\/claude-profiles/);
    assert.ok(fs.lstatSync(path.join(box.home, ".claude", "profiles")).isSymbolicLink());
  });
});
