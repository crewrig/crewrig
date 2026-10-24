// governance-agent-team-protocol-split.test.ts — guards for the split of
// docs/agent-team-protocol.md into an index plus role files (spec 0274 R3, R4, R6, R11).
//
// Three guards, each a function over a repository root so the mutation tests run the same
// code on a mutated copy under a mkdtemp directory:
//   - no-content-lost: every paragraph of the frozen baseline survives in the index plus the
//     role files (multiset, link targets resolved to repo-root paths), and every baseline
//     sentence carrying MUST / SHALL survives or is named in an exception table;
//   - size budget: index and role files stay under their caps;
//   - anchor resolution: every link fragment, named `*Section → Subsection*` form and index
//     stub reaches a heading, an explicit anchor, a rule entry or a bold lead-in.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { effectivePaths } from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const INDEX = "docs/agent-team-protocol.md";
const ROLE_DIR = "docs/agent-team-protocol";
const ROLE_FILES = [
  "orchestrator",
  "worktree-isolation",
  "built-components",
  "templates",
  "team-communication",
].map((n) => `${ROLE_DIR}/${n}.md`);
const BASELINE = "scripts/tests/fixtures/agent-team-protocol/original.md.txt";
const BASELINE_BYTES = 56003;
const INDEX_CAP = 6144;
const ROLE_CAP = 20480;

// Paragraphs (first 60 characters) intentionally removed or replaced by a later commit, with the
// number of copies that must remain and the requirement that accounts for it.
interface ParagraphException {
  readonly prefix: string;
  readonly remaining: number;
  readonly requirement: string;
}
const EXCEPTIONS: readonly ParagraphException[] = [
  // R7: the REVIEW-loop sentence repeated in Templates 1, 2 and 3 now lives once in
  // "Shared rules for Templates 1 to 3" (templates.md#shared-template-rules).
  {
    prefix: "**REVIEW is a looping stage**, not terminal — the orchestrat",
    remaining: 1,
    requirement: "R7",
  },
  // R7: the Ordering constraint paragraph repeated in Templates 1, 2 and 3 now lives once there too.
  {
    prefix: "**Ordering constraint:** `pr-logbook` MUST open the PR (or h",
    remaining: 1,
    requirement: "R7",
  },
  // R8: the references-only brief definition in "Seated review passes" is cut to a pointer;
  // docs/reviewer-seat.md stays canonical.
  {
    prefix: "Every review pass a template spawns — on the `specs`, `plan`",
    remaining: 0,
    requirement: "R8",
  },
];

// Baseline paragraphs deliberately reworded by a later spec. The frozen baseline is never edited:
// a paragraph whose first 60 characters match `prefix` is accepted when the baseline text is found
// OR when the baseline text with `from` replaced by `to` (link targets in repo-root form) is found
// the same number of times in the index plus role files. `from` must occur once in that paragraph.
interface Amendment {
  readonly prefix: string;
  readonly from: string;
  readonly to: string;
  readonly requirement: string;
}
const AMENDMENTS: readonly Amendment[] = [
  // Spec 0275 R-A1: Rule B is one comment per stage transition, no longer one comment per event.
  {
    prefix: "If the rebase raises conflicts, resolve them, then `git reba",
    from: "Log the conflict on the issue logbook before resuming (Rule B).",
    to: "Record the conflict as a bullet in the next logbook transition comment (Rule B).",
    requirement: "0275 R-A1",
  },
  // Spec 0275 R-A1, R-A2: obstacles are bullets of the next transition comment (or DEV checkpoint).
  {
    prefix: "Any obstacle encountered during the worktree lifecycle — mer",
    from: "must be logged on the issue logbook before resuming work. See **Rule B** in AGENTS.md for the full trigger list.",
    to: "is recorded as a bullet in the next logbook transition comment (a DEV checkpoint comment when a hand-off or repeated CI failure comes first). See **Rule B** in `docs/logbook-issues.md` for the bullet kinds.",
    requirement: "0275 R-A1, R-A2",
  },
  // Spec 0275 R-A1: Rule 6 names the transition-comment logbook practice, not the incremental one.
  {
    prefix: "**Rule 6 — Single writer per forge artifact.** A **forge ar",
    from: "incremental-logbook practice",
    to: "transition-comment logbook practice",
    requirement: "0275 R-A1",
  },
  // Spec 0275 R-B4: shutdown step 4 gains the orchestrator-is-sole-ledger-writer sentence.
  {
    prefix: '1. `SendMessage({to: "<teammate>", message: {type: "shutdown_r',
    from: "(see *Logbook Issues → Rule B* in AGENTS.md).",
    to: "(see *Logbook Issues → Rule B* in AGENTS.md). The orchestrator is the single writer of every seat ledger comment ([`docs/reviewer-seat.md`](docs/reviewer-seat.md) → *Seat ledger*).",
    requirement: "0275 R-B4",
  },
];

