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

const body = (cluster: string, current = "None"): string =>
  pyEval("curate.py", `_, b = m.compose_body("k", ${cluster}, "r", ${current}); OUT = b`);
const F = (v: string, extra = ', "package": "p", "extension": "e"'): string =>
  `{"_room": "tool", "version": "${v}"${extra}}`;
const CUR = '{("p", "e"): "1.2.0"}';

describe("spec 0316 R16 routing and version triage", { skip }, () => {
  test("feedback beats canonical, canonical alone routes as before, override wins", () => {
    const pick = (cluster: string, override = ""): string =>
      pyEval(
        "curate.py",
        `m.TARGET_OVERRIDE = ${JSON.stringify(override)}; OUT = m.pick_target_repo(${cluster})`,
      );
    const fb = (u: string): string => `{"feedback": "${u}"}`;
    const cn = (u: string): string => `{"canonical": "${u}"}`;
    assert.equal(
      pick(`[${fb("https://x/fb")}, ${fb("https://x/fb")}, ${cn("https://x/c")}]`),
      "https://x/fb",
    );
    assert.equal(
      pick(`[${cn("https://x/c")}, ${cn("https://x/c")}, ${cn("https://x/d")}]`),
      "https://x/c",
    );
    assert.equal(pick(`[${fb("https://x/fb")}]`, "https://x/o"), "https://x/o");
    assert.equal(pick("[{}]"), "None");
  });
  test("SemVer: v prefix, pre-release, build metadata, non-SemVer", () => {
    const cmp = (a: string, b: string): string =>
      pyEval("curate.py", `OUT = m.semver_cmp(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    assert.equal(cmp("v1.2.0", "1.2.0"), "0");
    assert.equal(cmp("1.2.0+build5", "1.2.0"), "0");
    assert.equal(cmp("1.2.0-rc.1", "1.2.0"), "-1");
    assert.equal(cmp("1.2.0-rc.2", "1.2.0-rc.10"), "-1");
    assert.equal(cmp("1.10.0", "1.9.0"), "1");
    assert.equal(cmp("nightly", "1.0.0"), "None");
  });
  test("provenance lines are printed only when set; a legacy body has none", () => {
    const legacy = body('[{"_room": "tool", "title": "t"}]');
    assert.doesNotMatch(legacy, /Package|Extension|Version/);
    const b = body(`[${F("1.0.0")}]`);
    assert.match(b, /- Package: `p`\n/);
    assert.match(b, /- Extension: `e`\n/);
    assert.match(b, /- Version: `1.0.0`\n/);
  });
  test("a cluster holding 1.0.0 and 1.2.0 flags neither", () => {
    assert.doesNotMatch(body(`[${F("1.0.0")}, ${F("1.2.0")}]`, CUR), /possibly fixed/);
  });
  test("a cluster holding only 1.0.0 is flagged against a newer run version", () => {
    assert.match(
      body(`[${F("1.0.0")}]`, CUR),
      /Version: `1\.0\.0` \(possibly fixed: `1\.2\.0` reported\)/,
    );
  });
  test("equal, non-SemVer, missing and no-extension versions are never flagged", () => {
    assert.doesNotMatch(body(`[${F("1.2.0")}]`, CUR), /possibly fixed/);
    assert.doesNotMatch(body(`[${F("nightly")}]`, CUR), /possibly fixed/);
    assert.doesNotMatch(body(`[${F("1.0.0", ', "package": "p"')}]`, CUR), /possibly fixed/);
    assert.doesNotMatch(
      body('[{"_room": "tool", "package": "p", "extension": "e"}]', CUR),
      /possibly fixed/,
    );
  });
  test("only the older friction carries the flag next to a non-SemVer one", () => {
    const b = body(`[${F("1.0.0")}, ${F("nightly")}]`, CUR);
    assert.equal((b.match(/possibly fixed/g) ?? []).length, 1);
  });
});
