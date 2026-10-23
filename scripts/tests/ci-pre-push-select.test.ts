// Tests for scripts/lib/ci-pre-push/select.ts (spec 0279 R8, R9): changeset-aware selection over
// mkdtemp git repositories, plus the fast-tier time budget over the REAL tier and capability files.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PrePushError,
  loadCapabilities,
  loadTier,
  selectForShas,
  selectFromChangeset,
} from "../lib/ci-pre-push/select.ts";
import { addSelfRemote, commitAll, git, newRepo, writeRel } from "./lib/governance-git-fixture.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const cap = (id: string, paths?: string[]): string => `  - id: ${id}
    name: "${id}"
    trigger:
      - on: pull-request
        branches: [main]${paths === undefined ? "" : `\n        paths:\n${paths.map((p) => `          - "${p}"`).join("\n")}`}
    portability: portable
    command:
      - echo ${id}
`;

const CAPS = (extra = ""): string =>
  `capabilities:\n${[
    cap("always"),
    cap("docs", ["docs/**"]),
    cap("specs", ["specs/**"]),
    cap("tasks", ["taskfiles/**"]),
    cap("arts", ["artifacts/**/*.md"]),
  ].join("")}${extra}`;

const TIER = (ids: readonly string[]): string =>
  JSON.stringify(Object.fromEntries(ids.map((i) => [i, 1])));
const ALL = ["always", "docs", "specs", "tasks", "arts"];

/** A repo on `main` with the fixtures committed and `origin` pointing at itself. */
function fixture(caps = CAPS(), tier = TIER(ALL)): string {
  const dir = newRepo();
  writeRel(dir, "ci/ci-capabilities.yml", caps);
  writeRel(dir, "ci/pre-push-tier.json", tier);
  writeRel(dir, "README.md", "base\n");
  commitAll(dir, "base");
  addSelfRemote(dir, "origin");
  git(dir, ["checkout", "-q", "-b", "feature"]);
  return dir;
}

let shared: string | undefined;
let branches = 0;

/** The shared base repository on a fresh branch cut from main (cheaper than one repo per test). */
function onBranch(): string {
  shared ??= fixture();
  git(shared, ["checkout", "-q", "-b", `t${branches++}`, "main"]);
  return shared;
}

function select(dir: string, extraEnv: NodeJS.ProcessEnv = {}): ReturnType<typeof selectForShas> {
  return selectForShas(dir, [git(dir, ["rev-parse", "HEAD"])], {
    ...process.env,
    CREWRIG_PRE_PUSH_BASE: undefined,
    ...extraEnv,
  });
}

function commitFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) writeRel(dir, rel, text);
  commitAll(dir, "change");
}

describe("selectForShas over a real repository", () => {
  it("selects only the always-run capability for a docs-only change plus the docs one", () => {
    const dir = onBranch();
    commitFiles(dir, { "docs/a.md": "x" });
    assert.deepEqual(select(dir).ids, ["always", "docs"]);
  });

  it("selects the specs capability for a specs-only change", () => {
    const dir = onBranch();
    commitFiles(dir, { "specs/0001-x.md": "x" });
    assert.deepEqual(select(dir).ids, ["always", "specs"]);
  });

  it("selects the taskfiles capability for a taskfiles-only change", () => {
    const dir = onBranch();
    commitFiles(dir, { "taskfiles/new.yml": "x" });
    assert.deepEqual(select(dir).ids, ["always", "tasks"]);
  });

  it("selects the artifacts capability for a nested artifacts change", () => {
    const dir = onBranch();
    commitFiles(dir, { "artifacts/core/skills/x/SKILL.md": "x" });
    assert.deepEqual(select(dir).ids, ["always", "arts"]);
  });

  it("keeps the always-run capability for an empty changeset", () => {
    const dir = onBranch();
    const sel = select(dir);
    assert.deepEqual(sel.ids, ["always"]);
    assert.equal(sel.baseRef, "origin/main");
  });

  it("runs every tier capability with a notice when the base does not resolve", () => {
    const dir = onBranch();
    commitFiles(dir, { "docs/a.md": "x" });
    const sel = select(dir, { CREWRIG_PRE_PUSH_BASE: "origin/nope" });
    assert.deepEqual(sel.ids, ALL);
    assert.equal(sel.baseRef, null);
    assert.match(sel.notices.join("\n"), /target ref 'origin\/nope' does not resolve locally/);
  });

  it("ignores an uncommitted file", () => {
    const dir = fixture();
    commitFiles(dir, { "docs/a.md": "x" });
    writeRel(dir, "specs/dirty.md", "uncommitted");
    assert.deepEqual(select(dir).ids, ["always", "docs"]);
  });

  it("shows both paths of a rename", () => {
    const dir = newRepo();
    writeRel(dir, "ci/ci-capabilities.yml", CAPS());
    writeRel(dir, "ci/pre-push-tier.json", TIER(ALL));
    writeRel(dir, "docs/moved.md", "content that is long enough to be detected as a rename\n");
    commitAll(dir, "base");
    addSelfRemote(dir, "origin");
    git(dir, ["checkout", "-q", "-b", "feature"]);
    fs.mkdirSync(path.join(dir, "specs"));
    git(dir, ["mv", "docs/moved.md", "specs/moved.md"]);
    git(dir, ["commit", "-q", "-m", "rename"]);
    assert.deepEqual(select(dir).ids, ["always", "docs", "specs"]);
  });

  it("is fatal on an unsupported glob in a selected capability", () => {
    const dir = fixture(CAPS(cap("weird", ["docs/{a,b}.md"])), TIER([...ALL, "weird"]));
    commitFiles(dir, { "docs/a.md": "x" });
    assert.throws(
      () => select(dir),
      (e: unknown) => e instanceof PrePushError && /weird/.test(e.message),
    );
  });

  it("fails closed when the tier names a capability that does not exist", () => {
    const dir = fixture(CAPS(), TIER([...ALL, "ghost"]));
    assert.throws(() => select(dir), /names 'ghost'/);
  });
});

describe("selectFromChangeset (pure)", () => {
  const caps = loadCapabilitiesFrom(CAPS());

  it("selects everything for a null changeset", () => {
    assert.deepEqual(selectFromChangeset(caps, { always: 1, docs: 1 }, null).ids, [
      "always",
      "docs",
    ]);
  });

  it("runs a capability without a pull-request trigger and says so", () => {
    const pushOnly = loadCapabilitiesFrom(
      "capabilities:\n  - id: p\n    name: p\n    trigger:\n      - on: push\n        branches: [main]\n    portability: portable\n    command:\n      - echo p\n",
    );
    const r = selectFromChangeset(pushOnly, { p: 1 }, ["README.md"]);
    assert.deepEqual(r.ids, ["p"]);
    assert.match(r.notices.join(), /no pull-request trigger/);
  });
});

function loadCapabilitiesFrom(text: string): ReturnType<typeof loadCapabilities> {
  const dir = newRepo();
  writeRel(dir, "ci/ci-capabilities.yml", text);
  return loadCapabilities(dir);
}

describe("fast-tier budget over the real files", () => {
  const POOL = 4;
  const tier = loadTier(REPO);
  const caps = loadCapabilities(REPO);

  it("gives every tier id a number and a capability", () => {
    const ids = new Set(caps.map((c) => c.id));
    for (const [id, seconds] of Object.entries(tier)) {
      assert.equal(typeof seconds, "number", id);
      assert.ok(ids.has(id), `${id} has no capability`);
    }
    assert.ok(fs.existsSync(path.join(REPO, "ci", "pre-push-tier.json")));
  });

  it("keeps each value at most 30 s and the always-run sum within the pool budget", () => {
    let sum = 0;
    for (const [id, seconds] of Object.entries(tier)) {
      assert.ok(seconds <= 30, `${id} is ${seconds}s`);
      const prs =
        caps.find((c) => c.id === id)?.triggers.filter((t) => t.kind === "pull-request") ?? [];
      const always = prs.length === 0 || prs.some((t) => t.paths.length === 0 || t.pathsBad);
      if (always) sum += seconds;
    }
    assert.ok(sum <= 60 * POOL, `always-run sum ${sum}s exceeds ${60 * POOL}s`);
  });
});
