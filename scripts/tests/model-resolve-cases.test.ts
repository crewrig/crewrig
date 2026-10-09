// model-resolve-cases.test.ts — the resolution cases of scripts/tests/test-model-resolution.sh
// re-expressed as unit tests over the real `model-mappings/*.yml` and their mutated copies
// (spec 0250 R19). Same meaning as the Bash cases, named by their label: C7, C10, M1-M4, M6,
// D12/D17, rule (d), rule (e), R24/D16, (g)(5), (g)(6). M5 lives in the guidance suite and the
// org-merge cases (O1-O12, M10, M11) in the merge suites.
//
// Mutations edit a parsed copy of the mapping (the Bash suite edits it with `yq eval -i`).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  cleanupTmp,
  listOf,
  makeRun,
  mkTmp,
  mutatedRoot,
  REPO,
  resolveProbe,
  tab,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const dir = mkTmp();
const go = (root: string, target: string, ...profile: string[]) =>
  resolveProbe(makeRun(root), writeProfile(dir, ...profile), target);
const drop = (target: string, path: string, value: string, reason: string): string =>
  tab("model-drop", "probe", target, path, value, reason);
const first = (doc: Record<string, unknown>, i: number) =>
  listOf(doc, "offerings")[i] as Record<string, unknown>;
const hasChecker =
  (process.platform === "linux" || process.env["CREWRIG_SHELL_PARITY"] === "1") &&
  spawnSync("yq", ["--version"]).status === 0;
const noChecker = hasChecker
  ? undefined
  : "skipped: needs Linux (or CREWRIG_SHELL_PARITY=1) with bash and mikefarah yq";

