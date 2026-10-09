// build-components-hardening-printed.test.ts — finding s3-F1 of the delta-01 review: every PATH the
// build prints is written with its control characters as lower-case `\xNN`, so a newline in a
// resource file name, a tier directory or a source directory cannot forge a GitHub Actions workflow
// command (`::error::`, `::add-mask::`) through an echoed line. End to end through the entry, in a
// fixture tree with an isolated TMPDIR. Files and directories keep their real names; only what is
// printed changes. Records of `--resolve` and what is written INTO files are out of scope.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createSandbox,
  namedSource,
  sourcePath,
} from "./fixtures/build-components/hardening-kit.ts";
import type { Sandbox } from "./fixtures/build-components/hardening-kit.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { RunResult } from "./lib/build-fixture-tree.ts";

const tree = createFixtureTree();
const SKIP = process.platform === "win32" ? "skipped: file names cannot hold a line feed" : false;
const lines = (text: string): string[] => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
const RAW = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** Both streams, line by line, as a CI log shows them. */
function streams(run: RunResult): string[] {
  return [...lines(run.stdout), ...lines(run.stderr)];
}

/** No line forges a workflow command and none holds a raw control character. */
function assertInert(run: RunResult): void {
  const all = streams(run);
  assert.deepEqual(
    all.filter((l) => l.startsWith("::")),
    [],
    "a line starting with ::",
  );
  assert.deepEqual(
    all.filter((l) => RAW.test(l)),
    [],
    "a raw control character",
  );
  assert.doesNotMatch(run.stdout + run.stderr, /\r/);
}

const sandbox = (): Sandbox => {
  const box = createSandbox(tree);
  box.seedMappings();
  return box;
};

describe("s3-F1 a resource file name", { skip: SKIP }, () => {
  const NAME = "a\n::error::forged.md";
  const setup = (): Sandbox => {
    const box = sandbox();
    box.write(sourcePath("core", "skill", "s"), namedSource("s"));
    box.write(`artifacts/core/skills/s/references/${NAME}`, "one\n");
    return box;
  };

  test("is built under its real name and printed escaped", () => {
    const box = setup();
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.ok(
      lines(run.stdout).includes(
        `  Generated: ${box.repo}/.claude/skills/s/references/a\\x0a::error::forged.md`,
      ),
      run.stdout,
    );
    assert.ok(box.inside().includes(`.claude/skills/s/references/${NAME}`), "real name on disk");
    assertInert(run);
  });

  test("--check: clean after a build, a DRIFT line with the escaped name after a change", () => {
    const box = setup();
    assert.equal(box.run(["--target", "claude"]).status, 0);
    const clean = box.run(["--target", "claude", "--check"]);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assertInert(clean);
    box.write(`artifacts/core/skills/s/references/${NAME}`, "two\n");
    const drift = box.run(["--target", "claude", "--check"]);
    assert.equal(drift.status, 1);
    assert.ok(
      lines(drift.stdout).includes(
        `DRIFT: ${box.repo}/.claude/skills/s/references/a\\x0a::error::forged.md differs from source`,
      ),
      drift.stdout,
    );
    assertInert(drift);
  });
});

describe("s3-F1 a directory name", { skip: SKIP }, () => {
  test("a tier directory: the Tier line shows the tier and the output root escaped", () => {
    const box = sandbox();
    box.write(sourcePath("evil\n::add-mask::x", "skill", "s"), namedSource("s"));
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const shown = "evil\\x0a::add-mask::x";
    assert.ok(
      lines(run.stdout).includes(`--- Tier: ${shown} (output root: ${box.repo}/dist/${shown}) ---`),
      run.stdout,
    );
    assertInert(run);
  });

  test("a source directory with no name: the Warning line is escaped", () => {
    const box = sandbox();
    box.write(sourcePath("core", "skill", "bad\n::x"), "---\ndescription: d\n---\nB\n");
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.ok(
      lines(run.stdout).includes(
        `Warning: ${box.repo}/artifacts/core/skills/bad\\x0a::x//SKILL.md missing 'name' field, skipping`,
      ),
      run.stdout,
    );
    assertInert(run);
  });

  test("a provenance mapping entry under such a directory: the Error line is escaped", () => {
    const box = sandbox();
    const source = namedSource("s", ["metadata:", "  provenance:", "    k:", "      a: b"]);
    box.write(sourcePath("core", "skill", "p\n::q"), source);
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 1);
    assert.ok(
      lines(run.stderr).includes(
        `Error: ${box.repo}/artifacts/core/skills/p\\x0a::q//SKILL.md: metadata.provenance.k is a mapping or a sequence; a provenance entry must be a scalar`,
      ),
      run.stderr,
    );
    assertInert(run);
  });

  test("--resolve on a source path that does not exist: the Error line is escaped", () => {
    const box = sandbox();
    const run = box.run(["--resolve", `${box.repo}/no\n::such/AGENT.md`, "claude"]);
    assert.equal(run.status, 2);
    const [error] = lines(run.stderr);
    assert.match(error ?? "", /^Error: cannot read --resolve source: .*no\\x0a::such\/AGENT\.md/);
    assertInert(run);
  });
});

