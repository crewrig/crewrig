// model-resolve-merge-nodes.test.ts — surfaces, guard, the substituting merge, the silent
// channel and the shape of the merged document (scripts/lib/model-resolve/merge-ops.ts,
// merge-mapping.ts; spec 0250 R20; spec 0199 R8-R12, R15-R17, R19, R25, R26, R31). Bash cases
// covered: O1, O5, O6, O6b. Dispositions are read from standard error, effects from the merged
// document read back through the CORE schema; each expectation was checked against the shell.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  cleanupTmp,
  idsOf,
  loadFile,
  makeRun,
  mergeOf,
  mkTmp,
  offering,
  orgRoot,
  realRoot,
  resolveProbe,
  rootWith,
  tab,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const line = (target: string, address: string, disposition: string): string =>
  tab("mapping-merge", target, address, disposition);
const org = (body: string, target = "claude") =>
  mergeOf(orgRoot(target, `target: ${target}\n${body}`), target);
const surfaceOf = (file: string, id: string): Record<string, unknown> | undefined =>
  (loadFile(file)["surfaces"] as Array<Record<string, unknown>>).find((s) => s["id"] === id);

describe("the silent channel (O1, R8, R9)", () => {
  test("O1 an absent org file and a silent one both leave the core mapping in force, with no merge", () => {
    const absent = realRoot();
    fs.rmSync(path.join(absent, "model-mappings", "claude.org.yml"));
    const silent = realRoot();
    for (const root of [absent, silent]) {
      const m = mergeOf(root);
      assert.equal(m.handle, path.join(root, "model-mappings", "claude.yml"));
      assert.deepEqual([m.err, fs.readdirSync(m.mergeDir)], [[], []]);
    }
  });

  test("an org file declaring no offering, surface, guard, remove entry or substitution is silent", () => {
    for (const body of [
      "remove: []",
      "offerings: []",
      "surfaces: []",
      "replaces-core: false",
      "replaces-core: 'false'",
      "",
    ]) {
      const m = org(body);
      assert.equal(
        m.handle,
        path.join(m.run.ctx.repoDir, "model-mappings", "claude.yml"),
        JSON.stringify(body),
      );
      assert.deepEqual(fs.readdirSync(m.mergeDir), [], JSON.stringify(body));
    }
  });

  test("an org file that is unparseable, a scalar, a sequence, empty or a directory is read as silent", () => {
    for (const text of ["{{{ ::\n - [", "just a scalar", "- a\n- b", ""]) {
      const m = mergeOf(orgRoot("claude", text));
      assert.equal(
        m.handle.endsWith("claude.yml") && !m.handle.includes("merge"),
        true,
        JSON.stringify(text),
      );
      assert.deepEqual(m.err, []);
    }
    const root = realRoot();
    const file = path.join(root, "model-mappings", "claude.org.yml");
    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.equal(mergeOf(root).handle, path.join(root, "model-mappings", "claude.yml"));
  });

  test("neither core nor org: the handle is empty", () => {
    assert.equal(mergeOf(rootWith({}), "claude").handle, "");
    assert.equal(mergeOf(rootWith({ "claude.org.yml": "target: claude\n" }), "claude").handle, "");
  });

  test("a guard key, even an empty one, or replaces-core: true alone, is a declaration and merges", () => {
    assert.equal(org("guard: {}").handle.includes("claude.yml"), true);
    assert.deepEqual(
      fs.readdirSync(org("guard: {}").mergeDir).filter((f) => f === ".merges"),
      [".merges"],
    );
    assert.deepEqual(idsOf(org("replaces-core: true").handle), []);
  });
});

describe("surfaces", () => {
  test("a node carrying kind replaces the surface whole; a new id is added", () => {
    const m = org(
      "surfaces:\n  - id: guidance\n    kind: guidance\n    template: X {{model}}\n    items: [{item: model}]\n  - id: extra\n    kind: out-of-band\n    items: []\n",
    );
    assert.deepEqual(m.err, [
      line("claude", "surfaces/guidance", "replaced"),
      line("claude", "surfaces/extra", "added"),
    ]);
    assert.deepEqual(idsOf(m.handle, "surfaces"), ["frontmatter", "guidance", "extra"]);
    assert.equal(surfaceOf(m.handle, "guidance")?.["carries"], undefined);
  });

  test("a node with template and no kind replaces only the template of an existing surface", () => {
    const m = org("surfaces:\n  - id: guidance\n    template: |\n      ORG {{model}}\n");
    const guidance = surfaceOf(m.handle, "guidance");
    assert.deepEqual(m.err, [line("claude", "surfaces/guidance/template", "replaced")]);
    assert.deepEqual(
      [guidance?.["template"], guidance?.["kind"], guidance?.["carries"]],
      ["ORG {{model}}\n", "guidance", ["model", "reasoning"]],
    );
  });

  test("a template-only node with an unknown id is appended as it stands, reported added", () => {
    const m = org("surfaces:\n  - id: newone\n    template: |\n      ORG\n");
    assert.deepEqual(m.err, [line("claude", "surfaces/newone/template", "added")]);
    assert.deepEqual(surfaceOf(m.handle, "newone"), { id: "newone", template: "ORG\n" });
  });
});

