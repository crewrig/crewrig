// build-components-write.test.ts — R14 (output bytes) and R16 (modes) of spec 0250, and the
// `--check` decision of R9, over scripts/lib/build-components/write.ts.
//
// `checkOrWrite` and `finalizeText` run against hand-built contexts (fixtures/build-components/
// ctx-kit.ts) and the real `js-yaml`. The shell's own `check_or_write` is the oracle of the
// parity set: it runs on Linux or with CREWRIG_SHELL_PARITY=1 (bash and mikefarah yq needed),
// the functions read out of scripts/build-components.sh with awk, never copied.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { checkOrWrite, finalizeText } from "../lib/build-components/write.ts";
import { makeCtx, modeOf, tempDir, withUmask } from "./fixtures/build-components/ctx-kit.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const config = (...entries: [string, string][]) => ({
  placeholders: entries.map(([key, value]) => ({ key, value })),
  canonicalRepo: "",
});
const bytes = (file: string): string => fs.readFileSync(file, "utf8");
const POSIX = process.platform === "win32" ? "skipped: file modes are POSIX" : false;

describe("R14 finalizeText: the bytes of a generated file", () => {
  const rows: [string, string, string][] = [
    ["no trailing line feed gets exactly one", "a", "a\n"],
    ["trailing line feeds collapse to one", "a\n\n\n", "a\n"],
    ["empty content is one line feed", "", "\n"],
    ["only line feeds is one line feed", "\n\n", "\n"],
    ["inner and leading blank lines are kept", "\n\na\n\nb\n", "\n\na\n\nb\n"],
    ["CRLF text becomes LF", "a\r\nb\r\n", "a\nb\n"],
    ["a trailing CRLF cannot leave two line feeds", "a\r\n\r\n", "a\n"],
    ["a lone CR is a line ending", "a\rb", "a\nb\n"],
    ["spaces before the end are kept", "a  \n", "a  \n"],
  ];
  for (const [name, input, want] of rows) test(name, () => assert.equal(finalizeText(input), want));
});

describe("R14 checkOrWrite, write mode", () => {
  test("writes the finalised bytes, creating parents, and announces the file", () => {
    const { ctx, out } = makeCtx();
    const root = tempDir();
    const file = path.join(root, "a", "b", "out.md");
    checkOrWrite(ctx, file, "x\r\ny\n\n\n", null, root);
    assert.equal(bytes(file), "x\ny\n");
    assert.deepEqual(out, [`  Generated: ${file}`]);
    assert.equal(ctx.state.driftFound, false);
  });

  test("empty content writes one line feed", () => {
    const { ctx } = makeCtx();
    const root = tempDir();
    const file = path.join(root, "e.md");
    checkOrWrite(ctx, file, "", null, root);
    assert.equal(bytes(file), "\n");
  });

  test("placeholder values are literal: & | \\ $ and a backreference-looking text", () => {
    const value = "a&b|c\\d$e\\1$&";
    const { ctx } = makeCtx({ config: config(["K", value]) });
    const root = tempDir();
    const file = path.join(root, "p.md");
    checkOrWrite(ctx, file, "<${K}> and ${K}", null, root);
    assert.equal(bytes(file), `<${value}> and ${value}\n`);
  });

  const SOURCE = [
    "---",
    "name: x",
    "metadata:",
    "  provenance:",
    "    version: 1.0",
    '    canonical: "${CANONICAL_REPO}"',
    "---",
    "body",
  ].join("\n");
  const OUTPUT = "---\nname: x\ndescription: d\n---\nBody ---\n---";

  test("a source's provenance is spliced before the second --- line, then placeholders resolve", () => {
    const kit = makeCtx({ config: config(["CANONICAL_REPO", "https://h/o/r"]) });
    const root = tempDir();
    const file = path.join(root, "s.md");
    checkOrWrite(kit.ctx, file, OUTPUT, kit.open(SOURCE), root);
    assert.equal(
      bytes(file),
      [
        "---",
        "name: x",
        "description: d",
        "metadata:",
        "  provenance:",
        '    version: "1.0"',
        '    canonical: "https://h/o/r"',
        "---",
        "Body ---",
        "---",
        "",
      ].join("\n"),
    );
  });

  test("no source, or a source without provenance, splices nothing", () => {
    const kit = makeCtx();
    const plain = kit.open("---\nname: x\n---\nb");
    const root = tempDir();
    const a = path.join(root, "a.md");
    const b = path.join(root, "b.md");
    checkOrWrite(kit.ctx, a, OUTPUT, null, root);
    checkOrWrite(kit.ctx, b, OUTPUT, plain, root);
    assert.equal(bytes(a), `${OUTPUT}\n`);
    assert.equal(bytes(b), `${OUTPUT}\n`);
  });

  test("fewer than two --- lines: the output is unchanged by a provenance source", () => {
    const kit = makeCtx();
    const root = tempDir();
    const file = path.join(root, "f.md");
    checkOrWrite(kit.ctx, file, "---\nonly one", kit.open(SOURCE), root);
    assert.equal(bytes(file), "---\nonly one\n");
  });
});