/** The paragraph as amended, or undefined when the baseline paragraph carries no amendment. */
export function amended(p: string): string | undefined {
  const a = AMENDMENTS.find((x) => p.startsWith(x.prefix));
  if (!a) return undefined;
  const parts = p.split(a.from);
  assert.equal(
    parts.length,
    2,
    `amendment (${a.requirement}) 'from' must occur once in its paragraph`,
  );
  return parts.join(a.to);
}

// Baseline sentences carrying MUST / SHALL that a later commit may move; each names the
// canonical location that keeps the obligation.
interface ObligationException {
  readonly prefix: string;
  readonly location: string;
}
const OBLIGATION_EXCEPTIONS: readonly ObligationException[] = [];

// Files whose protocol references the anchor guard resolves.
const REFERENCING_FILES = [
  "AGENTS.md",
  "docs/reviewer-seat.md",
  "docs/ticket-ownership.md",
  "docs/host-safety-check.md",
  "docs/adr/0018-forge-assignment-ownership.md",
  "docs/cli-matrix.md",
  "docs/retroactive-loop.md",
  "artifacts/core/skills/pr-logbook/SKILL.md",
  "artifacts/core/skills/pr-reviewer/references/assert-fresh-observation.md",
  ...[".claude", ".gemini", ".github", ".agents"].flatMap((d) => [
    `${d}/skills/pr-logbook/SKILL.md`,
    `${d}/skills/pr-reviewer/references/assert-fresh-observation.md`,
  ]),
  "scripts/lib/worktree-claim/gate.ts",
  "scripts/tests/fixtures/worktree-claim/golden/matrix.json",
];

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function maybeRead(root: string, rel: string): string | undefined {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : undefined;
}

const HEADING = /^#{1,6}\s+\S/;
const ANCHOR_LINE = /^<a id="[^"]+"><\/a>$/;

/** Rewrite every relative link target to a repo-root path so moved text compares equal. */
function normalizeLinks(text: string, fileRel: string): string {
  const dir = path.posix.dirname(fileRel);
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target: string) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    return `](${path.posix.normalize(path.posix.join(dir, target))})`;
  });
}

/** Blank-line paragraphs outside code fences; a fence is one paragraph; headings and anchor lines are dropped. */
export function paragraphs(text: string, fileRel: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = (): void => {
    if (cur.length > 0) out.push(normalizeLinks(cur.join("\n"), fileRel));
    cur = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      cur.push(line);
      continue;
    }
    if (fence) {
      cur.push(line);
      continue;
    }
    if (line.trim() === "" || HEADING.test(line) || ANCHOR_LINE.test(line)) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return out;
}

function tally(items: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

function outputFiles(root: string): { rel: string; text: string }[] {
  return [INDEX, ...ROLE_FILES].map((rel) => ({ rel, text: read(root, rel) }));
}

export function checkContent(root: string): string[] {
  const failures: string[] = [];
  const baseText = read(root, BASELINE);
  const base = paragraphs(baseText, INDEX);
  const files = outputFiles(root);
  const out = tally(files.flatMap((f) => paragraphs(f.text, f.rel)));
  for (const [p, count] of tally(base)) {
    const exc = EXCEPTIONS.find((e) => p.startsWith(e.prefix) || p.slice(0, 60) === e.prefix);
    const want = exc ? exc.remaining : count;
    const alt = amended(p);
    const have = (out.get(p) ?? 0) + (alt === undefined ? 0 : (out.get(alt) ?? 0));
    if (have !== want) {
      failures.push(`paragraph x${have} (want x${want}): ${JSON.stringify(p.slice(0, 80))}`);
    }
  }
  // Obligation sentences: MUST / SHALL (covers MUST NOT, SHALL NOT).
  const outBlob = files
    .map((f) => normalizeLinks(f.text, f.rel))
    .join("\n")
    .replace(/\s+/g, " ");
  for (const p of base) {
    for (const raw of p.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
      if (!/\b(MUST|SHALL)\b/.test(raw)) continue;
      const s = raw.trim();
      if (outBlob.includes(s)) continue;
      if (OBLIGATION_EXCEPTIONS.some((e) => s.startsWith(e.prefix))) continue;
      failures.push(`obligation sentence lost: ${JSON.stringify(s.slice(0, 80))}`);
    }
  }
  return failures;
}

export function checkSizes(root: string): string[] {
  const failures: string[] = [];
  const size = (rel: string): number => Buffer.byteLength(read(root, rel));
  if (size(INDEX) > INDEX_CAP) failures.push(`index is ${size(INDEX)} bytes (cap ${INDEX_CAP})`);
  for (const rel of ROLE_FILES) {
    if (size(rel) >= ROLE_CAP) failures.push(`${rel} is ${size(rel)} bytes (cap < ${ROLE_CAP})`);
  }
  return failures;
}

function slug(heading: string): string {
  return heading
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function normName(s: string): string {
  return s
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.:]+$/, "")
    .trim()
    .toLowerCase();
}

