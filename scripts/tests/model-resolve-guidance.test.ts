// model-resolve-guidance.test.ts — step 8, the guidance rendering of
// scripts/lib/model-resolve/guidance.ts (spec 0250 R19; spec 0198 R27-R31, D7, D9). Bash case
// covered: M5. Each expected prose was checked against the shell library while writing.
//
// Documented as the twin does it: the trim strips the six ASCII blanks of the POSIX
// `[[:space:]]` class in the C locale, so a U+00A0 at a line's edge is kept. (BSD `sed` in a
// UTF-8 locale also trims U+00A0, so on macOS the shell and the twin differ on that one byte;
// the conformance suite runs on Linux.)

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  cleanupTmp,
  FM_ENTRY,
  makeRun,
  miniRoot,
  mkTmp,
  mutatedRoot,
  listOf,
  resolveProbe,
  tab,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const dir = mkTmp();
const OFFER =
  "{id: a, rank: 1, native-value: n-a, provides: {intelligence: high}, supports-reasoning-surface: true}";
const surface = (template: string, items = "[{item: model}, {item: reasoning}]"): string =>
  `  - id: gd\n    kind: guidance\n    template: ${template}\n    items: ${items}`;
const render = (template: string, profile: string[] = ["reasoning: medium"], items?: string) => {
  const root = miniRoot([OFFER], "", [FM_ENTRY, surface(template, items)]);
  return resolveProbe(makeRun(root), writeProfile(dir, "intelligence: high", ...profile), "t");
};
const lines = (...text: string[]): string => `|\n${text.map((l) => `      ${l}`).join("\n")}`;
const NONE = ["reasoning: none"]; // reasoning is unmapped on target t, so its placeholder has no value

describe("placeholders", () => {
  test("each placeholder takes the directed value of the item it names", () => {
    assert.equal(
      render(lines("Run on {{model}}.", "Effort {{reasoning}}.")).prose,
      "Run on n-a. Effort medium.",
    );
  });

  test("a placeholder used twice is replaced everywhere", () => {
    assert.equal(render(lines("{{model}} and {{model}}.")).prose, "n-a and n-a.");
  });

  test("M5 an unrecognised placeholder omits its line, never rendered literally", () => {
    const r = render(lines("Run on {{modell}}.", "Effort {{reasoning}}."));
    assert.equal(r.prose, "Effort medium.");
  });

  test("a line naming an undirected item is omitted, the others survive", () => {
    assert.equal(
      render(lines("Run on {{model}}.", "Effort {{reasoning}}."), NONE).prose,
      "Run on n-a.",
    );
  });

  test("one missing placeholder omits the whole line even when another is available", () => {
    assert.equal(render(lines("{{model}} at {{reasoning}}.", "Tail."), NONE).prose, "Tail.");
  });

  test("a placeholder for an item the guidance surface does not carry omits its line", () => {
    assert.equal(
      render(lines("Run {{model}}.", "E {{reasoning}}."), undefined, "[{item: reasoning}]").prose,
      "E medium.",
    );
  });

  test("a knob placeholder omits its line: knobs are frontmatter-only", () => {
    const r = render(lines("T {{temperature}}.", "Ok."), ["tuning:\n  temperature: 0.5"]);
    assert.deepEqual([r.prose, r.fmLines.includes("temperature: 0.5")], ["Ok.", true]);
  });

  test("text that is not a placeholder is kept: spaced braces, uppercase and underscores", () => {
    assert.equal(render(lines("Run {{ model }}.")).prose, "Run {{ model }}.");
    assert.equal(render(lines("Run {{Model}}.")).prose, "");
    assert.equal(render(lines("Run {{a_b}} {{model}}.")).prose, "");
    assert.equal(render(lines("Just text.")).prose, "Just text.");
  });
});

describe("joining and trimming", () => {
  test("blank lines are dropped, edges trimmed, survivors joined on one space", () => {
    assert.equal(render('"\\n  \\tA {{model}} \\t\\n\\n   \\nB\\n"').prose, "A n-a B");
  });

  test("only the ASCII blank class is trimmed: a non-breaking space at an edge is kept", () => {
    assert.equal(render('"\\u00a0A {{model}}\\u00a0"').prose, " A n-a ");
  });

  test("an empty or blank template renders no prose and no note", () => {
    for (const template of ['""', '"  \\n \\n"']) {
      const r = render(template);
      assert.deepEqual([r.prose, r.diagLines], ["", []], template);
    }
  });

  test("no guidance surface at all: no prose", () => {
    const root = miniRoot([OFFER], "", [FM_ENTRY]);
    assert.equal(
      resolveProbe(makeRun(root), writeProfile(dir, "intelligence: high"), "t").prose,
      "",
    );
  });
});

describe("unrenderable fragments (D7)", () => {
  const note = (detail: string): string =>
    tab("model-note", "probe", "t", "unrenderable-fragment", detail);
  const STRUCT = "rendered guidance fragment would alter the compiled description's YAML structure";

  test("a double quote in the rendered text empties the prose and records one note", () => {
    const r = render(lines('Say "hi" {{model}}.'));
    assert.deepEqual([r.prose, r.diagLines], ["", [note(STRUCT)]]);
  });

  test("a backslash does the same", () => {
    const r = render(lines("Say \\ {{model}}."));
    assert.deepEqual([r.prose, r.diagLines], ["", [note(STRUCT)]]);
  });

  test("a carriage return is its own note", () => {
    const r = render('"A\\rB {{model}}"');
    assert.deepEqual(
      [r.prose, r.diagLines],
      ["", [note("rendered guidance fragment carries a CR")]],
    );
  });

  test("a quote on an omitted line never reaches the rendered fragment", () => {
    const r = render(lines('Say "hi" {{reasoning}}.', "Ok {{model}}."), NONE);
    assert.equal(r.prose, "Ok n-a.");
    assert.ok(!r.diagLines.some((l) => l.includes("unrenderable-fragment")));
  });
});

describe("M5 on the real claude mapping", () => {
  test("renaming {{model}} to {{modell}} omits that sentence, the other survives", () => {
    const root = mutatedRoot("claude", (doc) => {
      const gd = listOf(doc, "surfaces").find((s) => s["id"] === "guidance");
      if (gd !== undefined)
        gd["template"] =
          "Run this agent on the {{modell}} model.\nGive its work {{reasoning}} reasoning effort.\n";
    });
    const r = resolveProbe(
      makeRun(root),
      writeProfile(dir, "intelligence: medium", "reasoning: medium"),
      "claude",
    );
    assert.equal(r.prose, "Give its work medium reasoning effort.");
  });
});