describe("R9 checkOrWrite, --check on a drift-compared tier", () => {
  const check = () => makeCtx({ check: true });

  test("a missing file is DRIFT, nothing is written", () => {
    const { ctx, out } = check();
    const root = tempDir();
    const file = path.join(root, "m.md");
    checkOrWrite(ctx, file, "x", null, root);
    assert.deepEqual(out, [`DRIFT: ${file} does not exist (expected from source)`]);
    assert.equal(ctx.state.driftFound, true);
    assert.ok(!fs.existsSync(file));
  });

  test("a target that is a directory is reported as missing, as [ -f ] did", () => {
    const { ctx, out } = check();
    const root = tempDir();
    const dir = path.join(root, "sub");
    fs.mkdirSync(dir);
    checkOrWrite(ctx, dir, "x", null, root);
    assert.deepEqual(out, [`DRIFT: ${dir} does not exist (expected from source)`]);
  });

  test("equal bytes print nothing and set no drift", () => {
    const { ctx, out } = check();
    const root = tempDir();
    const file = path.join(root, "q.md");
    fs.writeFileSync(file, "x\ny\n");
    checkOrWrite(ctx, file, "x\r\ny\n\n", null, root);
    assert.deepEqual(out, []);
    assert.equal(ctx.state.driftFound, false);
  });

  test("the comparison is exact: a missing final LF, an extra LF, CRLF and one byte all differ", () => {
    for (const onDisk of ["x", "x\n\n", "x\r\n", "y\n", "x \n"]) {
      const { ctx, out } = check();
      const root = tempDir();
      const file = path.join(root, "d.md");
      fs.writeFileSync(file, onDisk);
      checkOrWrite(ctx, file, "x", null, root);
      assert.deepEqual(out, [`DRIFT: ${file} differs from source`], JSON.stringify(onDisk));
      assert.equal(ctx.state.driftFound, true);
      assert.equal(bytes(file), onDisk, "--check never writes");
    }
  });

  test("a tier that is not drift-compared takes the write branch even under --check", () => {
    const { ctx, out } = makeCtx({ check: true, compare: false });
    const root = tempDir();
    const file = path.join(root, "n.md");
    checkOrWrite(ctx, file, "x", null, root);
    assert.equal(bytes(file), "x\n");
    assert.deepEqual(out, [`  Generated: ${file}`]);
  });

  test("drift is sticky: a later equal file does not clear it", () => {
    const { ctx } = check();
    const root = tempDir();
    checkOrWrite(ctx, path.join(root, "gone.md"), "x", null, root);
    const ok = path.join(root, "ok.md");
    fs.writeFileSync(ok, "x\n");
    checkOrWrite(ctx, ok, "x", null, root);
    assert.equal(ctx.state.driftFound, true);
  });
});

