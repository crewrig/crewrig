// Replaces artifacts/library/skills/harness-curator/scripts/test.sh groups G5, G6, G9 and the argv
// half of G10 (spec 0265 row J2): `python3 apply.py --dry-run-apply` fed by the curate.sh output
// on the sample fixture and by one-cluster payload builders. Runs under a scratch HOME and a stub
// `gh` (logs every call, fails `issue create`): --dry-run-apply must never reach a forge binary.
// POSIX only. The unit half of G10 (dedup, _match_existing, fail-open) lives in apply-units.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { observe } from "./lib/harness-curator-observe.ts";
import {
  assertNoRealState,
  python3,
  SAMPLE,
  SCRIPTS_DIR,
  scratchEnv,
  SKIP_WIN32,
  snapshotRealState,
  stubGh,
  utf8,
} from "./lib/harness-curator-py.ts";
import type { Scratch } from "./lib/harness-curator-py.ts";

const skip = SKIP_WIN32 ?? (python3() === undefined ? "python3 not found" : undefined);

interface Applied {
  status: number | null;
  stdout: string;
  stderr: string;
  lines: unknown[];
}

let sc: Scratch;
const realBefore = skip === undefined ? snapshotRealState() : {};
before(() => {
  if (skip !== undefined) return;
  sc = scratchEnv();
  stubGh(sc);
});
after(() => {
  if (skip !== undefined) return;
  try {
    assertNoRealState(sc.env, sc.calls, realBefore);
    assert.doesNotMatch(sc.calls, /issue create/, "--dry-run-apply must never create an issue");
  } finally {
    sc.cleanup();
  }
});

function apply(payload: string, env: Record<string, string> = {}, args: string[] = []): Applied {
  const res = spawnSync(
    python3() as string,
    ["-I", path.join(SCRIPTS_DIR, "apply.py"), "--dry-run-apply", ...args],
    { input: payload, env: { ...sc.env, ...env }, encoding: "utf8", timeout: 60_000 },
  );
  assert.notEqual(res.status, null, `apply.py killed by ${res.signal}`);
  const lines = res.stdout
    .split("\n")
    .filter((l) => l.startsWith("[") || l.startsWith("{"))
    .map((l): unknown => JSON.parse(l));
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, lines };
}

const argvs = (a: Applied): string[][] => a.lines.filter(Array.isArray) as string[][];
const objects = (a: Applied): Record<string, unknown>[] =>
  a.lines.filter((l) => !Array.isArray(l)) as Record<string, unknown>[];
const after1 = (argv: string[], flag: string): string => argv[argv.indexOf(flag) + 1] as string;
const count = (argv: string[], flag: string): number => argv.filter((a) => a === flag).length;

const STATS =
  '"stats":{"total_drawers":1,"valid_frictions":1,"skipped_malformed":0,"skipped_resolved":0,"clusters_formed":1,"clusters_above_threshold":1,"clusters_parked":0,"routing_failures":0}';
const payload = (target: string, labels: string, key = "probe"): string =>
  `{${STATS},"clusters":[{"cluster_key":"${key}","cluster_size":1,"target_repo":"${target}","title":"${key} title","body":"body","labels":${labels},"frictions":[{"_drawer_id":"drw-1"}]}],"skipped":[],"routing_failures":[]}`;

describe("G5/G6 apply.py --dry-run-apply on the curate output", { skip }, () => {
  let curated: { clusters: { cluster_key: string; title: string }[] };
  let out: Applied;
  before(() => {
    const o = observe(
      {
        name: "g5",
        script: "curate",
        args: ["--from-stdin", "--dry-run"],
        input: Buffer.from(SAMPLE).toString("latin1"),
        tools: ["python3", "node"],
      },
      "shell",
    );
    curated = JSON.parse(utf8(o.stdout)) as typeof curated;
    out = apply(utf8(o.stdout));
  });
  const argvOf = (key: string): string[] => {
    const t = curated.clusters.find((c) => c.cluster_key === key)?.title as string;
    return argvs(out).find((a) => a.includes(t)) as string[];
  };
  const objOf = (key: string): Record<string, unknown> =>
    objects(out).find((o) => o["cluster_key"] === key) as Record<string, unknown>;

  test("G5 exit code 0 and one argv line per cluster (6)", () => {
    assert.equal(out.status, 0, out.stderr);
    assert.equal(argvs(out).length, 6);
  });

  test("G5 one would_update_drawers object per cluster (6)", () => {
    assert.equal(objects(out).filter((o) => o["would_update_drawers"] != null).length, 6);
  });

  test("G5 yq-merge would_update_drawers: array of 2", () => {
    const o = objOf("yq-merge");
    assert.ok(Array.isArray(o["would_update_drawers"]));
    assert.equal((o["would_update_drawers"] as unknown[]).length, 2);
    assert.equal(o["cluster_key"], "yq-merge");
  });

  test("G5 gh-body-truncation would_update_drawers: length 1", () => {
    const o = objOf("gh-body-truncation");
    assert.equal(o["cluster_key"], "gh-body-truncation");
    assert.equal((o["would_update_drawers"] as unknown[]).length, 1);
  });

  for (const [key, labels] of [
    ["yq-merge", ["harness-feedback", "room:prompt", "severity:med"]],
    ["gh-body-truncation", ["harness-feedback", "room:tool", "severity:high"]],
  ] as const)
    test(`G5 ${key} argv: head, --repo prefix stripped, labels`, () => {
      const a = argvOf(key);
      assert.ok(a, `${key} argv line found`);
      assert.deepEqual(a.slice(0, 3), ["gh", "issue", "create"]);
      assert.equal(after1(a, "--repo"), "crewrig/crewrig");
      assert.deepEqual(
        a.flatMap((x, i) => (x === "--label" ? [a[i + 1] as string] : [])),
        [...labels],
      );
    });

  test("G5 empty clusters: exit 0 with the no-clusters notice", () => {
    const empty =
      '{"stats":{"total_drawers":0,"valid_frictions":0,"skipped_malformed":0,"clusters_formed":0,"clusters_above_threshold":0,"clusters_parked":0,"routing_failures":0},"clusters":[],"skipped":[],"routing_failures":[]}';
    const e = apply(empty);
    assert.equal(e.status, 0, e.stderr);
    assert.ok(e.stdout.includes("No clusters above threshold; no issues to open."));
  });

  test("G6 one dedup_match object per cluster (6), all null without --dedup", () => {
    const d = objects(out).filter((o) => "dedup_match" in o);
    assert.equal(d.length, 6);
    assert.equal(d.filter((o) => o["dedup_match"] !== null).length, 0);
  });
});

