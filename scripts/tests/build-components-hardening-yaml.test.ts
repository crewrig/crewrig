// build-components-hardening-yaml.test.ts — requirement 34 of spec 0250 delta 01: a YAML document
// whose expanded size exceeds 100,000 nodes is refused, like an unparseable one, by a traversal
// that counts the expansion and never builds it.
//
// Units over scripts/lib/yaml-text.ts and the real `js-yaml`: the budget, the boundary (exactly
// 100,000 accepted, 100,001 refused, through aliases too), cycles, depth, the two trees `parse`
// measures, the readers of a refused document, and the real corpus (nothing the repository ships is
// refused). The end-to-end effects are in build-components-hardening-yaml-e2e.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { readTextLf } from "../lib/line-endings.ts";
import { frontmatterOfText } from "../lib/render-command.ts";
import { createYamlText, EXPANDED_NODE_LIMIT, exceedsExpandedLimit } from "../lib/yaml-text.ts";
import type { YamlLib } from "../lib/yaml-text.ts";
import { aliasBomb } from "./fixtures/build-components/hardening-kit.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { yamlLib, yamlText as y } from "./lib/yaml-lib.ts";

/** A boolean, so a document wrongly accepted is not dumped (a 100,000-node tree takes minutes to diff). */
const isNull = (doc: unknown): boolean => doc === null;
const REFUSED = "the document must be refused (parse returns null)";
const ms = (since: number): number => performance.now() - since;
/** `{a: &a [n scalars], b: *a, c: *a}` has `1 + 3 * (n + 1)` expanded nodes. */
const shared = (n: number, extra = ""): string =>
  `a: &a [${Array.from({ length: n }, () => "x").join(",")}]\nb: *a\nc: *a\n${extra}`;

describe("R34 the budget", () => {
  test("is 100,000 expanded nodes", () => assert.equal(EXPANDED_NODE_LIMIT, 100_000));

  test("a scalar, an empty document and an empty collection are within it", () => {
    for (const root of [undefined, null, "x", 5, [], {}])
      assert.equal(exceedsExpandedLimit(root), false);
  });
});

describe("R34 the boundary is a count of expanded nodes", () => {
  test("a flat sequence: the root plus 99,999 elements is accepted, one more is refused", () => {
    assert.equal(exceedsExpandedLimit(Array.from({ length: 99_999 }, () => 1)), false);
    assert.equal(exceedsExpandedLimit(Array.from({ length: 100_000 }, () => 1)), true);
  });

  test("a mapping counts its values and not its keys", () => {
    const at = (n: number): Record<string, number> =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    assert.equal(exceedsExpandedLimit(at(99_999)), false);
    assert.equal(exceedsExpandedLimit(at(100_000)), true);
  });

  test("a nested collection that closes the count exactly on the limit is accepted", () => {
    const filler = (n: number): unknown[] => Array.from({ length: n }, () => 1);
    assert.equal(exceedsExpandedLimit([...filler(99_997), [1]]), false, "1 + 99,997 + 2");
    assert.equal(exceedsExpandedLimit([...filler(99_998), [1]]), true, "one more");
    assert.equal(exceedsExpandedLimit([[...filler(99_997), [1]]]), true, "the root adds one");
  });

  test("through aliases: exactly 100,000 is read normally, 100,001 is refused (both trees)", () => {
    const exact = y.parse(shared(33_332));
    assert.notEqual(exact, null);
    assert.equal(y.seq(exact, "c").length, 33_332);
    assert.ok(isNull(y.parse(shared(33_332, "d: x\n"))), REFUSED);
  });

  test("a node reached through an alias counts once per reference", () => {
    const leaf = [1, 2, 3];
    assert.equal(exceedsExpandedLimit([leaf, leaf]), false);
    const big = Array.from({ length: 33_333 }, () => 1);
    assert.equal(exceedsExpandedLimit([big, big]), false, "2 * 33,334 + 1");
    assert.equal(exceedsExpandedLimit([big, big, big]), true, "3 * 33,334 + 1");
  });
});

describe("R34 the traversal counts the expansion and never builds it", () => {
  test("a nine-wide, twelve-level alias bomb is refused at once and the process lives", () => {
    const text = `${aliasBomb(12, 9).join("\n")}\n`;
    assert.ok(text.length < 1_000, `${text.length} bytes`);
    const start = performance.now();
    assert.ok(isNull(y.parse(text)), REFUSED);
    assert.ok(ms(start) < 1_000, `took ${ms(start)} ms`);
  });

  test("the same bomb as shared objects is refused at once (node count, not copy)", () => {
    let node: unknown[] = Array.from({ length: 9 }, () => 1);
    for (let level = 0; level < 12; level += 1) node = Array.from({ length: 9 }, () => node);
    const start = performance.now();
    assert.equal(exceedsExpandedLimit(node), true);
    assert.ok(ms(start) < 1_000, `took ${ms(start)} ms`);
  });

  test("the 8-level, 10-wide bomb of the review (a 400-byte org mapping) is refused", () => {
    const text = `replaces-core: true\n${aliasBomb(8, 10).join("\n")}\n`;
    assert.ok(text.length < 700, `${text.length} bytes`);
    assert.ok(isNull(y.parse(text)), REFUSED);
  });
});