describe("R16 modes of generated files", { skip: POSIX }, () => {
  for (const [mask, want] of [
    [0o022, 0o644],
    [0o002, 0o664],
    [0o077, 0o600],
  ] as const) {
    test(`a new file is 0666 & ~umask under umask ${mask.toString(8).padStart(3, "0")}`, () => {
      withUmask(mask, () => {
        const { ctx } = makeCtx();
        const root = tempDir();
        const file = path.join(root, "new.md");
        checkOrWrite(ctx, file, "x", null, root);
        assert.equal(modeOf(file), want);
      });
    });
  }

  test("a rewritten file keeps its existing mode, whatever the umask", () => {
    for (const existing of [0o600, 0o640, 0o755]) {
      withUmask(0o022, () => {
        const { ctx } = makeCtx();
        const root = tempDir();
        const file = path.join(root, "old.md");
        fs.writeFileSync(file, "stale");
        fs.chmodSync(file, existing);
        checkOrWrite(ctx, file, "fresh", null, root);
        assert.equal(bytes(file), "fresh\n");
        assert.equal(modeOf(file), existing);
      });
    }
  });
});

const noShell = parityGate();
const SCRIPT = path.join(REPO, "scripts", "build-components.sh");
const FUNCTIONS =
  "load_crewrig_config|resolve_placeholders|provenance_block|inject_provenance|extract_frontmatter|check_or_write";
const DRIVER = `set -euo pipefail
eval "$(awk '/^(${FUNCTIONS})\\(\\) \\{/,/^\\}/' "$1")"
CFG_KEYS=""; CHECK_MODE="$4"; CHECK_COMPARE=true; DRIFT_FOUND=false
load_crewrig_config
content="$(cat; printf x)"; content="\${content%x}"
check_or_write "$2" "$content" "$3"`;

describe("shell parity: check_or_write", { skip: noShell ?? false }, () => {
  const TOML = 'k = "a&b|c\\d$e"\ncanonical_repo = "https://h/o/r"\n';
  const SRC =
    '---\nname: x\nmetadata:\n  provenance:\n    version: 2\n    canonical: "${CANONICAL_REPO}"\n---\nb\n';
  const contents = [
    "a",
    "a\n\n\n",
    "",
    "\n",
    "x ${K} y ${K}",
    "---\nn: 1\n---\nbody",
    "---\nn: 1\n---\nb\n---\n",
  ];

  for (const [name, source] of [
    ["no source", false],
    ["a provenance source", true],
  ] as const) {
    test(`write mode, ${name}: the file holds the shell's bytes`, () => {
      for (const content of contents) {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, "crewrig.config.toml"), TOML);
        const srcFile = path.join(dir, "src.md");
        fs.writeFileSync(srcFile, SRC);
        const target = path.join(dir, "out", "shell.md");
        const sh = spawnSync(
          "bash",
          ["-c", DRIVER, "bash", SCRIPT, target, source ? srcFile : "", "false"],
          {
            input: content,
            encoding: "utf8",
            env: { ...process.env, REPO_DIR: dir, LC_ALL: "C" },
          },
        );
        assert.equal(sh.status, 0, sh.stderr);
        const kit = makeCtx({
          config: config(["K", "a&b|c\\d$e"], ["CANONICAL_REPO", "https://h/o/r"]),
        });
        const twin = path.join(dir, "out", "twin.md");
        checkOrWrite(kit.ctx, twin, content, source ? kit.open(SRC) : null, dir);
        assert.equal(bytes(twin), bytes(target), JSON.stringify(content));
        assert.equal(kit.out[0], `  Generated: ${twin}`);
        assert.equal(sh.stdout, `  Generated: ${target}\n`);
      }
    });
  }

  test("--check: missing, differs, equal and directory give the shell's DRIFT lines", () => {
    const dir = tempDir();
    const targets = ["missing.md", "differs.md", "equal.md", "dir"].map((n) => path.join(dir, n));
    fs.writeFileSync(targets[1] as string, "other\n");
    fs.writeFileSync(targets[2] as string, "same\n");
    fs.mkdirSync(targets[3] as string);
    for (const target of targets) {
      const sh = spawnSync("bash", ["-c", DRIVER, "bash", SCRIPT, target, "", "true"], {
        input: "same",
        encoding: "utf8",
        env: { ...process.env, REPO_DIR: dir, LC_ALL: "C" },
      });
      const { ctx, out } = makeCtx({ check: true });
      checkOrWrite(ctx, target, "same", null, dir);
      assert.equal(`${out.map((l) => `${l}\n`).join("")}`, sh.stdout, target);
    }
  });
});
