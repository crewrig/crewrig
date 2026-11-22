// build-components-provenance.test.ts — R12 (provenance) of spec 0250 and R8 of spec 0316 over
// scripts/lib/build-components/provenance.ts (`provenanceFields`, `injectProvenance`,
// `withMarkerLine`), and R13/R15 link rewrites over links.ts (`rewriteSkillBodyLinks`,
// `rewriteResourceLinks`).
//
// The marker bytes themselves are written by scripts/lib/provenance-marker.ts and tested in
// provenance-marker.test.ts. Real sources are checked structurally, synthetic frontmatters carry
// the edge shapes. A mapping or a sequence entry is the one listed deviation (R33(g)); an unknown
// key is refused, never dropped.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  injectProvenance,
  provenanceFields,
  withMarkerLine,
} from "../lib/build-components/provenance.ts";
import { rewriteResourceLinks, rewriteSkillBodyLinks } from "../lib/build-components/links.ts";
import { BuildFailure } from "../lib/build-components/types.ts";
import { makeCtx } from "./fixtures/build-components/ctx-kit.ts";
import { withProvenance } from "./fixtures/build-components/provenance-cases.ts";
import { REPO } from "./lib/build-fixture-tree.ts";

const kit = makeCtx();
const fields = (text: string) => provenanceFields(kit.open(text), kit.ctx.config, "crewrig");

const realSources = fs
  .globSync(
    ["artifacts/*/skills/*/SKILL.md", "artifacts/*/agents/*/AGENT.md", "artifacts/*/commands/*.md"],
    { cwd: REPO },
  )
  .sort()
  .map((rel) => path.join(REPO, rel));

describe("provenanceFields", () => {
  test("package from the caller, then the authored version, canonical and feedback", () => {
    assert.deepEqual(
      fields(withProvenance("    version: 1.0\n    canonical: https://h/o/r\n    feedback: f")),
      { package: "crewrig", version: "1.0", canonical: "https://h/o/r", feedback: "f" },
    );
  });

  test("null without metadata.provenance: no marker (R8)", () => {
    for (const fm of [
      "---\nname: x\n---\nb",
      "---\nname: x\nmetadata: text\n---\nb",
      "---\nname: x\nmetadata:\n  other: 1\n---\nb",
      "---\nname: x\nmetadata: [a]\n---\nb",
      "no frontmatter at all",
      "---\nname: [unclosed\n---\nb",
    ]) {
      assert.equal(fields(fm), null, JSON.stringify(fm));
    }
  });

  test("an empty provenance key still counts; an absent, null or false field is empty", () => {
    assert.deepEqual(fields("---\nmetadata:\n  provenance:\n---\nb"), {
      package: "crewrig",
      version: "",
      canonical: "",
      feedback: "",
    });
    assert.equal(fields(withProvenance("    version: false\n    canonical: ~"))?.version, "");
  });

  test("an authored package or extension is dropped, never merged (R2, R6)", () => {
    const got = fields(withProvenance("    package: other\n    extension: e\n    version: 1"));
    assert.deepEqual(got, { package: "crewrig", version: "1", canonical: "", feedback: "" });
  });

  test("an unknown key is a build error naming the source and the key", () => {
    const source = kit.open(withProvenance("    version: 1\n    extra: e"));
    assert.throws(
      () => provenanceFields(source, kit.ctx.config, "crewrig"),
      (e: unknown) =>
        e instanceof BuildFailure && e.message.includes(source.file) && e.message.includes("extra"),
    );
  });

  test("a mapping or a sequence entry is a build error naming the source (R33(g))", () => {
    for (const entry of ["    m:\n      k: v", "    s: [1, 2]", "    s:\n      - a"]) {
      const source = kit.open(withProvenance(entry));
      assert.throws(
        () => provenanceFields(source, kit.ctx.config, "crewrig"),
        (e: unknown) =>
          e instanceof BuildFailure &&
          e.exitCode === 1 &&
          e.message.startsWith("Error:") &&
          e.message.includes(source.file),
        entry,
      );
    }
  });

  test("placeholders are resolved before the writer sees the value (v1-F4)", () => {
    const k = makeCtx({
      config: {
        placeholders: [{ key: "CANONICAL_REPO", value: "https://h/o/r" }],
        canonicalRepo: "",
      },
    });
    const got = provenanceFields(
      k.open(withProvenance("    canonical: ${CANONICAL_REPO}")),
      k.ctx.config,
      "crewrig",
    );
    assert.equal(got?.canonical, "https://h/o/r");
  });

  test("a placeholder whose value holds a double quote is refused after substitution (v1-F4)", () => {
    const k = makeCtx({
      config: { placeholders: [{ key: "FEEDBACK_REPO", value: 'x" y' }], canonicalRepo: "" },
    });
    const source = k.open(withProvenance("    feedback: ${FEEDBACK_REPO}"));
    const resolved = provenanceFields(source, k.ctx.config, "crewrig");
    assert.equal(resolved?.feedback, 'x" y');
    assert.throws(
      () => withMarkerLine("f.md", "body", resolved!, "html"),
      (e: unknown) => e instanceof BuildFailure && e.message.includes("f.md"),
    );
    assert.throws(
      () => injectProvenance("---\na: 1\n---\n", resolved),
      (e: unknown) => e instanceof Error && /double quote/.test(e.message),
    );
  });
});

describe("injectProvenance", () => {
  const f = { package: "crewrig", version: "1" };
  const B = 'metadata:\n  provenance:\n    package: "crewrig"\n    version: "1"';

  test("the block lands before the second line that is exactly ---", () => {
    assert.equal(injectProvenance("---\na: 1\n---\nz", f), `---\na: 1\n${B}\n---\nz`);
    assert.equal(injectProvenance("---\n---\n", f), `---\n${B}\n---\n`);
  });

  test("only the second --- counts: later ones and near-misses are not splice points", () => {
    assert.equal(injectProvenance("---\na\n---\nb\n---\nc", f), `---\na\n${B}\n---\nb\n---\nc`);
    assert.equal(injectProvenance("---\na\n--- \n---\nz", f), `---\na\n--- \n${B}\n---\nz`);
  });

  test("fewer than two --- lines, or no fields: the content is returned unchanged", () => {
    assert.equal(injectProvenance("---\nonly", f), "---\nonly");
    assert.equal(injectProvenance("---\na\n---\n", null), "---\na\n---\n");
  });
});

describe("withMarkerLine", () => {
  test("a Gemini command: the # line replaces the renderer's three-field line (R6)", () => {
    const toml = '# crewrig-provenance: version="1" canonical="c" feedback="f"\ndescription = "d"';
    assert.equal(
      withMarkerLine("c.toml", toml, { package: "crewrig", version: "1" }, "hash"),
      '# crewrig-provenance: package="crewrig" version="1"\ndescription = "d"',
    );
  });
});

describe("real sources", () => {
  test("sources with provenance carry package and the three authored fields", () => {
    let withProvenance = 0;
    for (const f of realSources) {
      const got = provenanceFields(kit.ctx.fm.open(f), kit.ctx.config, "crewrig");
      if (got === null) continue;
      withProvenance += 1;
      assert.equal(got.package, "crewrig");
      assert.ok(got.version && got.canonical && got.feedback, f);
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
