// build-components-resources.test.ts — R15 (skill resources) and R16 (modes) of spec 0250, and
// review finding v1-F3, over scripts/lib/build-components/resources.ts.
//
// v1-F3 is the distinction the modes below pin: a non-`.md` resource is `cp`: a new copy takes the
// SOURCE mode masked by the umask; a `.md` resource is `sed >`: a new copy takes `0666 & ~umask`
// and ignores the source mode, with the link rewrite and no other normalisation; the execute rule
// then adds `0o111 & ~umask` for an executable source and never clears a bit. Enumeration is the
// whole path list sorted in code-unit order (the shell's `sort` under a UTF-8 locale on macOS is
// case-insensitive: only the order of `Generated:` lines differs). The shell's own
// `propagate_skill_resources` is the oracle of the parity set (Linux, or CREWRIG_SHELL_PARITY=1,
// with bash and mikefarah yq), read out of scripts/build-components.sh with awk, never copied.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { copyResource, propagateSkillResources } from "../lib/build-components/resources.ts";
import { makeCtx, modeOf, tempDir, withUmask } from "./fixtures/build-components/ctx-kit.ts";
import {
  LINKS,
  LINKS_REWRITTEN,
  SKILL_FILES,
  snapshot,
  writeSkill,
} from "./fixtures/build-components/skill-fixture.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const POSIX = process.platform === "win32" ? "skipped: file modes and links are POSIX" : false;
/** The expected listing: folder order, then whole-path code-unit order within a folder. */
const ORDER = [
  ".hidden",
  "B.txt",
  "a-b.txt",
  "a.txt",
  "a/b.txt",
  "lib/Zed.txt",
  "lib/alpha.txt",
  "links.txt",
  "run.sh",
]
  .map((rel) => `scripts/${rel}`)
  .concat(
    ["UPPER.MD", "doc.md", "sub/two.md", "tool.md"].map((rel) => `references/${rel}`),
    ["bad.md", "blob.bin", "empty.txt"].map((rel) => `assets/${rel}`),
  );

interface Run {
  readonly skill: string;
  readonly out: string;
  readonly lines: string[];
  readonly drift: boolean;
}
/** Build the fixture skill and propagate it (umask `mask`), into `out` or a fresh directory. */
function propagate(
  mask: number,
  opts: { out?: string; check?: boolean; compare?: boolean } = {},
): Run {
  const skill = tempDir();
  writeSkill(skill);
  const out = opts.out ?? path.join(tempDir(), "out");
  return withUmask(mask, () => {
    const kit = makeCtx({ check: opts.check ?? false, compare: opts.compare ?? true });
    propagateSkillResources(kit.ctx, skill, out, out);
    return { skill, out, lines: kit.out, drift: kit.ctx.state.driftFound };
  });
}
const read = (run: Run, rel: string): Buffer => fs.readFileSync(path.join(run.out, rel));
const src = (rel: string): Buffer => {
  const found = SKILL_FILES.find((f) => f.rel === rel);
  assert.ok(found, rel);
  return Buffer.from(found.content);
};