describe("s3-F1 the configuration file", { skip: SKIP }, () => {
  test("an invalid key line names the key escaped", () => {
    const box = sandbox();
    box.write("crewrig.config.toml", "bad\u0001key = x\n");
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 1);
    assert.ok(
      lines(run.stderr).includes(
        `Error: ${box.repo}/crewrig.config.toml: line 1: 'bad\\x01key' is not a valid placeholder name (letters, digits and underscores only)`,
      ),
      run.stderr,
    );
    assertInert(run);
  });

  test("a malformed canonical_repo is shown escaped; the message keeps its own line feed", () => {
    const box = sandbox();
    box.write("crewrig.config.toml", "canonical_repo = https://x/y\u0001::error::forged\u001b\n");
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 1);
    assert.deepEqual(lines(run.stderr), [
      "Error: canonical_repo in crewrig.config.toml is malformed: 'https://x/y\\x01::error::forged\\x1b'",
      "Expected: https://<host>/<owner>/<repo> (no deeper path, no file:// scheme)",
    ]);
    assertInert(run);
  });
});

describe("s3-F1 the collision refusal", { skip: SKIP }, () => {
  test("name and sources are escaped, indented, one per line, with no forged line", () => {
    const box = sandbox();
    const raw = "---\nname: d\u0001p\ndescription: d\n---\nB\n";
    box.write(sourcePath("ov\n::error::a", "skill", "dup"), raw);
    box.write(sourcePath("ovb", "skill", "dup"), raw);
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 1, run.stdout);
    const err = lines(run.stderr);
    assert.ok(
      err.includes("Refusing 'd\\x01p': one installed name is claimed by more than one component."),
    );
    assert.ok(err.includes("Every source presenting it, in no significant order:"));
    const sources = err.filter((l) => l.startsWith("  - "));
    assert.ok(
      sources.some((l) => l.startsWith("  - tier 'ov\\x0a::error::a' declares a skills component")),
      sources.join("\n"),
    );
    assert.ok(
      sources.some((l) => l.startsWith("  - tier 'ovb' declares a skills component")),
      sources.join("\n"),
    );
    assertInert(run);
  });
});

describe("s3-F1 ordinary paths are printed byte for byte", () => {
  test("spaces and non-ASCII letters are untouched; the whole stdout is as before", () => {
    const box = sandbox();
    box.write("artifacts/core/skills/dir é/SKILL.md", namedSource("probe"));
    box.write("artifacts/core/skills/dir é/references/réf é.md", "x\n");
    const run = box.run(["--target", "claude"]);
    assert.equal(run.status, 0, run.stderr);
    const bar = "=".repeat(41);
    const skill = `${box.repo}/.claude/skills/probe`;
    assert.deepEqual(lines(run.stdout), [
      bar,
      "  Community Component Builder",
      "  Target: claude",
      "  Mode: BUILD (generate files)",
      bar,
      "",
      `--- Tier: core (output root: ${box.repo}) ---`,
      "Building skill: probe",
      `  Generated: ${skill}/SKILL.md`,
      `  Generated: ${skill}/references/réf é.md`,
      "",
      "Done.",
    ]);
    assert.equal(run.stderr, "");
  });
});
