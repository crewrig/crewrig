// build-components-provenance.test.ts — R12 (provenance) of spec 0250 over
// scripts/lib/build-components/provenance.ts (`provenanceBlock`, `geminiProvenanceComment`,
// `injectProvenance`), and R13/R15 link rewrites over links.ts (`rewriteSkillBodyLinks`,
// `rewriteResourceLinks`).
//
// Real sources are checked structurally, synthetic frontmatters carry the edge shapes. The shell's
// functions are the oracle of the parity sets (Linux, or CREWRIG_SHELL_PARITY=1, with bash and
// mikefarah yq), read out of scripts/build-components.sh with awk, never copied. A mapping or a
// sequence entry is the one listed deviation (R33(g)) and is left out of the parity set.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  geminiProvenanceComment,
  injectProvenance,
  provenanceBlock,
} from "../lib/build-components/provenance.ts";
import { rewriteResourceLinks, rewriteSkillBodyLinks } from "../lib/build-components/links.ts";
import { BuildFailure } from "../lib/build-components/types.ts";
import { makeCtx, tempDir } from "./fixtures/build-components/ctx-kit.ts";
import {
  INJECT_DRIVER,
  LINK_INPUTS,
  PROV_DRIVER,
  SYNTHETIC_SOURCES,
  withProvenance,
} from "./fixtures/build-components/provenance-cases.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const kit = makeCtx();
const block = (text: string): string => provenanceBlock(kit.open(text));
const comment = (text: string): string => geminiProvenanceComment(kit.open(text));
const HEAD = "metadata:\n  provenance:";

const realSources = fs
  .globSync(
    ["artifacts/*/skills/*/SKILL.md", "artifacts/*/agents/*/AGENT.md", "artifacts/*/commands/*.md"],
    { cwd: REPO },
  )
  .sort()
  .map((rel) => path.join(REPO, rel));

describe("provenanceBlock", () => {
  test("metadata, provenance, then one quoted entry per key in document order", () => {
    assert.equal(
      block(withProvenance("    version: 1.0\n    canonical: https://h/o/r\n    feedback: f")),
      `${HEAD}\n    version: "1.0"\n    canonical: "https://h/o/r"\n    feedback: "f"`,
    );
  });

  test("nothing without metadata.provenance: no metadata, a scalar metadata, no provenance key", () => {
    for (const fm of [
      "---\nname: x\n---\nb",
      "---\nname: x\nmetadata: text\n---\nb",
      "---\nname: x\nmetadata:\n  other: 1\n---\nb",
      "---\nname: x\nmetadata: [a]\n---\nb",
      "no frontmatter at all",
      "---\nname: [unclosed\n---\nb",
    ]) {
      assert.equal(block(fm), "", JSON.stringify(fm));
      assert.equal(comment(fm), "", JSON.stringify(fm));
    }
  });

  test("a provenance key with a null or empty value still counts as provenance", () => {
    assert.equal(block("---\nmetadata:\n  provenance:\n---\nb"), HEAD);
    assert.equal(block("---\nmetadata:\n  provenance: {}\n---\nb"), HEAD);
  });

  test("numbers and boolean-like words are written text, not parsed values", () => {
    const text = withProvenance(
      "    a: 1.0\n    b: 007\n    c: 0x1F\n    d: 1e3\n    e: yes\n    f: True\n    g: false",
    );
    assert.equal(
      block(text),
      `${HEAD}\n    a: "1.0"\n    b: "007"\n    c: "0x1F"\n    d: "1e3"\n    e: "yes"\n    f: "True"\n    g: "false"`,
    );
  });

  test("a null renders empty, in every spelling", () => {
    assert.equal(
      block(withProvenance("    a:\n    b: ~\n    c: null\n    d: Null")),
      `${HEAD}\n    a: ""\n    b: ""\n    c: ""\n    d: ""`,
    );
  });

  test("a double quote inside a value is not escaped; a quoted YAML scalar loses its YAML quotes", () => {
    assert.equal(
      block(withProvenance('    a: \'say "hi"\'\n    b: "x: y"\n    "k k": v')),
      `${HEAD}\n    a: "say "hi""\n    b: "x: y"\n    k k: "v"`,
    );
  });

  test("a block scalar keeps its inner line feeds inside the quotes", () => {
    const text =
      "---\nmetadata:\n  provenance:\n    note: |\n      one\n      two\n    next: z\n---\nb";
    assert.equal(block(text), `${HEAD}\n    note: "one\ntwo\n"\n    next: "z"`);
  });

  test("a mapping or a sequence entry is a build error naming the source (R33(g))", () => {
    for (const entry of ["    m:\n      k: v", "    s: [1, 2]", "    s:\n      - a"]) {
      const source = kit.open(withProvenance(entry));
      assert.throws(
        () => provenanceBlock(source),
        (e: unknown) =>
          e instanceof BuildFailure &&
          e.exitCode === 1 &&
          e.message.startsWith("Error:") &&
          e.message.includes(source.file),
        entry,
      );
    }
  });
});

