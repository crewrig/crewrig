// build-components-conformance-org.test.ts — the organisation-channel half of the
// shell/TypeScript conformance (spec 0250 R21, requirements 19 and 20). Linux only,
// spawning `bash` and `yq`; it retires with the shell library (row I2).
//
// For every builder that carries an organisation file (the O-cases of
// test-model-resolution.sh and the edge cases of lib/mapping-fixtures.ts) the shell runs in
// one `MAPPING_MERGE_DIR` and the twin in another, and the suite compares the outcomes, the
// digest directory names, the `.merges` content, the standard-error lines, and each merged
// document after loading (by `yq` and by the TypeScript readers: R33(h) says equal after
// loading, not byte-identical). Then each implementation resolves again in the OTHER's
// directory: it must reuse the document and add no `.merges` line (both directions).
// Deliberate differences are listed with their clause: an unlisted one fails, and so does a
// listed one that vanishes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { BUILDERS, casesOf, ORG_EDGES, type Builder } from "./lib/mapping-fixtures.ts";
import {
  bashIntegerOnly,
  checkCase,
  differing,
  diffOutcomes,
  limited,
  parityGate,
  runShellResolve,
  runTwinResolve,
  type Documented,
  type Outcome,
  type ResolveCase,
} from "./lib/shell-resolve-harness.ts";
import { yamlText } from "./lib/yaml-lib.ts";

const skip = parityGate();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-org-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const YQ_ERROR = /^Error: /;
const DUP_NOTE = "mapping-merge-note\tclaude\tduplicate-rank\trank=2 offerings=hexb,sonnet";
/** Documented differences of resolution and standard error (R33 or a plan finding). */
const DOCUMENTED: readonly Documented[] = [
  {
    id: "bash-integer-diagnostic",
    clause:
      "PLAN S3 (R33 'no other byte differs' read as not covering bash's own diagnostics): a rank " +
      "that is no shell integer (absent, `1.5`, `1e3`, `x`) makes bash print `integer expected`; " +
      "the twin selects the same offering and prints nothing",
    keys: ["xo_rank-absent#0", "xo_rank-hex-float#0", "xo_rank-hex-float#1"],
    verify: bashIntegerOnly,
  },
  {
    id: "yq-error-text",
    clause:
      "R19 'a mapping file that cannot be parsed SHALL read as an empty document ... never as " +
      "an error': yq's own `Error:` lines for a sequence-valued or unparseable core mapping are " +
      "not reproduced (same reading as S3); the merge lines and the result are equal",
    keys: ["xo_core-seq#0", "xo_core-unparseable#0"],
    verify: (shell, twin) => {
      if (differing(shell, twin).join() !== "stderr") return `differs in ${differing(shell, twin)}`;
      const kept = shell.stderr.filter((l) => !YQ_ERROR.test(l));
      if (kept.length === shell.stderr.length) return "no yq error line: the difference vanished";
      return JSON.stringify(kept) === JSON.stringify(twin.stderr) ? null : `left: ${kept}`;
    },
  },
  {
    id: "hex-rank-normalised",
    clause:
      "R33(h): the shell's merge rewrites `0x2` and `0x10` as `2` and `16` (yq canonicalises " +
      "hex integers), so it notes a duplicate rank with core's `sonnet`; the twin keeps the " +
      "written `0x2`, which is no duplicate. (The plan's 'hex ranks make yq panic' did not " +
      "reproduce on this yq: UNVERIFIED, see the report)",
    keys: ["xo_rank-hex#0"],
    verify: (shell, twin) => {
      if (differing(shell, twin).join() !== "stderr") return `differs in ${differing(shell, twin)}`;
      return JSON.stringify(shell.stderr) === JSON.stringify([...twin.stderr, DUP_NOTE])
        ? null
        : `${shell.stderr}`;
    },
  },
];