describe("guard", () => {
  const terms = (file: string): Array<Record<string, unknown>> =>
    (loadFile(file)["guard"] as { terms: Array<Record<string, unknown>> }).terms;

  test("a guard carrying id replaces the guard whole", () => {
    const m = org("guard:\n  id: g2\n  state: directed\n  terms: []\n");
    assert.deepEqual(m.err, [line("claude", "guard", "replaced")]);
    assert.deepEqual(loadFile(m.handle)["guard"], { id: "g2", state: "directed", terms: [] });
  });

  test("a guard carrying state and no id replaces the scalar only", () => {
    const m = org("guard:\n  state: directed\n");
    const guard = loadFile(m.handle)["guard"] as Record<string, unknown>;
    assert.deepEqual(m.err, [line("claude", "guard/state", "replaced")]);
    assert.deepEqual(
      [guard["state"], guard["id"], terms(m.handle).length],
      ["directed", "copilot-shared-read", 2],
    );
  });

  test("on a target with no guard, a state alone creates the guard, reported added", () => {
    const m = org("guard:\n  state: withheld\n", "gemini");
    assert.deepEqual(m.err, [line("gemini", "guard/state", "added")]);
    assert.deepEqual(loadFile(m.handle)["guard"], { state: "withheld" });
  });

  test("each term is its own replace-or-add by id", () => {
    const m = org(
      "guard:\n  terms:\n    - id: defect-not-established-fixed\n      holds: false\n    - id: brandnew\n      holds: true\n",
    );
    assert.deepEqual(m.err, [
      line("claude", "guard/terms/defect-not-established-fixed", "replaced"),
      line("claude", "guard/terms/brandnew", "added"),
    ]);
    assert.deepEqual(
      terms(m.handle).map((t) => [t["id"], t["holds"]]),
      [
        ["defect-not-established-fixed", false],
        ["copilot-reader-consumes-claude-surface", true],
        ["brandnew", true],
      ],
    );
  });
});

describe("replaces-core: true (O5)", () => {
  const body = (extra = "") =>
    `replaces-core: true\nsurfaces:\n  - id: guidance\n    kind: guidance\n    template: ORG template using {{model}}.\n    items: [{item: model}]\n  - id: nosuch\n    kind: guidance\n    items: []\nofferings:\n${offering("opus", 3, "o5-opus", "medium")}\n${offering("brand", 9, "b", "max")}\n${extra}`;

  test("O5 the org document stands alone: only its offering is a candidate and its template renders", () => {
    const m = org(body());
    const run = makeRun(m.run.ctx.repoDir, { MAPPING_MERGE_DIR: m.mergeDir });
    const r = resolveProbe(run, writeProfile(mkTmp(), "intelligence: medium"), "claude");
    assert.deepEqual(idsOf(m.handle), ["opus", "brand"]);
    assert.deepEqual([r.offeringId, r.prose], ["opus", "ORG template using o5-opus."]);
  });

  test("a node is replaced when the core declares the address, no-effect otherwise, never added", () => {
    const m = org(body("guard:\n  id: g\n  state: directed\n"));
    assert.deepEqual(m.err, [
      line("claude", "offerings/opus", "replaced"),
      line("claude", "offerings/brand", "no-effect"),
      line("claude", "surfaces/guidance", "replaced"),
      line("claude", "surfaces/nosuch", "no-effect"),
      line("claude", "guard", "replaced"),
    ]);
  });

  test("the guard reads no-effect when the core has none, and a bare substitution carries an empty offering list", () => {
    assert.deepEqual(org("replaces-core: true\nguard:\n  id: g\n", "gemini").err, [
      line("gemini", "guard", "no-effect"),
    ]);
    const bare = org("replaces-core: true");
    assert.deepEqual([bare.err, loadFile(bare.handle)["offerings"]], [[], []]);
  });

  test("O6b no core mapping at all: the org document alone, every remove: entry no-effect, no no-mapping note", () => {
    const root = rootWith({
      "o6bfake.org.yml": `target: o6bfake\nremove: [offerings/nonexistent, guard, surfaces/x/template]\nofferings:\n${offering("o6b", 1, "o6b-model", "medium")}\n`,
    });
    const m = mergeOf(root, "o6bfake");
    assert.deepEqual(m.err, [
      line("o6bfake", "offerings/o6b", "no-effect"),
      line("o6bfake", "offerings/nonexistent", "no-effect"),
      line("o6bfake", "guard", "no-effect"),
      line("o6bfake", "surfaces/x/template", "no-effect"),
    ]);
    assert.deepEqual(idsOf(m.handle), ["o6b"]);
  });
});

describe("O6 and the shape of the merged document", () => {
  test("O6 an org-only target over a zero-offerings core (copilot) emits where none existed", () => {
    const m = mergeOf(
      orgRoot(
        "copilot",
        `target: copilot\nsurfaces:\n  - id: agent-file-model\n    kind: frontmatter\n    items:\n      - item: model\n        key: model\n        domain: {values: [o6-model]}\nofferings:\n${offering("o6", 1, "o6-model", "medium")}`,
      ),
      "copilot",
    );
    const r = resolveProbe(
      makeRun(m.run.ctx.repoDir, { MAPPING_MERGE_DIR: m.mergeDir }),
      writeProfile(mkTmp(), "intelligence: medium"),
      "copilot",
    );
    assert.equal(r.fmLines.includes("model: o6-model"), true);
  });

  test("top-level keys come out in the published order; remove, replaces-core and unknown keys are dropped", () => {
    const m = org("bogus: 1\nremove: []\nreplaces-core: false\nguard:\n  id: g\n");
    assert.deepEqual(Object.keys(loadFile(m.handle)), ["target", "surfaces", "offerings", "guard"]);
  });

  test("a core zero-offerings block survives, in its published position after the guard", () => {
    const m = org(`offerings:\n${offering("x", 1, "x", "low")}`, "copilot");
    assert.deepEqual(Object.keys(loadFile(m.handle)), [
      "target",
      "surfaces",
      "offerings",
      "zero-offerings",
    ]);
  });
});