describe("geminiProvenanceComment", () => {
  test('version, canonical and feedback, each as the // "" rule reads them', () => {
    assert.equal(
      comment(withProvenance("    version: 1.0\n    canonical: c\n    feedback: f\n    extra: e")),
      '<!-- crewrig-provenance: version="1.0" canonical="c" feedback="f" -->',
    );
  });

  test("an absent, null or false field is empty; the others are kept", () => {
    assert.equal(
      comment(withProvenance("    version: false\n    canonical: ~")),
      '<!-- crewrig-provenance: version="" canonical="" feedback="" -->',
    );
    assert.equal(
      comment("---\nmetadata:\n  provenance: {}\n---\nb"),
      '<!-- crewrig-provenance: version="" canonical="" feedback="" -->',
    );
  });

  test("a placeholder inside a value is left for the placeholder pass", () => {
    assert.match(
      comment(withProvenance("    canonical: ${CANONICAL_REPO}")),
      /canonical="\$\{CANONICAL_REPO\}"/,
    );
  });
});

describe("injectProvenance", () => {
  const src = kit.open(withProvenance("    version: 1"));
  const B = `${HEAD}\n    version: "1"`;

  test("the block lands before the second line that is exactly ---", () => {
    assert.equal(injectProvenance("---\na: 1\n---\nz", src), `---\na: 1\n${B}\n---\nz`);
    assert.equal(injectProvenance("---\n---\n", src), `---\n${B}\n---\n`);
  });

  test("only the second --- counts: later ones and near-misses are not splice points", () => {
    assert.equal(injectProvenance("---\na\n---\nb\n---\nc", src), `---\na\n${B}\n---\nb\n---\nc`);
    assert.equal(injectProvenance("x\n---\na\n---\n", src), `x\n---\na\n${B}\n---\n`);
    assert.equal(injectProvenance("---\na\n--- \n---\nz", src), `---\na\n--- \n${B}\n---\nz`);
    assert.equal(injectProvenance("--- \n---\n ---\n---", src), `--- \n---\n ---\n${B}\n---`);
  });

  test("fewer than two --- lines, or no provenance: the content is returned unchanged", () => {
    assert.equal(injectProvenance("---\nonly", src), "---\nonly");
    const plain = kit.open("---\nname: x\n---\nb");
    assert.equal(injectProvenance("---\na\n---\n", plain), "---\na\n---\n");
  });
});

describe("real sources", () => {
  test("sources with provenance render a scalar-only block and a three-field comment", () => {
    let withProvenance = 0;
    for (const f of realSources) {
      const doc = kit.ctx.fm.open(f);
      const b = provenanceBlock(doc);
      if (b === "") continue;
      withProvenance += 1;
      assert.ok(b.startsWith(`${HEAD}\n    `), b);
      for (const line of b.split("\n").slice(2))
        assert.match(line, /^ {4}[^ :][^:]*: ".*"$/s, line);
      assert.match(
        geminiProvenanceComment(doc),
        /^<!-- crewrig-provenance: version="[^"]*" canonical="[^"]*" feedback="[^"]*" -->$/,
        f,
      );
    }
    assert.ok(withProvenance > 20, `only ${withProvenance} sources carry provenance`);
  });
});

