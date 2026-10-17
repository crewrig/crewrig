// Replaces artifacts/library/skills/harness-curator/scripts/test.sh groups G1, G2, G3, G7, G14
// (spec 0265, row J2): the curate.sh shim on the sample fixture (16 drawers) and on inline
// fixtures built in memory. G1-G3 are also byte-pinned by the differential golden
// (stdin-sample-dry-run); the field-level asserts below are what survive a golden regeneration.
// POSIX only: `observe` runs the shim in a per-run sandbox with a stub-free PATH (python3 only).

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { observe } from "./lib/harness-curator-observe.ts";
import { python3, SAMPLE, SKIP_WIN32, utf8 } from "./lib/harness-curator-py.ts";

const skip = SKIP_WIN32 ?? (python3() === undefined ? "python3 not found" : undefined);

interface Friction {
  _room?: string;
  title: string;
  evidence: string[];
  suggestion: string;
  context: string;
}
interface Cluster {
  cluster_key: string;
  cluster_size: number;
  target_repo: string;
  body: string;
  title: string;
  labels: string[];
  frictions: Friction[];
}
interface Skipped {
  drawer_id: string;
  reason: string;
  snippet: string;
}
interface Report {
  stats: Record<string, number>;
  clusters: Cluster[];
  skipped: Skipped[];
  routing_failures: { cluster_key: string; reason: string; frictions: Friction[] }[];
}
interface Out {
  status: string;
  stdout: string;
  stderr: string;
  json: Report;
}

function run(input: string, extra: string[] = []): Out {
  const o = observe(
    {
      name: "fixture",
      script: "curate",
      args: ["--from-stdin", "--dry-run", ...extra],
      input: Buffer.from(input, "utf8").toString("latin1"),
      tools: ["python3", "node"],
    },
    "shell",
  );
  const stdout = utf8(o.stdout);
  let json = null as unknown as Report;
  try {
    json = JSON.parse(stdout) as Report;
  } catch {
    // asserted per test
  }
  return { status: o.status, stdout, stderr: utf8(o.stderr), json };
}

const url = "https://github.com/crewrig/crewrig";
const drawer = (id: string, sub: string, sev: string, room = "tool"): object => ({
  drawer_id: id,
  room,
  content: `FRICTION: ${id}\n\nwriter_agent: t\nsubcategory: ${sub}\ncanonical: ${url}\nseverity: ${sev}\nevidence:\n  - x.md:1\n`,
});
const bad = (id: string): object => ({ drawer_id: id, room: "tool", content: "Not a friction" });
const cluster = (o: Out, key: string): Cluster =>
  o.json.clusters.find((c) => c.cluster_key === key) as Cluster;
const keys = (o: Out): string[] => o.json.clusters.map((c) => c.cluster_key);

