// model-resolve-profile.test.ts — `profileRead` and the declaration predicates of
// scripts/lib/model-resolve/profile.ts (spec 0250 R19; spec 0198 R1).
//
// Real core agent sources are read through `render-command.ts`'s `extractFrontmatter`, the
// function the build injects; synthetic profiles are written to a temp directory. Documented
// as the twin does it: a scalar-, sequence- or mapping-valued tuning knob reads as the empty
// text (the R11 scalar rendering), and a key that is declared but empty IS declared.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { INTELLIGENCE_RUNGS } from "../lib/model-resolve/ladders.ts";
import {
  axisDeclaredValue,
  declaredValueOf,
  dottedPath,
  profileDeclaresAxis,
  profileDeclaresItem,
  profileRead,
} from "../lib/model-resolve/profile.ts";
import type { Profile } from "../lib/model-resolve/types.ts";
import { extractFrontmatter } from "../lib/render-command.ts";
import {
  cleanupTmp,
  mkTmp,
  REPO,
  writeProfile,
  yamlLib,
  yamlText as y,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const dir = mkTmp();
const read = (...lines: string[]): Profile =>
  profileRead(y, extractFrontmatter, writeProfile(dir, ...lines));
const readText = (name: string, text: string): Profile => {
  const file = path.join(dir, `${name}.md`);
  fs.writeFileSync(file, text);
  return profileRead(y, extractFrontmatter, file);
};

describe("profileRead on the real core agent sources", () => {
  const agentsDir = path.join(REPO, "artifacts", "core", "agents");
  const agents = fs.readdirSync(agentsDir).sort();

  test("there are core agents to read", () => assert.ok(agents.length >= 20));

  for (const agent of agents) {
    test(`${agent}: a profile is present with an intelligence rung from the ladder`, () => {
      const source = path.join(agentsDir, agent, "AGENT.md");
      const profile = profileRead(y, extractFrontmatter, source);
      // an independent read of the same frontmatter through the CORE schema
      const loaded: unknown = yamlLib.load(extractFrontmatter(source), {
        schema: yamlLib.CORE_SCHEMA,
      });
      const model = (loaded as { metadata?: { model?: { intelligence?: unknown } } }).metadata
        ?.model;
      assert.equal(profile.present, true);
      assert.equal(profile.intelligence.has, true);
      assert.equal(profile.intelligence.value, model?.intelligence);
      assert.ok(INTELLIGENCE_RUNGS.includes(profile.intelligence.value));
    });
  }
});

describe("profileRead on synthetic profiles", () => {
  test("every axis is read: the written text, modalities space-joined", () => {
    const profile = read(
      "intelligence: medium",
      "reasoning: high",
      "specialization: code",
      "context: 007",
      "speed: fast",
      "modalities: [text, image]",
      "locality: local",
    );
    const flat = Object.fromEntries(
      Object.entries(profile.axes).map(([axis, v]) => [axis, [v.has, v.value]]),
    );
    assert.deepEqual(flat, {
      reasoning: [true, "high"],
      specialization: [true, "code"],
      context: [true, "007"],
      speed: [true, "fast"],
      modalities: [true, "text image"],
      locality: [true, "local"],
    });
    assert.deepEqual([profile.present, profile.intelligence.value], [true, "medium"]);
  });

  test("a source with no metadata.model is not present and declares nothing", () => {
    const profile = read();
    assert.equal(profile.present, false);
    assert.equal(profile.intelligence.has, false);
    assert.deepEqual(profile.tuning, []);
  });

  test("a declared-but-empty axis is declared, with the empty text", () => {
    const profile = read("intelligence:", "reasoning:");
    assert.deepEqual(profile.intelligence, { has: true, value: "" });
    assert.deepEqual(profile.axes.reasoning, { has: true, value: "" });
  });

  test("tuning knobs keep their declared order and written text, hex included", () => {
    const profile = read("tuning:\n  temperature: 0.5\n  max-turns: 0x10\n  top-k: 007");
    assert.deepEqual(profile.tuning, [
      ["temperature", "0.5"],
      ["max-turns", "0x10"],
      ["top-k", "007"],
    ]);
  });

  test("a scalar, sequence or mapping tuning knob renders empty yet is declared", () => {
    const profile = read(
      "tuning:\n  top-p: [1]\n  top-k:\n    a: 1\n  max-output-tokens:\n  temperature: 1.0",
    );
    assert.deepEqual(profile.tuning, [
      ["top-p", ""],
      ["top-k", ""],
      ["max-output-tokens", ""],
      ["temperature", "1.0"],
    ]);
  });

  test("an empty tuning block makes the profile present with no knob", () => {
    const profile = read("tuning: {}");
    assert.equal(profile.present, true);
    assert.deepEqual(profile.tuning, []);
  });

  const shapes: ReadonlyArray<readonly [string, string, boolean]> = [
    ["a model that is a scalar", "---\nname: p\nmetadata:\n  model: high\n---\n", true],
    ["a model that is null", "---\nname: p\nmetadata:\n  model:\n---\n", true],
    ["a model that is an empty mapping", "---\nname: p\nmetadata:\n  model: {}\n---\n", true],
    ["a metadata that is a scalar", "---\nname: p\nmetadata: x\n---\n", false],
    ["no metadata at all", "---\nname: p\n---\n", false],
    ["no frontmatter fence", "name: p\nmetadata:\n  model:\n    intelligence: low\n", false],
    [
      "unparseable frontmatter",
      "---\nname: [\nmetadata:\n  model:\n    intelligence: low\n---\n",
      false,
    ],
  ];
  for (const [name, text, present] of shapes)
    test(`${name}: present is ${present} and no axis is declared`, () => {
      const profile = readText(name.replaceAll(" ", "-"), text);
      assert.equal(profile.present, present);
      assert.equal(profile.intelligence.has, false);
    });

  test("an unreadable source, or an extractor that throws, reads as no frontmatter", () => {
    assert.equal(profileRead(y, extractFrontmatter, path.join(dir, "missing.md")).present, false);
    const throwing = (): string => {
      throw new Error("boom");
    };
    assert.equal(profileRead(y, throwing, "ignored").present, false);
  });
});

describe("declaration predicates and rendering helpers", () => {
  const profile = read(
    "intelligence: high",
    "reasoning: low",
    "context: 500",
    "modalities: [text, image]",
    "tuning:\n  temperature: 0.7\n  top-k: 40",
  );

  test("model is the intelligence axis, reasoning itself, any other item a tuning knob", () => {
    assert.equal(profileDeclaresItem(profile, "model"), true);
    assert.equal(profileDeclaresItem(profile, "reasoning"), true);
    assert.equal(profileDeclaresItem(profile, "temperature"), true);
    assert.equal(profileDeclaresItem(profile, "top-p"), false);
    // a selection axis is not an item: only a tuning key can make `context` declared
    assert.equal(profileDeclaresItem(profile, "context"), false);
    assert.equal(profileDeclaresItem(read(), "model"), false);
  });

  test("the six selection axes are declared axes, intelligence and unknown names are not", () => {
    assert.equal(profileDeclaresAxis(profile, "context"), true);
    assert.equal(profileDeclaresAxis(profile, "modalities"), true);
    assert.equal(profileDeclaresAxis(profile, "speed"), false);
    assert.equal(profileDeclaresAxis(profile, "intelligence"), false);
    assert.equal(profileDeclaresAxis(profile, "bogus"), false);
  });

  test("a declared value renders as written, modalities as a bracketed comma list", () => {
    assert.equal(axisDeclaredValue(profile, "context"), "500");
    assert.equal(axisDeclaredValue(profile, "modalities"), "[text,image]");
    assert.equal(axisDeclaredValue(read("modalities: [text]"), "modalities"), "[text]");
  });

  test("the dotted path of an item names its place in the profile", () => {
    assert.equal(dottedPath("model"), "metadata.model.intelligence");
    assert.equal(dottedPath("reasoning"), "metadata.model.reasoning");
    assert.equal(dottedPath("top-k"), "metadata.model.tuning.top-k");
  });

  test("the declared value of an item is read from its own axis or knob", () => {
    assert.equal(declaredValueOf(profile, "model"), "high");
    assert.equal(declaredValueOf(profile, "reasoning"), "low");
    assert.equal(declaredValueOf(profile, "top-k"), "40");
    assert.equal(declaredValueOf(profile, "top-p"), "");
  });
});