describe("degradation cases", () => {
  test("C7 a malformed mapping cell degrades: no field, one unreadable-cell note", () => {
    const root = mutatedRoot("gemini", (doc) => {
      first(doc, 1)["native-value"] = "not-a-domain-member";
    });
    const r = go(root, "gemini", "intelligence: medium");
    assert.deepEqual(r.fmLines, []);
    assert.deepEqual(r.diagLines, [
      tab(
        "model-note",
        "probe",
        "gemini",
        "unreadable-cell",
        "offering=gemini-3.5-flash native-value=not-a-domain-member outside the frontmatter model key's declared domain",
      ),
    ]);
  });

  test("C7 the mapping checker rejects the same cell (rule A9)", { skip: noChecker }, () => {
    const root = mutatedRoot("gemini", (doc) => {
      first(doc, 1)["native-value"] = "not-a-domain-member";
    });
    const run = spawnSync(
      "bash",
      [
        path.join(REPO, "scripts", "check-model-mappings.sh"),
        path.join(root, "model-mappings", "gemini.yml"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.match(run.stdout + run.stderr, /: A9 /);
  });

  test("C10 retiring the guidance surface: no prose anywhere, model dropped unsupported-on-cli", () => {
    const root = mutatedRoot("claude", (doc) => {
      doc["surfaces"] = listOf(doc, "surfaces").filter((s) => s["id"] !== "guidance");
    });
    const r = go(root, "claude", "intelligence: medium", "reasoning: medium");
    assert.equal(r.offeringId, "haiku");
    assert.equal(r.prose, "");
    assert.ok(
      r.diagLines.includes(
        drop("claude", "metadata.model.intelligence", "medium", "unsupported-on-cli"),
      ),
    );
  });

  test("D12/D17 no offering selected at all still drops reasoning unsupported-on-model", () => {
    const root = mutatedRoot("claude", (doc) => {
      doc["offerings"] = [];
    });
    const r = go(root, "claude", "intelligence: medium", "reasoning: medium");
    assert.equal(r.offeringId, "");
    assert.ok(
      r.diagLines.includes(
        drop("claude", "metadata.model.reasoning", "medium", "unsupported-on-model"),
      ),
    );
  });
});

describe("mutations of the claude mapping", () => {
  test("M1 changing haiku's native value changes the emitted sentence", () => {
    const root = mutatedRoot("claude", (doc) => {
      first(doc, 0)["native-value"] = "haiku-mutated-M1";
    });
    assert.equal(
      go(root, "claude", "intelligence: medium").prose,
      "Run this agent on the haiku-mutated-M1 model.",
    );
  });

  test("M2 an offering that refuses the reasoning surface drops it (two records), none when undeclared (one)", () => {
    const root = mutatedRoot("claude", (doc) => {
      first(doc, 0)["supports-reasoning-surface"] = false;
    });
    const withReasoning = go(root, "claude", "intelligence: medium", "reasoning: medium");
    const without = go(root, "claude", "intelligence: medium");
    assert.deepEqual([withReasoning.diagLines.length, without.diagLines.length], [2, 1]);
    assert.ok(
      withReasoning.diagLines.includes(
        drop("claude", "metadata.model.reasoning", "medium", "unsupported-on-model"),
      ),
    );
    assert.ok(!without.diagLines.some((l) => l.includes("unsupported-on-model")));
  });

  test("M3 flipping guard.state to directed emits model: and the guard note vanishes", () => {
    const root = mutatedRoot("claude", (doc) => {
      (doc["guard"] as Record<string, unknown>)["state"] = "directed";
    });
    const r = go(root, "claude", "intelligence: medium");
    assert.deepEqual([r.fmLines, r.diagLines], [["model: haiku"], []]);
  });

  test("M4 adding a rank-0 offering moves the pick to it, and the checker agrees", () => {
    const extra = {
      id: "m4-cheap",
      rank: 0,
      "native-value": "m4-cheap",
      provides: { intelligence: "xhigh", specialization: "general" },
      encodes: { intelligence: "m4-cheap" },
      "supports-reasoning-surface": false,
    };
    const root = mutatedRoot("claude", (doc) => {
      doc["offerings"] = [...listOf(doc, "offerings"), extra];
    });
    assert.equal(go(root, "claude", "intelligence: xhigh").offeringId, "m4-cheap");
  });

  test("M4 the checker's selection table moves with it", { skip: noChecker }, () => {
    const extra = {
      id: "m4-cheap",
      rank: 0,
      "native-value": "m4-cheap",
      provides: { intelligence: "xhigh", specialization: "general" },
      encodes: { intelligence: "m4-cheap" },
      "supports-reasoning-surface": false,
      grounds: [
        { declares: "native-value", assumption: "x" },
        { declares: "provides.intelligence", assumption: "x" },
        { declares: "supports-reasoning-surface", assumption: "x" },
      ],
    };
    const root = mutatedRoot("claude", (doc) => {
      doc["offerings"] = [...listOf(doc, "offerings"), extra];
    });
    const run = spawnSync(
      "bash",
      [
        path.join(REPO, "scripts", "check-model-mappings.sh"),
        "--print-selection",
        path.join(root, "model-mappings", "claude.yml"),
      ],
      { encoding: "utf8" },
    );
    const row = run.stdout
      .trim()
      .split("\n")
      .map((l) => l.split("\t"))
      .find((c) => c[1] === "xhigh");
    assert.equal(row?.[2], "m4-cheap");
  });

  test("M6 an offering encoding the declared reasoning rung is directed by selection, no drop", () => {
    const root = mutatedRoot("claude", (doc) => {
      const haiku = first(doc, 0);
      haiku["supports-reasoning-surface"] = false;
      haiku["encodes"] = { intelligence: "haiku", reasoning: "medium" };
    });
    const r = go(root, "claude", "intelligence: medium", "reasoning: medium");
    assert.ok(
      !r.diagLines.includes(
        drop("claude", "metadata.model.reasoning", "medium", "unsupported-on-model"),
      ),
    );
  });
});

describe("rules (d), (e) and (g) on the real mappings", () => {
  const real = (target: string, ...profile: string[]) => go(REPO, target, ...profile);

  test("rule (d) a context floor no claude offering declares is dropped, haiku stays", () => {
    const r = real("claude", "intelligence: medium", "context: 1000000");
    assert.equal(r.offeringId, "haiku");
    assert.ok(
      r.diagLines.includes(drop("claude", "metadata.model.context", "1000000", "unserved-value")),
    );
  });

  test("rule (d) a specialization no gemini offering serves falls back, one drop", () => {
    const r = real("gemini", "intelligence: high", "specialization: image-generation");
    assert.equal(r.offeringId, "gemini-3.1-pro-preview");
    assert.ok(
      r.diagLines.includes(
        drop("gemini", "metadata.model.specialization", "image-generation", "unserved-value"),
      ),
    );
  });

  test("rule (e) an inexact encoded rung selects the nearest below and notes it, no drop", () => {
    const r = real("antigravity", "intelligence: high", "reasoning: medium");
    assert.equal(r.offeringId, "gemini-3.1-pro-low");
    assert.deepEqual(r.diagLines, [
      tab(
        "model-note",
        "probe",
        "antigravity",
        "reasoning-rung-substituted",
        "declared=medium encoded=low",
      ),
    ]);
  });

  test("R24/D16 a tuning knob is dropped unsupported-on-cli where frontmatter declares none", () => {
    for (const target of ["claude", "antigravity"])
      assert.ok(
        real(target, "intelligence: medium", "tuning:\n  temperature: 0.5").diagLines.includes(
          drop(target, "metadata.model.tuning.temperature", "0.5", "unsupported-on-cli"),
        ),
        target,
      );
  });

  test("(g)(6) an out-of-domain tuning value is dropped out-of-range-for-target", () => {
    const r = real("gemini", "intelligence: medium", "tuning:\n  temperature: 5.0");
    assert.ok(!r.fmLines.some((l) => l.startsWith("temperature:")));
    assert.ok(
      r.diagLines.includes(
        drop("gemini", "metadata.model.tuning.temperature", "5.0", "out-of-range-for-target"),
      ),
    );
  });

  test("(g)(5) reasoning: none is unmapped on claude and dropped, never resolved to low", () => {
    const r = real("claude", "intelligence: high", "reasoning: none");
    assert.deepEqual([r.offeringId, r.fmLines], ["sonnet", []]);
    assert.ok(
      r.diagLines.includes(
        drop("claude", "metadata.model.reasoning", "none", "out-of-range-for-target"),
      ),
    );
  });
});