const D4 = "../../../../";
const D5 = "../../../../../";
describe("links", () => {
  test("a skill body: four levels to docs/ and specs/ become three, every occurrence", () => {
    assert.equal(
      rewriteSkillBodyLinks(`[a](${D4}docs/a.md) [b](${D4}specs/b.md)\n${D4}docs/${D4}docs/x`),
      "[a](../../../docs/a.md) [b](../../../specs/b.md)\n../../../docs/../../../docs/x",
    );
  });

  test("a body: five levels lose one; three levels, other targets, no slash, CRLF and empty text are kept", () => {
    assert.equal(rewriteSkillBodyLinks(`${D5}docs/x`), `${D4}docs/x`, "five levels lose one");
    for (const same of [
      "../../../docs/a",
      `${D4}README.md`,
      `${D4}docs`,
      "docs/a",
      "a\r\nb\r\n",
      "",
    ]) {
      assert.equal(rewriteSkillBodyLinks(same), same, JSON.stringify(same));
    }
  });

  test("a .md resource: five levels become four; four stay; the rest of the bytes are untouched", () => {
    assert.equal(
      rewriteResourceLinks(`${D5}docs/a ${D5}specs/b\r\n${D4}docs/c ${D5}docs/d`),
      `${D4}docs/a ${D4}specs/b\r\n${D4}docs/c ${D4}docs/d`,
    );
    assert.equal(rewriteResourceLinks(`${D5}README.md`), `${D5}README.md`);
  });

  test("a six-level link is rewritten once, from the left, without overlap", () => {
    assert.equal(rewriteResourceLinks(`../${D5}docs/x`), `${D5}docs/x`);
  });
});

const noShell = parityGate();
const SCRIPT = path.join(REPO, "scripts", "build-components.sh");
describe("shell parity: provenance", { skip: noShell ?? false }, () => {
  test("the block and the Gemini comment equal the shell's for synthetic and real sources", () => {
    const dir = tempDir();
    const files = [
      ...SYNTHETIC_SOURCES.map((text, i) => {
        const file = path.join(dir, `s${i}.md`);
        fs.writeFileSync(file, text);
        return file;
      }),
      ...realSources,
    ];
    const sh = spawnSync("bash", ["-c", PROV_DRIVER, "bash", SCRIPT, ...files], {
      env: { ...process.env, LC_ALL: "C" },
    });
    assert.equal(sh.status, 0, String(sh.stderr));
    const fields = String(sh.stdout).split("\0").slice(0, -1);
    assert.equal(fields.length, files.length * 2);
    files.forEach((file, i) => {
      const doc = kit.ctx.fm.open(file);
      assert.equal(provenanceBlock(doc), fields[2 * i], file);
      assert.equal(geminiProvenanceComment(doc), fields[2 * i + 1], file);
    });
  });

  test("injectProvenance equals the shell's splice", () => {
    const file = path.join(tempDir(), "src.md");
    fs.writeFileSync(file, withProvenance("    version: 1\n    canonical: c"));
    const doc = kit.ctx.fm.open(file);
    for (const content of [
      "---\na: 1\n---\nz",
      "---\n---\n",
      "---\na\n---\nb\n---\nc",
      "---\nonly",
      "x\n---\na\n---\n",
      "---\na\n--- \n---\nz",
    ]) {
      const sh = spawnSync("bash", ["-c", INJECT_DRIVER, "bash", SCRIPT, content, file], {
        encoding: "utf8",
      });
      assert.equal(sh.status, 0, sh.stderr);
      // awk ends the text with a line feed; the caller's $(...) removes trailing ones either way.
      assert.equal(
        injectProvenance(content, doc).replace(/\n+$/, ""),
        sh.stdout.replace(/\n+$/, ""),
        JSON.stringify(content),
      );
    }
  });

  test("the link rewrites equal the shell's sed, whose patterns are read from the script", () => {
    const text = fs.readFileSync(SCRIPT, "utf8");
    const body = /skill_body=\$\(printf '%s' "\$body" \| sed '([^']+)'\)/.exec(text)?.[1];
    const resource = /sed '([^']+)' "\$src_file" > "\$target_file"/.exec(text)?.[1];
    assert.ok(body && resource, "the sed patterns were not found in the script");
    const inputs = LINK_INPUTS;
    const sed = (script: string, input: string): string =>
      String(
        spawnSync("sed", [script], { input, env: { ...process.env, LC_ALL: "C" } }).stdout,
      ).replace(/\n+$/, "");
    for (const input of inputs) {
      assert.equal(rewriteSkillBodyLinks(input), sed(body, input), `body ${JSON.stringify(input)}`);
      assert.equal(
        rewriteResourceLinks(input),
        sed(resource, input),
        `resource ${JSON.stringify(input)}`,
      );
    }
  });
});
