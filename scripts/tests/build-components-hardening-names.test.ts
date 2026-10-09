// build-components-hardening-names.test.ts — requirement 35 of spec 0250 delta 01, as units: the
// refusal of a component name that holds a control character or a `..` segment (`componentName`,
// tiers.ts), and the defence in depth behind it (`assertInsideRoot` and the three writers that call
// it, write.ts and resources.ts). The runs through the entry are in
// build-components-hardening-names-e2e.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { escapeControl } from "../lib/build-components/diagnostics.ts";
import { copyResource, propagateSkillResources } from "../lib/build-components/resources.ts";
import { componentName } from "../lib/build-components/tiers.ts";
import { BuildFailure } from "../lib/build-components/types.ts";
import { assertInsideRoot, checkOrWrite } from "../lib/build-components/write.ts";
import { makeCtx, tempDir } from "./fixtures/build-components/ctx-kit.ts";
import { namedSource } from "./fixtures/build-components/hardening-kit.ts";

/** What `fn` throws, which must be a `BuildFailure`. */
function refusal(fn: () => unknown): BuildFailure {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BuildFailure, `${String(error)}`);
    return error;
  }
  return assert.fail("expected a BuildFailure");
}

describe("R35 componentName refuses a control character", () => {
  const rows: [string, string][] = [
    ["NUL", "a\u0000b"],
    ["tab", "a\tb"],
    ["line feed", "a\nb"],
    ["carriage return", "a\rb"],
    ["U+001F, the last of the range", "a\u001fb"],
    ["DEL", "a\u007fb"],
    ["a control character at the very start", "\u0001a"],
    ["a control character at the very end", "a\u001b"],
  ];
  for (const [label, name] of rows) {
    test(label, () => {
      const kit = makeCtx();
      const source = kit.open(namedSource(name));
      const failure = refusal(() => componentName(kit.ctx, source));
      assert.equal(failure.exitCode, 1);
      assert.deepEqual(kit.out, [], "no Building line, no warning");
    });
  }
});

describe("R35 componentName refuses a `..` segment, split on / and on \\", () => {
  for (const name of [
    "..",
    "../x",
    "x/..",
    "a/../b",
    "..\\..\\x",
    "a\\..\\b",
    "a/..\\b",
    "../../../../x",
  ]) {
    test(JSON.stringify(name), () => {
      const kit = makeCtx();
      const source = kit.open(namedSource(name));
      assert.equal(refusal(() => componentName(kit.ctx, source)).exitCode, 1);
    });
  }
});

describe("R35 the refusal names the source and the name, control characters escaped", () => {
  test("the Error line carries no control character", () => {
    const kit = makeCtx();
    const source = kit.open(namedSource("x\n::error title=Injected::forged\u0000\t\u007f"));
    const { message } = refusal(() => componentName(kit.ctx, source));
    assert.equal(
      message,
      `Error: ${source.file}: the component name 'x\\x0a::error title=Injected::forged\\x00\\x09\\x7f' ` +
        "is not allowed (control character or '..' path segment).",
    );
    assert.doesNotMatch(message, /[\u0000-\u001f\u007f]/);
  });

  test("a name with a `..` segment is shown as written", () => {
    const kit = makeCtx();
    const source = kit.open(namedSource("../../esc"));
    assert.equal(
      refusal(() => componentName(kit.ctx, source)).message,
      `Error: ${source.file}: the component name '../../esc' is not allowed ` +
        "(control character or '..' path segment).",
    );
  });

  test(
    "the source path is escaped too: a directory named with a line feed cannot forge a line",
    { skip: process.platform === "win32" ? "a file name cannot hold a line feed on win32" : false },
    () => {
      const kit = makeCtx();
      const dir = path.join(tempDir(), "d\n::error::forged");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "SKILL.md"), namedSource("../esc"));
      const { message } = refusal(() =>
        componentName(kit.ctx, kit.ctx.fm.open(path.join(dir, "SKILL.md"))),
      );
      assert.match(message, /^Error: \S+\/d\\x0a::error::forged\/SKILL\.md: the component name /);
      assert.doesNotMatch(message, /[\u0000-\u001f\u007f]/);
    },
  );

  test("escapeControl writes lower-case two-digit hex and touches nothing else", () => {
    assert.equal(escapeControl("\u0000\u000a\u001f\u007f"), "\\x00\\x0a\\x1f\\x7f");
    assert.equal(escapeControl("a b~\u0080é\\"), "a b~\u0080é\\");
  });
});

describe("R35 no other constraint is placed on a name", () => {
  for (const name of [
    "a..b",
    "v2..3",
    "..x",
    "x..",
    "...",
    ".hidden",
    "a b/c",
    "a/./b",
    "ns/tool",
    "a\\b",
    "my-skill",
    "a~b",
    "a\u0080b",
    "É",
  ]) {
    test(JSON.stringify(name), () => {
      const kit = makeCtx();
      assert.equal(componentName(kit.ctx, kit.open(namedSource(name))), name);
    });
  }

  test("an absent or null name is still skipped with the warning, never refused", () => {
    const kit = makeCtx();
    const source = kit.open("---\ndescription: d\n---\nb\n");
    assert.equal(componentName(kit.ctx, source), null);
    assert.deepEqual(kit.out, [`Warning: ${source.file} missing 'name' field, skipping`]);
  });
});