interface Anchors {
  readonly ids: Set<string>;
  readonly headings: Set<string>;
  readonly names: Set<string>;
}

function collectAnchors(text: string): Anchors {
  const ids = new Set<string>();
  const headings = new Set<string>();
  const names = new Set<string>();
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const a = /^<a id="([^"]+)"><\/a>$/.exec(line);
    if (a) ids.add(a[1]!);
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) {
      ids.add(slug(h[1]!));
      headings.add(normName(h[1]!));
      names.add(normName(h[1]!));
    }
    for (const b of line.matchAll(/\*\*([^*]+?)\*\*/g)) {
      const full = normName(b[1]!);
      names.add(full);
      names.add(full.split(" — ")[0]!);
    }
    const li = /^- \[([^\]]+)\]\(/.exec(line);
    if (li) {
      names.add(normName(li[1]!));
      names.add(normName(li[1]!.split(" — ")[0]!));
    }
  }
  return { ids, headings, names };
}

export function checkAnchors(root: string): string[] {
  const failures: string[] = [];
  const anchors = new Map<string, Anchors>();
  for (const rel of [INDEX, ...ROLE_FILES]) anchors.set(rel, collectAnchors(read(root, rel)));
  const indexAnchors = anchors.get(INDEX)!;
  const allNames = new Set<string>();
  for (const a of anchors.values()) for (const n of a.names) allNames.add(n);

  // (c) every index stub and rule entry reaches its target file and anchor.
  for (const m of read(root, INDEX).matchAll(/\]\((agent-team-protocol\/[^)#]+)#([^)]+)\)/g)) {
    const rel = path.posix.join("docs", m[1]!);
    const a = anchors.get(rel);
    if (!a) failures.push(`stub target missing: ${rel}`);
    else if (!a.ids.has(m[2]!)) failures.push(`stub anchor missing: ${rel}#${m[2]}`);
  }

  // (a) fragment links into the protocol, plus same-file fragments in the index and role files.
  const linkRe = /agent-team-protocol(?:\/([a-z-]+))?\.md#([A-Za-z0-9_-]+)/g;
  for (const rel of REFERENCING_FILES) {
    const text = maybeRead(root, rel);
    if (text === undefined) continue;
    for (const m of text.matchAll(linkRe)) {
      const target = m[1] ? `${ROLE_DIR}/${m[1]}.md` : INDEX;
      const a = anchors.get(target);
      if (!a) failures.push(`${rel}: link target missing: ${target}`);
      else if (!a.ids.has(m[2]!)) failures.push(`${rel}: anchor #${m[2]} missing in ${target}`);
    }
  }
  for (const [rel, a] of anchors) {
    for (const m of read(root, rel).matchAll(/\]\(#([^)\s]+)\)/g)) {
      if (!a.ids.has(m[1]!)) failures.push(`${rel}: same-file anchor #${m[1]} missing`);
    }
  }

  // (b) named forms: `agent-team-protocol.md` → *Section → Subsection*.
  const named = /agent-team-protocol(?:\.md)?`?(?:\]\([^)]*\))?\)?\s*→\s*\*([^*]+)\*/g;
  for (const rel of REFERENCING_FILES) {
    const text = maybeRead(root, rel)?.replace(/\s+/g, " ");
    if (text === undefined) continue;
    for (const m of text.matchAll(named)) {
      const segs = m[1]!.split(" → ").map(normName);
      segs.forEach((seg, i) => {
        const ok = i === 0 && segs.length > 1 ? indexAnchors.headings.has(seg) : allNames.has(seg);
        if (!ok) failures.push(`${rel}: named form segment not found: ${JSON.stringify(seg)}`);
      });
    }
  }
  return failures;
}

function checkAll(root: string): string[] {
  return [...checkContent(root), ...checkSizes(root), ...checkAnchors(root)];
}

function copyTree(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atp-split-"));
  for (const rel of [BASELINE, INDEX, ...ROLE_FILES, ...REFERENCING_FILES]) {
    const src = path.join(REPO, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return tmp;
}

function withMutation(mutate: (root: string) => void): string[] {
  const tmp = copyTree();
  try {
    mutate(tmp);
    return checkAll(tmp);
  } finally {
    // Delete only the directory this test created.
    assert.ok(path.basename(tmp).startsWith("atp-split-"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("agent-team-protocol split guards (spec 0274)", () => {
  test("the frozen baseline is the 56,003-byte original", () => {
    assert.equal(fs.statSync(path.join(REPO, BASELINE)).size, BASELINE_BYTES);
  });

  test("no baseline paragraph or MUST/SHALL sentence is lost", () => {
    assert.deepEqual(checkContent(REPO), []);
  });

  test("index and role files stay within their size caps", () => {
    assert.deepEqual(checkSizes(REPO), []);
  });

  test("every protocol anchor, named form and index stub resolves", () => {
    assert.deepEqual(checkAnchors(REPO), []);
  });

  test("mutation: a broken anchor is caught", () => {
    const failures = withMutation((root) => {
      const f = path.join(root, `${ROLE_DIR}/team-communication.md`);
      fs.writeFileSync(
        f,
        fs.readFileSync(f, "utf8").replace('<a id="rule-3"></a>', '<a id="rule-three"></a>'),
      );
    });
    assert.ok(
      failures.some((x) => x.includes("rule-3")),
      failures.join("\n"),
    );
  });

  test("mutation: a dropped paragraph is caught", () => {
    const failures = withMutation((root) => {
      const f = path.join(root, `${ROLE_DIR}/built-components.md`);
      const parts = fs.readFileSync(f, "utf8").split("\n\n");
      parts.splice(parts.length - 1, 1);
      fs.writeFileSync(f, parts.join("\n\n") + "\n");
    });
    assert.ok(
      failures.some((x) => x.startsWith("paragraph x0")),
      failures.join("\n"),
    );
  });

  test("amendments apply to exactly one baseline paragraph each", () => {
    const base = paragraphs(read(REPO, BASELINE), INDEX);
    for (const a of AMENDMENTS) {
      assert.equal(base.filter((p) => p.startsWith(a.prefix)).length, 1, a.prefix);
      assert.notEqual(amended(base.find((p) => p.startsWith(a.prefix)) as string), undefined);
    }
  });

  test("mutation: an amended paragraph reverted to neither form is caught", () => {
    for (const a of AMENDMENTS) {
      const failures = withMutation((root) => {
        for (const rel of ROLE_FILES) {
          const f = path.join(root, rel);
          const t = fs.readFileSync(f, "utf8");
          const tail = a.to.slice(-20); // link targets differ in role files, so mutate the tail
          if (t.includes(tail)) fs.writeFileSync(f, t.replace(tail, "REWORDED WITHOUT AMENDMENT"));
        }
      });
      assert.ok(
        failures.some((x) => x.startsWith("paragraph x0")),
        `${a.requirement}: ${failures.join("\n")}`,
      );
    }
  });

  test("mutation: a trimmed MUST sentence is caught", () => {
    const failures = withMutation((root) => {
      const f = path.join(root, `${ROLE_DIR}/orchestrator.md`);
      const text = fs.readFileSync(f, "utf8");
      assert.ok(text.includes(" SHALL "));
      fs.writeFileSync(f, text.replace(/ SHALL /g, " should "));
    });
    assert.ok(
      failures.some((x) => x.startsWith("obligation sentence lost")),
      failures.join("\n"),
    );
  });

  test("mutation: an inflated role file is caught", () => {
    const failures = withMutation((root) => {
      fs.appendFileSync(path.join(root, `${ROLE_DIR}/built-components.md`), "x".repeat(ROLE_CAP));
    });
    assert.ok(
      failures.some((x) => x.includes("built-components.md is")),
      failures.join("\n"),
    );
  });

  test("CI wiring: governance-checks-ts runs on docs and AGENTS.md edits", () => {
    const text = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");
    const caps = (
      yamlLib.load(text) as {
        capabilities?: { id: string; paths?: string[]; trigger: { paths?: string[] }[] }[];
      }
    ).capabilities;
    const cap = caps?.find((c) => c.id === "governance-checks-ts");
    assert.ok(cap, "capability governance-checks-ts exists");
    assert.ok(cap.trigger.length >= 2);
    for (const t of cap.trigger) {
      for (const p of ["docs/**", "AGENTS.md", "scripts/tests/fixtures/agent-team-protocol/**"]) {
        assert.ok(effectivePaths(cap, t).includes(p), `trigger path ${p}`);
      }
    }
  });
});