/** `path: shell=... twin=...` for every leaf or key order that differs between two trees. */
function treeDiff(a: unknown, b: unknown, at: string, out: string[] = []): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const object = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
  if (object(a) && object(b) && Array.isArray(a) === Array.isArray(b)) {
    const [ka, kb] = [Object.keys(a), Object.keys(b)];
    if (ka.join() !== kb.join() && !Array.isArray(a))
      out.push(`${at} keys: shell=[${ka}] twin=[${kb}]`);
    for (const k of new Set([...ka, ...kb])) treeDiff(a[k], b[k], `${at}.${k}`, out);
  } else out.push(`${at}: shell=${JSON.stringify(a)} twin=${JSON.stringify(b)}`);
  return out;
}
const AMBIGUOUS_TEXT = [
  'text.offerings.4.encodes.reasoning: shell="null" twin=null',
  'text.offerings.5.id: shell="null" twin="~"',
  'text.offerings.5.provides.specialization: shell="null" twin="~"',
  'text.offerings.5.provides.context: shell="null" twin=null',
  'text.offerings.5.provides.modalities.2: shell="31" twin="0x1F"',
  'text.offerings.5.provides.modalities.3: shell="null" twin="~"',
  'text.offerings.5.provides.modalities.5: shell="7" twin="007"',
  'text.offerings.6.extra.nested.deep.2: shell="true" twin="True"',
];
/** Documented differences of the merged document itself, keyed by builder name. */
const DOC_DIFFERENCES: Readonly<Record<string, { clause: string; text: string[] }>> = {
  "xo_rank-hex": {
    clause: "R33(h): yq canonicalises hex integers when it writes the merged document",
    text: [
      'text.offerings.1.rank: shell="2" twin="0x2"',
      'text.offerings.5.rank: shell="16" twin="0x10"',
    ],
  },
  "xo_rank-hex-float": {
    clause:
      "R33(h): yq canonicalises the hex rank `0x10` as `16` when it writes the merged document",
    text: ['text.offerings.5.rank: shell="16" twin="0x10"'],
  },
  "xo_ambiguous-scalars": {
    clause:
      "R33(h): yq rewrites `~`, `0x1F`, `007`, `True` as `null`, `31`, `7`, `true` on writing",
    text: AMBIGUOUS_TEXT,
  },
};