describe("R35 assertInsideRoot: strictly under the root", () => {
  const posix = { platform: "linux" } as const;
  const win = { platform: "win32" } as const;
  const inside = (ctx: typeof posix | typeof win, root: string, target: string): void =>
    assert.doesNotThrow(() => assertInsideRoot(ctx, root, target), target);
  const outside = (ctx: typeof posix | typeof win, root: string, target: string): void => {
    const failure = refusal(() => assertInsideRoot(ctx, root, target));
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.message, `Error: refusing to write outside the output root: ${target}`);
  };

  test("a file below the root, nested, with a trailing separator on the root, is accepted", () => {
    inside(posix, "/r/out", "/r/out/a");
    inside(posix, "/r/out", "/r/out/a/b/c.md");
    inside(posix, "/r/out/", "/r/out/a");
    inside(posix, "/r/out", "/r/out/a/b/../c");
  });

  test("the root itself, with or without a trailing separator, is refused", () => {
    outside(posix, "/r/out", "/r/out");
    outside(posix, "/r/out", "/r/out/");
    outside(posix, "/r/out/", "/r/out");
    outside(posix, "/r/out", "/r/out/a/..");
  });

  test("a sibling that shares the root as a name prefix is refused", () => {
    outside(posix, "/r/out", "/r/out-evil/x");
    outside(posix, "/r/out", "/r/outx");
    outside(posix, "/r/out", "/r/out.md");
  });

  test("a `..` escape, the parent, and the filesystem root are refused", () => {
    outside(posix, "/r/out", "/r/out/../x");
    outside(posix, "/r/out", "/r/out/a/../../x");
    outside(posix, "/r/out", "/r");
    outside(posix, "/r/out", "/");
  });

  test("a root that is the filesystem root: only what is below it is accepted", () => {
    inside(posix, "/", "/etc/x");
    outside(posix, "/", "/");
    inside(win, "C:\\", "C:\\x");
    outside(win, "C:\\", "C:\\");
  });

  test("a posix path is case-sensitive", () => outside(posix, "/r/out", "/r/OUT/a"));

  test("win32: a target below the root is accepted whatever the case or the separator", () => {
    inside(win, "C:\\Out", "c:\\out\\A\\b.md");
    inside(win, "C:\\Out", "C:/Out/a");
    inside(win, "C:\\Out\\", "C:\\Out\\a");
  });

  test("win32: the root in any case, a `..` escape, a sibling prefix and another drive are refused", () => {
    outside(win, "C:\\Out", "C:\\OUT");
    outside(win, "C:\\Out", "c:\\out\\");
    outside(win, "C:\\Out", "C:\\Out\\..\\x");
    outside(win, "C:\\Out", "C:\\Outside\\x");
    outside(win, "C:\\Out", "D:\\Out\\a");
  });

  test("the path in the message has its control characters escaped", () => {
    const failure = refusal(() => assertInsideRoot(posix, "/r/out", "/x/\n::error::forged"));
    assert.equal(
      failure.message,
      "Error: refusing to write outside the output root: /x/\\x0a::error::forged",
    );
  });
});

describe("R35 the writers refuse a target outside the root they were given", () => {
  test("checkOrWrite: a sibling, the root itself and a `..` target; nothing read, written, created", () => {
    for (const check of [false, true]) {
      const { ctx, out } = makeCtx({ check });
      const root = tempDir();
      const other = tempDir();
      const escaped = `${root}/../${path.basename(other)}/deep/f.md`;
      for (const target of [path.join(other, "f.md"), root, escaped]) {
        assert.equal(refusal(() => checkOrWrite(ctx, target, "x", null, root)).exitCode, 1);
      }
      assert.deepEqual(fs.readdirSync(other), [], "the sibling is untouched");
      assert.deepEqual(fs.readdirSync(root), [], "the root is untouched");
      assert.deepEqual(out, [], "no Generated line and, under --check, no DRIFT line");
      assert.equal(ctx.state.driftFound, false);
    }
  });

  test("copyResource: a destination outside the root is not created", () => {
    const { ctx } = makeCtx();
    const root = tempDir();
    const other = tempDir();
    const src = path.join(tempDir(), "r.txt");
    fs.writeFileSync(src, "x");
    for (const dest of [
      path.join(other, "r.txt"),
      `${root}/../r-${path.basename(root)}.txt`,
      root,
    ]) {
      assert.equal(refusal(() => copyResource(ctx, src, dest, root)).exitCode, 1);
    }
    assert.deepEqual(fs.readdirSync(other), []);
    assert.ok(!fs.existsSync(path.join(root, "..", `r-${path.basename(root)}.txt`)));
    assert.deepEqual(fs.readdirSync(root), []);
  });

  test("propagateSkillResources: a target folder outside the root receives nothing", () => {
    const skill = tempDir();
    fs.mkdirSync(path.join(skill, "scripts"));
    fs.writeFileSync(path.join(skill, "scripts", "a.sh"), "x");
    fs.writeFileSync(path.join(skill, "scripts", "b.sh"), "y");
    for (const check of [false, true]) {
      const { ctx, out } = makeCtx({ check });
      const root = tempDir();
      const other = tempDir();
      for (const targetDir of [
        other,
        `${root}/../${path.basename(other)}/x`,
        `${root}/../esc-${path.basename(root)}`,
      ]) {
        const failure = refusal(() => propagateSkillResources(ctx, skill, targetDir, root));
        assert.match(failure.message, /^Error: refusing to write outside the output root: /);
      }
      assert.deepEqual(fs.readdirSync(other), []);
      assert.ok(!fs.existsSync(path.join(root, "..", `esc-${path.basename(root)}`)));
      assert.deepEqual(out, []);
    }
  });
});