describe("R34 a cycle has no finite size and is refused", () => {
  for (const [name, text] of [
    ["a sequence that holds itself", "a: &a [*a]\n"],
    ["a mapping that holds itself", "a: &a {k: *a}\n"],
    ["an indirect cycle", "a: &a {b: &b {c: *a}}\n"],
    ["a cycle through the root", "&r {k: *r}\n"],
  ] as const) {
    test(name, () => assert.ok(isNull(y.parse(text)), REFUSED));
  }

  test("programmatic cycles, however small, are refused", () => {
    const seq: unknown[] = [];
    seq.push(seq);
    const map: Record<string, unknown> = {};
    map["k"] = { inner: map };
    assert.equal(exceedsExpandedLimit(seq), true);
    assert.equal(exceedsExpandedLimit(map), true);
  });

  test("a small shared alias that is not a cycle is accepted", () => {
    const doc = y.parse("base: &b {k: v}\nx: *b\ny: [*b, *b]\n");
    assert.notEqual(doc, null);
    assert.equal(y.plain(doc, "x.k"), "v");
  });
});

describe("R34 depth cannot overflow the call stack", () => {
  const nest = (depth: number): unknown[] => {
    let node: unknown[] = [];
    for (let i = 1; i < depth; i += 1) node = [node];
    return node;
  };

  test("90,000 levels are walked and accepted, 100,001 are refused, nothing throws", () => {
    assert.equal(exceedsExpandedLimit(nest(90_000)), false);
    assert.equal(exceedsExpandedLimit(nest(100_001)), true);
  });

  test("a document nested deeper than the loader can read is refused, not thrown", () => {
    assert.ok(isNull(y.parse(`${"[".repeat(200_000)}${"]".repeat(200_000)}`)), REFUSED);
  });
});

describe("R34 both trees the reader loads are measured", () => {
  const small = [1];
  const big = Array.from({ length: EXPANDED_NODE_LIMIT }, () => 1);
  const only = (schema: unknown, over: unknown): YamlLib => ({
    ...yamlLib,
    load: (text, options) => (options?.schema === schema ? over : yamlLib.load(text, options)),
  });

  test("control: two small trees parse", () => {
    assert.notEqual(createYamlText(only(yamlLib.CORE_SCHEMA, small)).parse("a: 1\n"), null);
  });

  test("a structure tree over the budget refuses the document", () => {
    assert.ok(isNull(createYamlText(only(yamlLib.CORE_SCHEMA, big)).parse("a: 1\n")), REFUSED);
  });

  test("a written-text tree over the budget refuses the document", () => {
    assert.ok(isNull(createYamlText(only(yamlLib.FAILSAFE_SCHEMA, big)).parse("a: 1\n")), REFUSED);
  });
});

describe("R34 a refused document reads like an unparseable one", () => {
  const refused = y.parse(`${aliasBomb(12, 9).join("\n")}\nname: n\n`);
  const broken = y.parse("a: [unclosed\n");

  test("parse returns null for both and throws for neither", () => {
    assert.ok(isNull(refused), REFUSED);
    assert.ok(isNull(broken), REFUSED);
  });

  test("every reader gives its unparseable answer", () => {
    for (const doc of [refused, broken]) {
      assert.equal(y.plain(doc, "name"), "");
      assert.equal(y.alt(doc, "name"), "");
      assert.deepEqual(y.seq(doc, "a0"), []);
      assert.equal(y.has(doc, "name"), false);
      assert.deepEqual(y.entries(doc, ""), []);
    }
  });
});

describe("R34 the real corpus is far below the budget", () => {
  const files = (dir: string, keep: (name: string, parent: string) => boolean): string[] =>
    fs
      .readdirSync(path.join(REPO, dir), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && keep(e.name, path.basename(e.parentPath)))
      .map((e) => path.join(e.parentPath, e.name));

  test("every model mapping and organisation mapping parses and is not refused", () => {
    const mappings = files("model-mappings", (name) => name.endsWith(".yml"));
    assert.ok(mappings.length >= 8, `${mappings.length} mappings`);
    for (const file of mappings) {
      const doc = y.parse(readTextLf(file));
      assert.notEqual(doc, null, file);
      assert.equal(exceedsExpandedLimit(doc?.text), false, file);
    }
  });

  test("every component frontmatter parses and is not refused", () => {
    const sources = files(
      "artifacts",
      (name, parent) =>
        name === "SKILL.md" ||
        name === "AGENT.md" ||
        (name.endsWith(".md") && parent === "commands"),
    );
    assert.ok(sources.length >= 30, `${sources.length} component sources`);
    for (const file of sources) {
      const doc = y.parse(frontmatterOfText(readTextLf(file)));
      assert.notEqual(doc, null, file);
    }
  });
});