const json = (file: string): string =>
  execFileSync("yq", ["-o=json", "-I0", ".", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
const merges = (dir: string): string =>
  fs.existsSync(`${dir}/.merges`) ? fs.readFileSync(`${dir}/.merges`, "utf8") : "";
const digests = (dir: string): string[] =>
  fs
    .readdirSync(dir)
    .filter((n) => n !== ".merges")
    .sort();
const offeringIds = (doc: unknown): string[] =>
  ((doc as { offerings?: { id: unknown }[] } | null)?.offerings ?? []).map((o) => String(o.id));
const load = (file: string): ReturnType<typeof yamlText.parse> =>
  yamlText.parse(fs.readFileSync(file, "utf8"));

/** Documented: an offering without `rank` sorts last under yq's `sort_by(.rank, .id)` and first in the twin. */
function absentRankOrder(shell: string[], twin: string[]): string | null {
  const mine = (id: string): boolean => id.startsWith("norank");
  if (!shell.some(mine)) return null;
  if (!mine(shell.at(-1) ?? "") || !mine(twin[0] ?? ""))
    return `yq last, twin first expected: shell ${shell}, twin ${twin}`;
  const [a, b] = [shell.filter((i) => !mine(i)), twin.filter((i) => !mine(i))];
  return JSON.stringify(a) === JSON.stringify(b)
    ? null
    : `the other offerings differ: ${a} vs ${b}`;
}

/** The merged documents of one builder, shell against twin, after loading (R33(h)). */
function compareDocuments(
  b: Builder,
  ms: string,
  mt: string,
): { problems: string[]; docs: number } {
  const problems: string[] = [];
  let docs = 0;
  for (const digest of digests(ms)) {
    for (const target of b.targets) {
      const [shellDoc, twinDoc] = [
        `${ms}/${digest}/${target}.yml`,
        `${mt}/${digest}/${target}.yml`,
      ];
      if (!fs.existsSync(shellDoc)) continue;
      if (!fs.existsSync(twinDoc)) {
        problems.push(`the twin wrote no ${target} document under ${digest}`);
        continue;
      }
      docs += 1;
      const [a, c] = [load(shellDoc), load(twinDoc)];
      if (b.name.endsWith("xo_rank-absent")) {
        const order = absentRankOrder(offeringIds(a?.core), offeringIds(c?.core));
        if (order !== null) problems.push(`${target}: ${order}`);
        continue;
      }
      if (json(shellDoc) !== json(twinDoc))
        problems.push(`${target}: yq loads the documents differently`);
      const core = treeDiff(a?.core, c?.core, "core");
      if (core.length > 0) problems.push(`${target}: core trees differ: ${core.slice(0, 3)}`);
      const [text, listed] = [
        treeDiff(a?.text, c?.text, "text"),
        DOC_DIFFERENCES[b.name]?.text ?? [],
      ];
      if (JSON.stringify(text) !== JSON.stringify(listed)) {
        problems.push(
          `${target}: text trees differ, ${listed.length ? "not as listed" : "unlisted"}: ${text.join("; ")}`,
        );
      }
    }
  }
  return { problems, docs };
}

const stats = { docs: 0, mergeLines: 0, pairs: 0, listed: 0, cross: 0 };
const failures = new Map<string, string[]>();
const dirs = (name: string): [string, string] => {
  const pair: [string, string] = [path.join(tmp, `${name}-ms`), path.join(tmp, `${name}-mt`)];
  for (const dir of pair) fs.mkdirSync(dir);
  return pair;
};

async function group(b: Builder): Promise<void> {
  const bad: string[] = [];
  const repoDir = b.build(tmp);
  const [ms, mt] = dirs(b.name);
  const at = (mergeDir: string): ResolveCase[] => casesOf(b, tmp, repoDir, { mergeDir });
  const [shell, twin] = [await runShellResolve(at(ms)), runTwinResolve(at(mt))];
  at(ms).forEach((c, i) => {
    bad.push(...checkCase(c, shell[i] as Outcome, twin[i] as Outcome, DOCUMENTED));
    stats.pairs += 1;
    stats.listed += diffOutcomes(shell[i] as Outcome, twin[i] as Outcome).length > 0 ? 1 : 0;
  });
  if (JSON.stringify(digests(ms)) !== JSON.stringify(digests(mt)))
    bad.push(`digest directories: ${digests(ms)} vs ${digests(mt)}`);
  if (merges(ms) !== merges(mt))
    bad.push(`.merges: shell ${JSON.stringify(merges(ms))} twin ${JSON.stringify(merges(mt))}`);
  stats.mergeLines += merges(ms).split("\n").filter(Boolean).length;
  const documents = compareDocuments(b, ms, mt);
  bad.push(...documents.problems);
  stats.docs += documents.docs;

  // Each implementation reads the other's document and adds no `.merges` line.
  const first = at(ms)[0] as ResolveCase;
  const [before, after] = [[merges(ms), merges(mt)], [] as string[]];
  const reads: [string, Outcome, Outcome][] = [
    [
      "shell over the twin's directory",
      (await runShellResolve([{ ...first, mergeDir: mt }]))[0] as Outcome,
      shell[0] as Outcome,
    ],
    [
      "twin over the shell's directory",
      runTwinResolve([{ ...first, mergeDir: ms }])[0] as Outcome,
      twin[0] as Outcome,
    ],
  ];
  for (const [who, got, own] of reads) {
    const lines = diffOutcomes({ ...own, stderr: [] }, { ...got, stderr: [] });
    if (lines.length > 0) bad.push(`${who}: ${lines}`);
    if (got.stderr.some((l) => l.startsWith("mapping-merge\t"))) bad.push(`${who}: merged again`);
    stats.cross += 1;
  }
  after.push(merges(ms), merges(mt));
  if (JSON.stringify(before) !== JSON.stringify(after))
    bad.push("a cross-read appended a .merges line");
  failures.set(`${b.label}: ${b.name}`, bad);
}

const orgBuilders = [...BUILDERS.filter((b) => b.org === true), ...ORG_EDGES];
if (skip === undefined) await limited(orgBuilders.map((b) => () => group(b)));

describe(
  "organisation channel: the shell library and its twin agree",
  skip === undefined ? {} : { skip },
  () => {
    for (const [name, bad] of failures) test(name, () => assert.deepEqual(bad, []));

    test("the corpus is not vacuous and every documented difference fires", (t) => {
      assert.ok(orgBuilders.length >= 30, `${orgBuilders.length} organisation builders`);
      assert.ok(
        stats.pairs >= 50 && stats.docs >= 25 && stats.mergeLines >= 25,
        JSON.stringify(stats),
      );
      assert.equal(stats.cross, 2 * orgBuilders.length, "both directions, every builder");
      const expected = DOCUMENTED.reduce((n, d) => n + d.keys.length, 0);
      assert.equal(
        stats.listed,
        expected,
        `resolution differences that fired: ${JSON.stringify(stats)}`,
      );
      assert.equal(Object.keys(DOC_DIFFERENCES).length, 3);
      t.diagnostic(execFileSync("yq", ["--version"], { encoding: "utf8" }).trim());
      t.diagnostic(
        `${JSON.stringify(stats)}; listed: ${DOCUMENTED.map((d) => d.id)}, ${Object.keys(DOC_DIFFERENCES)}, xo_rank-absent order`,
      );
    });
  },
);