describe("G1-G3 curate.sh --from-stdin --dry-run on the fixture", { skip }, () => {
  let out: Out;
  before(() => {
    out = run(SAMPLE);
    assert.equal(out.status, "0", out.stderr);
    assert.notEqual(out.stdout, "");
  });

  test("G1 run: rc 0 and non-empty stdout", () => {
    assert.equal(out.status, "0");
    assert.ok(out.stdout.length > 0);
  });

  test("G1 stats", () => {
    assert.deepEqual(out.json.stats, {
      total_drawers: 16,
      valid_frictions: 11,
      skipped_malformed: 2,
      skipped_resolved: 3,
      clusters_formed: 10,
      clusters_above_threshold: 6,
      clusters_parked: 3,
      routing_failures: 1,
      clusters_truncated: 0,
    });
    assert.equal(out.json.clusters.length, 6);
  });

  test("G2 skipped[]", () => {
    const s = out.json.skipped;
    assert.equal(s.length, 2);
    assert.deepEqual(Object.keys(s[0]).sort(), ["drawer_id", "reason", "room", "snippet"]);
    for (const id of ["drw-008", "drw-010", "drw-007", "drw-012", "drw-013"])
      assert.equal(
        s.find((x) => x.drawer_id === id),
        undefined,
        `${id} must not be skipped`,
      );
    assert.deepEqual([...new Set(s.map((x) => x.reason))].sort(), ["malformed"]);
    assert.match(s.find((x) => x.drawer_id === "drw-005")?.snippet ?? "", /Not a friction/);
  });

  test("G2 routing failures", () => {
    const r = out.json.routing_failures;
    assert.equal(r.length, 1);
    assert.deepEqual(Object.keys(r[0]).sort(), ["cluster_key", "frictions", "reason"]);
    assert.equal(r[0].cluster_key, "no-canonical-test");
    assert.equal(r[0].reason, "missing_canonical");
    assert.equal(r[0].frictions.length, 1);
    assert.equal(r[0].frictions[0].title, "No canonical target — cluster must route-fail visibly");
    assert.equal(cluster(out, "no-canonical-test"), undefined);
  });

  test("G2 yq-merge cluster", () => {
    const c = cluster(out, "yq-merge");
    assert.equal(c.cluster_size, 2);
    assert.equal(c.target_repo, url);
    assert.deepEqual([...new Set(c.frictions.map((f) => f._room))], ["prompt"]);
    const drw2 = c.frictions.find((f) => /empty file/.test(f.title));
    assert.equal(drw2?.evidence.length, 1);
    assert.ok(c.body.includes("artifacts/core/skills/architect/SKILL.md:42"));
    assert.ok(c.body.includes("2026-05-08 → 2026-05-10"));
    assert.deepEqual(c.labels, ["harness-feedback", "room:prompt", "severity:med"]);
    assert.equal(c.title, "💬 Friction cluster: yq-merge (2 reports)");
    assert.equal("branch_name" in c, false);
  });

  test("G2 gh-body-truncation high-severity bypass", () => {
    const c = cluster(out, "gh-body-truncation");
    assert.ok(c, "severity:high singleton promoted");
    assert.equal(c.frictions[0]._room, "tool");
    assert.deepEqual(c.labels, ["harness-feedback", "room:tool", "severity:high"]);
    assert.equal(c.title, "🐛 Friction cluster: gh-body-truncation (1 report)");
    assert.ok(c.body.includes("2026-05-09 (single day)"));
  });

  test("G2 exclusions: parked and resolved subcategories absent", () => {
    assert.equal(cluster(out, "parked-singleton"), undefined);
    assert.equal(cluster(out, "stale-resolved-fixture"), undefined);
  });

  test("G3 block scalar | preserved (R1/R3)", () => {
    const c = cluster(out, "block-scalar-multiline");
    assert.ok(c, "drw-011 accepted");
    assert.equal(c.cluster_size, 1);
    const s: string = c.frictions[0].suggestion;
    assert.ok(s.includes("MARKER-SUGG-TAIL"));
    assert.equal(s.split("\n").filter((l) => l !== "").length, 3);
    assert.notEqual(s, "|");
  });

  test("G3 block scalar on a non-suggestion field (R2, no swallow)", () => {
    const c = cluster(out, "block-scalar-generalized");
    assert.ok(c, "drw-014 accepted");
    const f = c.frictions[0];
    assert.ok(f.context.includes("MARKER-CTX-TAIL"));
    assert.equal(f.evidence.length, 1);
    assert.equal(f.evidence[0], "generalized-test.md:7");
    assert.equal(f.suggestion, "Inline one-line suggestion stays correctly parsed.");
    assert.equal(c.title, "🚸 Friction cluster: block-scalar-generalized (1 report)");
  });

  test("G3 resolved precedence over shape and emptiness (R4/R5)", () => {
    const s = out.json.skipped;
    for (const id of ["drw-012", "drw-013"])
      assert.equal(
        s.find((x) => x.drawer_id === id),
        undefined,
      );
    for (const k of ["resolved-block-scalar", "resolved-empty-suggestion"])
      assert.equal(cluster(out, k), undefined);
    assert.equal(out.json.stats.skipped_resolved, 3);
  });

  test("G3 empty suggestion accepted and parked (spec 0033 R1)", () => {
    for (const k of ["empty-suggestion-test", "empty-block-scalar"])
      assert.equal(cluster(out, k), undefined);
  });

  test("G3 block scalar |- and >", () => {
    const strip = cluster(out, "block-scalar-strip");
    const fold = cluster(out, "block-scalar-folded");
    assert.ok(strip && fold);
    assert.equal(strip.cluster_size, 1);
    assert.equal(fold.cluster_size, 1);
    assert.ok(strip.frictions[0].suggestion.includes("MARKER-STRIP-TAIL"));
    assert.ok(fold.frictions[0].suggestion.includes("MARKER-FOLD-TAIL"));
    assert.notEqual(strip.frictions[0].suggestion, "|-");
    assert.notEqual(fold.frictions[0].suggestion, ">");
  });
});

