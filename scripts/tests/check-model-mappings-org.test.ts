// check-model-mappings-org.test.ts — Replaces scripts/tests/test-check-model-mappings.sh
// section 1b (spec 0265, row J2, P8; spec 0199 plan steps 2, 7, 8): org channel
// classification and org-only assertions, R17, the pass-3 (mapping in force) scenarios 7 and
// 9 against a copy of the committed claude.yml, and the `--print-selection` label set.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { runEntry } from "./lib/governance-sandbox.ts";
import {
  assertConform,
  assertRejected,
  baseDoc,
  bareRoot,
  ENTRY,
  mutate,
  orgSilentDoc,
  REPO,
  runChecker,
  writeCase,
  writeMapping,
  zeroOfferingsDoc,
  type Doc,
} from "./lib/model-mapping-fixtures.ts";

const root = bareRoot();
const check = (file: string) => runChecker(root, [file]);
const org = (extra: Record<string, unknown>, stem = "claude"): string =>
  writeCase(stem, { ...orgSilentDoc(), ...extra }, true);

const rows: readonly {
  label: string;
  stem?: string;
  extra: Record<string, unknown>;
  id: string;
}[] = [
  { label: "org target outside vocabulary", extra: { target: "bogus" }, id: "A1" },
  { label: "org filename disagreement", stem: "other", extra: {}, id: "A2" },
  { label: "remove: outside the grammar", extra: { remove: ["offerings"] }, id: "A28" },
  { label: "remove: names the guard", extra: { remove: ["guard"] }, id: "A29" },
  { label: "remove: names a guard term", extra: { remove: ["guard/terms/x"] }, id: "A29" },
  {
    label: "both replaces-core: and remove:",
    extra: { "replaces-core": true, remove: ["offerings/x"] },
    id: "A30",
  },
  { label: 'replaces-core: "yes"', extra: { "replaces-core": "yes" }, id: "A31" },
  { label: "org node at no published address", extra: { surfaces: [{ id: "x" }] }, id: "A32" },
  {
    label: "ungrounded org offering",
    extra: {
      offerings: [
        {
          id: "x",
          rank: 1,
          "native-value": "x",
          provides: { intelligence: "medium" },
          "supports-reasoning-surface": false,
        },
      ],
    },
    id: "A4",
  },
  { label: "org key outside the closed set", extra: { bogus: "x" }, id: "A3" },
];

/** A root holding the committed claude.yml plus an org file (the pass-3 scenarios). */
function claudeRootWithOrg(orgText: string): string {
  const dir = bareRoot();
  fs.copyFileSync(
    path.join(REPO, "model-mappings", "claude.yml"),
    path.join(dir, "model-mappings", "claude.yml"),
  );
  writeMapping(dir, "claude.org.yml", orgText);
  return dir;
}

describe("check-model-mappings org channel (section 1b)", () => {
  test("silent stub accepted", () => {
    assertConform(check(writeCase("claude", orgSilentDoc(), true)));
  });

  for (const row of rows) {
    test(row.label, () => {
      assertRejected(check(org(row.extra, row.stem)), [row.id]);
    });
  }

  test("core file carrying remove:", () => {
    const doc = mutate(baseDoc(), (d: Doc) => void (d["remove"] = ["offerings/beta"]));
    assertRejected(check(writeCase("claude", doc)), ["A3"]);
  });

  test("org file with no sibling core mapping conforms (exit 0, pass 1 does not run)", () => {
    const dir = bareRoot();
    const file = writeMapping(dir, "gemini.org.yml", zeroOfferingsDoc());
    // exit 0 only: the merge notice on stderr is not part of the contract (as in the Bash suite)
    assert.equal(runChecker(dir, [file]).status, 0);
  });

  test("pass 3 catches a cross-file rank collision invisible to pass 1 and pass 2 (A7, scenario 7)", () => {
    const dir = claudeRootWithOrg(
      [
        "target: claude",
        "offerings:",
        "  - id: org-extra",
        "    rank: 1",
        "    native-value: sonnet",
        "    provides:",
        "      intelligence: medium",
        "    supports-reasoning-surface: false",
        "    grounds:",
        "      - declares: native-value",
        '        citation: "org citation for native-value"',
        "      - declares: provides.intelligence",
        '        citation: "org citation for intelligence"',
        "      - declares: supports-reasoning-surface",
        '        assumption: "org assumption for supports-reasoning-surface"',
        "",
      ].join("\n"),
    );
    const res = runChecker(dir);
    assertRejected(res, []);
    const out = `${res.stdout}${res.stderr}`;
    assert.ok(out.includes("model-mappings/claude (mapping in force): A7"), out);
    assert.ok(!out.includes("model-mappings/claude.yml: A7"), out);
    assert.ok(!out.includes("model-mappings/claude.org.yml: A7"), out);
  });

  test("pass 3 catches a directed guard composed across files with still-holding inherited terms (A23, scenario 9)", () => {
    const dir = claudeRootWithOrg("target: claude\nguard:\n  state: directed\n");
    const res = runChecker(dir);
    assertRejected(res, []);
    const out = `${res.stdout}${res.stderr}`;
    assert.ok(out.includes("model-mappings/claude (mapping in force): A23"), out);
    assert.ok(!out.includes("model-mappings/claude.yml: A23"), out);
    assert.ok(!out.includes("model-mappings/claude.org.yml: A23"), out);
  });

  test("--print-selection label field 1 is model-mappings/<target> for every target, never a path", () => {
    const res = runEntry(ENTRY, { args: ["--print-selection"] });
    assert.equal(res.status, 0, res.stderr);
    const labels = [
      ...new Set(
        res.stdout
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => l.split("\t")[0]),
      ),
    ];
    assert.deepEqual(
      labels.sort(),
      ["antigravity", "claude", "copilot", "gemini"].map((t) => `model-mappings/${t}`),
    );
  });
});