describe("G9 defensive target_repo normalisation (issue #63)", { skip }, () => {
  const cases: [string, string, boolean][] = [
    [
      "norm.blob",
      "https://github.com/crewrig/crewrig/blob/main/community-config/skills/architect/SKILL.md",
      true,
    ],
    ["norm.tree", "https://github.com/crewrig/crewrig/tree/main/community-config", true],
    ["norm.clean", "https://github.com/crewrig/crewrig", false],
  ];
  for (const [label, target, warns] of cases)
    test(`G9 ${label}: slug only, warning ${warns ? "present" : "absent"}`, () => {
      const a = apply(payload(target, '["harness-feedback"]', "norm-probe"));
      assert.equal(a.status, 0, `${label} exit code`);
      const argv = argvs(a)[0] as string[];
      assert.ok(argv, `${label}: argv line on stdout`);
      assert.equal(after1(argv, "--repo"), "crewrig/crewrig");
      assert.equal(a.stderr.includes("stripping to repo root"), warns);
    });
});

describe("G10 forge-agnostic argv (spec 0105)", { skip }, () => {
  const LABELS = '["harness-feedback","room:tool","severity:high"]';
  const forge = (target: string, hosts?: string): string[] =>
    argvs(
      apply(
        payload(target, LABELS, "forge-probe"),
        hosts === undefined ? {} : { CREWRIG_GITLAB_HOSTS: hosts },
      ),
    )[0] as string[];

  test("G10 gitlab.com: glab, --description, --repo full URL, one comma-joined --label", () => {
    const a = forge("https://gitlab.com/gr/proj");
    assert.deepEqual(a.slice(0, 3), ["glab", "issue", "create"]);
    assert.equal(count(a, "--description"), 1);
    assert.equal(count(a, "--body"), 0);
    assert.equal(after1(a, "--repo"), "https://gitlab.com/gr/proj");
    assert.equal(count(a, "--label"), 1);
    assert.equal(count(a, "--labels"), 0);
    assert.equal(after1(a, "--label"), "harness-feedback,room:tool,severity:high");
  });

  test("G10 gitlab.-prefix host resolves to glab without an env var", () => {
    assert.deepEqual(forge("https://gitlab.example.com/gr/proj").slice(0, 3), [
      "glab",
      "issue",
      "create",
    ]);
  });

  test("G10 R9: CREWRIG_GITLAB_HOSTS host goes to glab, the same host without the env to tea", () => {
    const on = forge("https://git.example.com/o/r", "git.example.com");
    assert.deepEqual(on.slice(0, 3), ["glab", "issue", "create"]);
    assert.equal(after1(on, "--repo"), "https://git.example.com/o/r");
    assert.deepEqual(forge("https://git.example.com/o/r").slice(0, 3), ["tea", "issues", "create"]);
  });

  test("G10 gitea: tea, --description, one comma-joined --labels, --repo owner/repo", () => {
    const a = forge("https://git.acme.io/o/r");
    assert.deepEqual(a.slice(0, 3), ["tea", "issues", "create"]);
    assert.equal(count(a, "--description"), 1);
    assert.equal(count(a, "--labels"), 1);
    assert.equal(after1(a, "--labels"), "harness-feedback,room:tool,severity:high");
    assert.equal(after1(a, "--repo"), "o/r");
  });
});
