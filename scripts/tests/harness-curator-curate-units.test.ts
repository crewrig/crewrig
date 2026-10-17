// Replaces artifacts/library/skills/harness-curator/scripts/test.sh group G4 (spec 0228 R1-R4,
// spec 0265 row J2): curate.py unit calls through importlib (`pyEval`, python3 -I, no MemPalace,
// no stdin fixture). POSIX only.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pyEval, python3, SKIP_WIN32 } from "./lib/harness-curator-py.ts";

const skip = SKIP_WIN32 ?? (python3() === undefined ? "python3 not found" : undefined);
const title = (cluster: string): string =>
  pyEval("curate.py", `title, _ = m.compose_body("k", ${cluster}, "r"); OUT = title`);

describe("G4 spec 0228 curator title Gitmoji prefix", { skip }, () => {
  test("G4 emoji: process room -> 📝", () => {
    assert.equal(title('[{"_room": "process"}]'), "📝 Friction cluster: k (1 report)");
  });

  test("G4 emoji: format room -> 🎨", () => {
    assert.equal(title('[{"_room": "format"}]'), "🎨 Friction cluster: k (1 report)");
  });

  test("G4 emoji: unmapped room -> 🔧 fallback", () => {
    assert.equal(title('[{"_room": "some-future-room"}]'), "🔧 Friction cluster: k (1 report)");
  });

  test("G4 emoji: no _room key -> 🔧 fallback", () => {
    assert.equal(title("[{}]"), "🔧 Friction cluster: k (1 report)");
  });

  test("G4 emoji: exact plural shape (R4, byte-identical remainder)", () => {
    assert.equal(
      title('[{"_room":"tool"},{"_room":"tool"}]'),
      "🐛 Friction cluster: k (2 reports)",
    );
  });

  test("G4 shared: label and title emoji share one _dominant_room computation (R1)", () => {
    const out = pyEval(
      "curate.py",
      'm._dominant_room = lambda cluster: "process"; cluster = [{"_room": "tool"}]; ' +
        'title, _ = m.compose_body("k", cluster, "r"); labels = m.cluster_labels(cluster); ' +
        'OUT = title.startswith("📝 ") and ("room:process" in labels)',
    );
    assert.equal(out, "True");
  });
});
