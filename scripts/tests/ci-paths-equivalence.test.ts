// Spec 0283 R3: the mechanical conversion of ci/ci-capabilities.yml to capability-level `paths:`
// changed no effective path set and no effective cache.files (a), and every dorny/paths-filter
// block of build.yml still equals the effective path set of its capability, except for the
// differences listed with a reason in fixtures/ci-paths/filter-differences.txt (b).
// Reads repository files only; nothing is written.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { decodeFilters } from "../lib/ci-parity/filters-doc.ts";
import { readCapabilities } from "../lib/ci-parity/reference-read.ts";
import { get, parse, tag, YqMap, YqSeq } from "../lib/yq-accessors/index.ts";

const DIR = "scripts/tests/fixtures/ci-paths";
const caps = (txt: string) => readCapabilities(parse(txt));
const before = caps(fs.readFileSync(`${DIR}/ci-capabilities.before-0283.yml`, "utf8"));
const after = caps(fs.readFileSync("ci/ci-capabilities.yml", "utf8"));

// Entries this very change adds to the ci-parity capability (wiring of the tests below).
const ADDED = new Set([
  "scripts/tests/ci-paths-equivalence.test.ts",
  "scripts/tests/fixtures/ci-paths/**",
  "scripts/ci-paths-gate.ts",
  "scripts/lib/ci-paths-gate/**",
  ".github/actions/ci-job/action.yml",
  "scripts/tests/ci-paths-gate.test.ts",
  "scripts/tests/ci-parity-ci-job.test.ts",
]);
const base = (id: string, l: string[]): string[] =>
  id === "ci-parity" ? l.filter((x) => !ADDED.has(x)) : l;

test("(a) every capability keeps its effective path sets and cache.files", () => {
  const byId = new Map(after.map((c) => [c.id, c]));
  assert.ok(before.length >= 128, "the frozen snapshot holds the 128 capabilities of the slice");
  for (const b of before) {
    const a = byId.get(b.id);
    assert.ok(a, `capability '${b.id}' disappeared`);
    assert.equal(a.triggers.length, b.triggers.length, `${b.id}: trigger count`);
    b.triggers.forEach((t, i) => {
      assert.equal(a.triggers[i]!.kind, t.kind, `${b.id}: trigger ${i} kind`);
      assert.deepEqual(
        base(b.id, a.triggers[i]!.paths),
        t.paths,
        `${b.id}: ${t.kind} effective paths`,
      );
    });
    assert.deepEqual(base(b.id, a.cacheFiles), b.cacheFiles, `${b.id}: effective cache.files`);
  }
});

function readAllowlist(): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of fs.readFileSync(`${DIR}/filter-differences.txt`, "utf8").split("\n")) {
    if (l.trim() === "" || l.startsWith("#")) continue;
    const [id, ...why] = l.split("|");
    assert.ok(why.join("|").trim() !== "", `allowlist entry '${id}' needs a reason`);
    m.set(id!.trim(), why.join("|").trim());
  }
  return m;
}

test("(b) each dorny filter of build.yml equals its capability's effective path set", () => {
  const jobs = get(parse(fs.readFileSync(".github/workflows/build.yml", "utf8")), ["jobs"]);
  assert.ok(jobs instanceof YqMap);
  const allow = readAllowlist();
  const byId = new Map(after.map((c) => [c.id, c]));
  const used = new Set<string>();
  const problems: string[] = [];
  let checked = 0;
  for (const [key, job] of jobs.entries) {
    const steps = get(job, ["steps"]);
    if (!(steps instanceof YqSeq)) continue;
    for (const s of steps.items) {
      const u = get(s, ["uses"]);
      if (tag(u) !== "!!str" || !String(u).startsWith("dorny/paths-filter@")) continue;
      const f = decodeFilters(String(get(get(s, ["with"]), ["filters"])));
      if (typeof f === "string") {
        problems.push(`${key}: ${f}`);
        continue;
      }
      const cap = byId.get(f.name);
      if (f.count !== 1 || cap === undefined) {
        problems.push(`${key}: filter '${f.names}' has no single matching capability`);
        continue;
      }
      checked++;
      const want = new Set(f.items);
      for (const t of cap.triggers.filter((x) => x.kind === "pull-request" || x.kind === "push")) {
        const have = new Set(t.paths);
        const diff = [
          ...[...want].filter((x) => !have.has(x)).map((x) => `only in build.yml: ${x}`),
          ...[...have].filter((x) => !want.has(x)).map((x) => `only in reference: ${x}`),
        ];
        if (diff.length === 0) continue;
        used.add(cap.id);
        if (!allow.has(cap.id)) problems.push(`${key} (${t.kind}): ${diff.join("; ")}`);
      }
    }
  }
  assert.ok(checked > 0);
  for (const id of allow.keys())
    if (!used.has(id)) problems.push(`stale allowlist entry '${id}': no difference any more`);
  assert.deepEqual(problems, []);
});