describe("R15 propagateSkillResources, write", () => {
  test("lists scripts, references, assets in that order, each in whole-path code-unit order", () => {
    const run = propagate(0o022);
    assert.deepEqual(
      run.lines,
      ORDER.map((rel) => `  Generated: ${path.join(run.out, rel)}`),
    );
  });

  test("only the three resource folders travel; other files and folders do not", () => {
    const run = propagate(0o022);
    assert.ok(!fs.existsSync(path.join(run.out, "SKILL.md")));
    assert.ok(!fs.existsSync(path.join(run.out, "README.md")));
    assert.ok(!fs.existsSync(path.join(run.out, "notes")));
  });

  test("dotfiles are included; an empty file and a binary blob are copied byte for byte", () => {
    const run = propagate(0o022);
    assert.equal(read(run, "scripts/.hidden").toString(), "h\n");
    assert.deepEqual(read(run, "assets/blob.bin"), src("assets/blob.bin"));
    assert.equal(read(run, "assets/empty.txt").length, 0);
  });

  test("a .md resource has its links rewritten and nothing else changed: CRLF, no final LF, bad UTF-8", () => {
    const run = propagate(0o022);
    assert.equal(read(run, "references/doc.md").toString(), `a\r\n${LINKS_REWRITTEN}b`);
    assert.equal(
      read(run, "references/sub/two.md").toString(),
      LINKS_REWRITTEN.replaceAll("\r\n", "\n"),
    );
    assert.deepEqual(
      read(run, "assets/bad.md"),
      Buffer.concat([Buffer.from([0xff, 0xfe, 0]), Buffer.from(LINKS_REWRITTEN)]),
    );
  });

  test("any other file keeps its bytes, links and CRLF included, even UPPER.MD", () => {
    const run = propagate(0o022);
    assert.equal(read(run, "scripts/links.txt").toString(), `x\r\n${LINKS}`);
    assert.equal(read(run, "references/UPPER.MD").toString(), LINKS);
  });

  test("rewrites stale copies over existing files and leaves other files in place", () => {
    const out = path.join(tempDir(), "out");
    fs.mkdirSync(path.join(out, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(out, "scripts", "a.txt"), "stale");
    fs.writeFileSync(path.join(out, "scripts", "extra.txt"), "mine");
    const run = propagate(0o022, { out });
    assert.equal(read(run, "scripts/a.txt").toString(), "a\n");
    assert.equal(read(run, "scripts/extra.txt").toString(), "mine");
  });

  test("a skill with no resource folder, an empty one, or a file called scripts writes nothing", () => {
    const skill = tempDir();
    fs.mkdirSync(path.join(skill, "references"));
    fs.writeFileSync(path.join(skill, "scripts"), "a file, not a folder");
    const kit = makeCtx();
    const out = path.join(tempDir(), "out");
    propagateSkillResources(kit.ctx, skill, out, out);
    assert.deepEqual(kit.out, []);
    assert.ok(!fs.existsSync(out));
  });
});

describe("R15 links are neither followed nor copied", { skip: POSIX }, () => {
  test("a link to a file, a link to a directory and a dangling link are skipped", () => {
    const run = propagate(0o022);
    const rows = snapshot(run.out);
    assert.ok(!rows.some((r) => /link-to|dangling/.test(r)), rows.join("\n"));
    assert.ok(!rows.some((r) => r.startsWith("D scripts/link-to-dir")));
  });

  test("a resource folder that is itself a link counts as empty", () => {
    const skill = tempDir();
    writeSkill(
      skill,
      SKILL_FILES.filter((f) => f.rel.startsWith("scripts/") && !f.rel.includes("/lib/")),
      false,
    );
    const elsewhere = tempDir();
    fs.writeFileSync(path.join(elsewhere, "x.md"), "x");
    fs.symlinkSync(elsewhere, path.join(skill, "references"), "dir");
    const kit = makeCtx();
    const out = path.join(tempDir(), "out");
    propagateSkillResources(kit.ctx, skill, out, out);
    assert.ok(
      kit.out.length > 0 && kit.out.every((l) => l.includes(`${path.sep}scripts${path.sep}`)),
    );
    assert.ok(!fs.existsSync(path.join(out, "references")));
  });
});

/** v1-F3 and R16 as a rule: what mode a new copy of `rel` gets under `mask`. */
function expectedMode(rel: string, mask: number): number {
  const file = SKILL_FILES.find((f) => f.rel === rel);
  assert.ok(file, rel);
  const base = rel.endsWith(".md") ? 0o666 : file.mode;
  const created = base & ~mask & 0o777;
  return (file.mode & 0o100) !== 0 ? created | (0o111 & ~mask) : created;
}

describe("R15/R16 modes (v1-F3)", { skip: POSIX }, () => {
  for (const mask of [0o022, 0o002, 0o077]) {
    test(`every new copy gets the mode the shell's cp or sed gave, under umask ${mask.toString(8).padStart(3, "0")}`, () => {
      const run = propagate(mask);
      for (const rel of ORDER) {
        const source = rel.endsWith(".md") ? "md" : "other";
        assert.equal(
          modeOf(path.join(run.out, rel)),
          expectedMode(rel, mask),
          `${rel} (${source})`,
        );
      }
    });
  }

  test("literal spot checks: a .md copy ignores a 0600 source; cp keeps it; the exec rule adds +x", () => {
    const run = propagate(0o022);
    assert.equal(modeOf(path.join(run.out, "references/sub/two.md")), 0o644, "md, source 0600");
    assert.equal(modeOf(path.join(run.out, "scripts/a/b.txt")), 0o600, "cp, source 0600");
    assert.equal(modeOf(path.join(run.out, "references/tool.md")), 0o755, "md, source 0755");
    assert.equal(modeOf(path.join(run.out, "scripts/run.sh")), 0o755);
  });

  test("a rewritten copy keeps its mode; the exec rule adds bits and never clears one", () => {
    const out = path.join(tempDir(), "out");
    for (const [rel, existing] of [
      ["scripts/a.txt", 0o600],
      ["scripts/run.sh", 0o644],
      ["references/doc.md", 0o777],
    ] as const) {
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.writeFileSync(path.join(out, rel), "stale");
      fs.chmodSync(path.join(out, rel), existing);
    }
    const run = propagate(0o022, { out });
    assert.equal(modeOf(path.join(out, "scripts/a.txt")), 0o600, "kept");
    assert.equal(
      modeOf(path.join(out, "scripts/run.sh")),
      0o755,
      "0644 + execute bits of an executable source",
    );
    assert.equal(modeOf(path.join(out, "references/doc.md")), 0o777, "no bit cleared");
    assert.equal(read(run, "scripts/a.txt").toString(), "a\n");
  });

  test("on Windows the execute rule is a no-op", () => {
    withUmask(0o077, () => {
      const kit = makeCtx({ platform: "win32" });
      const root = tempDir();
      const dest = path.join(root, "run.sh");
      const source = path.join(tempDir(), "run.sh");
      fs.writeFileSync(source, "x");
      fs.chmodSync(source, 0o755);
      copyResource(kit.ctx, source, dest, root);
      assert.equal(modeOf(dest), 0o700, "created 0755 & ~077, no +x added");
    });
  });
});

describe("R15 --check on a drift-compared tier", () => {
  test("equal copies are silent; missing and differing ones are DRIFT lines in listing order", () => {
    const first = propagate(0o022);
    const out = first.out;
    fs.rmSync(path.join(out, "scripts/a.txt"));
    fs.writeFileSync(path.join(out, "assets/blob.bin"), "changed");
    fs.writeFileSync(path.join(out, "references/doc.md"), src("references/doc.md"));
    const before = snapshot(out);
    const run = propagate(0o022, { out, check: true });
    assert.deepEqual(run.lines, [
      `DRIFT: ${path.join(out, "scripts/a.txt")} does not exist (expected from source)`,
      `DRIFT: ${path.join(out, "references/doc.md")} differs from source`,
      `DRIFT: ${path.join(out, "assets/blob.bin")} differs from source`,
    ]);
    assert.ok(run.drift);
    assert.deepEqual(snapshot(out), before, "--check writes nothing");
  });

  test("a clean tree is silent, and a core .md resource is compared after its rewrite", () => {
    const out = propagate(0o022).out;
    const run = propagate(0o022, { out, check: true });
    assert.deepEqual(run.lines, []);
    assert.equal(run.drift, false);
  });

  test("a tier that is not drift-compared takes the write branch under --check", () => {
    const run = propagate(0o022, { check: true, compare: false });
    assert.equal(run.lines.length, ORDER.length);
    assert.ok(run.lines.every((l) => l.startsWith("  Generated: ")));
  });
});

const noShell = parityGate();
const SCRIPT = path.join(REPO, "scripts", "build-components.sh");
const DRIVER = `set -euo pipefail
eval "$(awk '/^propagate_skill_resources\\(\\) \\{/,/^\\}/' "$1")"
CHECK_MODE=false; CHECK_COMPARE=true; DRIFT_FOUND=false
propagate_skill_resources "$2" "$3"`;

describe("shell parity: propagate_skill_resources", { skip: noShell ?? POSIX }, () => {
  for (const mask of [0o022, 0o002, 0o077]) {
    test(`the tree, its modes and the Generated lines equal the shell's under umask ${mask.toString(8).padStart(3, "0")}`, () => {
      const skill = tempDir();
      writeSkill(skill);
      const shellOut = path.join(tempDir(), "out");
      const sh = withUmask(mask, () =>
        spawnSync("bash", ["-c", DRIVER, "bash", SCRIPT, skill, shellOut], {
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C" },
        }),
      );
      assert.equal(sh.status, 0, sh.stderr);
      const twin = propagate(mask);
      assert.deepEqual(snapshot(twin.out), snapshot(shellOut));
      assert.equal(
        `${twin.lines.map((l) => l.replace(twin.out, "<OUT>")).join("\n")}\n`,
        sh.stdout.replaceAll(shellOut, "<OUT>"),
      );
    });
  }
});