describe("G7 --max-issues cap and order", { skip }, () => {
  const med = (n: number, sub: string): object[] => [
    drawer(`m-${n}`, sub, "med", "prompt"),
    drawer(`m-${n + 1}`, sub, "med", "prompt"),
  ];
  const fixture = JSON.stringify([
    ...[1, 2].map((n) => drawer(`m-l${n}`, "aaa-low", "low", "prompt")),
    ...med(3, "bbb-med"),
    ...med(5, "ccc-med"),
    drawer("m-7", "zzz-high", "high"),
    ...med(8, "ddd-med"),
  ]);

  test("G7 cap 3: counts and ranking order (severity high, then key ascending)", () => {
    const o = run(fixture, ["--max-issues", "3"]);
    assert.equal(o.status, "0", o.stderr);
    assert.equal(o.json.stats.clusters_above_threshold, 5);
    assert.equal(o.json.stats.clusters_truncated, 2);
    assert.deepEqual(keys(o), ["zzz-high", "bbb-med", "ccc-med"]);
  });

  test("G7 --max-issues 0 means no cap", () => {
    const o = run(fixture, ["--max-issues", "0"]);
    assert.equal(o.status, "0", o.stderr);
    assert.equal(o.json.clusters.length, 5);
    assert.equal(o.json.stats.clusters_truncated, 0);
  });
});

describe("G14 spec 0060 malformed-rate warning (W1-W3)", { skip }, () => {
  const valid = (p: string, n: number): object[] =>
    Array.from({ length: n }, (_, i) => drawer(`${p}-${i + 1}`, `${p}-valid-${i + 1}`, "high"));

  test("G14 W1: 4 of 10 malformed warns on stderr, stdout stays JSON", () => {
    const o = run(JSON.stringify([...valid("wv", 6), ...[1, 2, 3, 4].map((n) => bad(`wm-${n}`))]));
    assert.equal(o.status, "0", o.stderr);
    assert.match(o.stderr, /Warning:/);
    assert.ok(o.stderr.includes("4 of 10"));
    assert.ok(o.stderr.includes("40%"));
    assert.ok(o.json !== null, "stdout must parse as JSON");
    assert.equal(o.json.stats.total_drawers, 10);
    assert.equal(o.json.stats.valid_frictions, 6);
    assert.equal(o.json.stats.skipped_malformed, 4);
  });

  test("G14 W2: 2 of 10 malformed (20 percent) is silent", () => {
    const o = run(JSON.stringify([...valid("wv2", 8), bad("wm2-1"), bad("wm2-2")]));
    assert.equal(o.status, "0", o.stderr);
    assert.doesNotMatch(o.stderr, /Warning:/);
  });

  test("G14 W3: empty wing is silent (R7)", () => {
    const o = run("[]");
    assert.equal(o.status, "0", o.stderr);
    assert.doesNotMatch(o.stderr, /Warning:/);
    assert.equal(o.json.stats.total_drawers, 0);
    assert.equal(o.json.stats.skipped_malformed, 0);
  });
});
