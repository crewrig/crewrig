// setup-golden-harness.test.ts — unit tests of the setup golden harness (spec 0256 requirement 7):
// placeholders, the before/after tree, modes, `.golden` names, the regen directory and the
// failure message. A tiny fake setup stands in for the real one, written into the TEMPORARY
// sandbox by `seed`; no real setup runs here.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  FIXTURES_DIR,
  checkGolden,
  goldenDir,
  normalize,
  readGolden,
  runCase,
  serialize,
  treeOf,
  writeGolden,
} from "./lib/setup-golden-regen.ts";
import { snapshot } from "./lib/setup-golden-tree.ts";
import type { GoldenCase } from "./lib/setup-golden-types.ts";
import { createSetupSandbox } from "./lib/setup-sandbox.ts";

const temps: string[] = [];
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-harness-"));
  temps.push(dir);
  return dir;
};
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const FAKE = `set -eu
mkdir -p "$HOME/.claude/rules" dist
printf 'rules for %s\\r\\n' "$HOME" > "$HOME/.claude/rules/10-level.md"
chmod 600 "$HOME/.claude/rules/10-level.md"
printf 'old\\n' > "$HOME/.claude/rules/10-level.md.bak.20260101-120000"
printf 'older\\n' > "$HOME/.claude/rules/10-level.md.bak.20260101-120000.01"
printf '#!/bin/sh\\n' > dist/run.sh
chmod 755 dist/run.sh
ln -s "$HOME/.claude/rules/10-level.md" "$HOME/.claude/link"
echo "in $PWD at 2026-10-10T12:00:00Z via tmp.AbCd1234 pid 4242"
echo "warn: $HOME" >&2
exit 3
`;

const fakeCase: GoldenCase = {
  id: "fake-run",
  cli: "claude",
  note: "harness self-test",
  seed(sb) {
    fs.writeFileSync(path.join(sb.repo, "scripts/setup-claude-interactive.sh"), FAKE);
  },
};

test("normalize: sandbox paths, backup stamps, timestamps, mktemp names and pids", () => {
  const sb = createSetupSandbox();
  const text = [
    `${sb.home}/.claude/a.bak.20260101-120000 ${sb.home}/b.bak.20260101-120000.07`,
    `${sb.repo}/dist ${sb.root}/stub-state 2026-10-10T12:00:00Z`,
    "/tmp/tmp.AbC123xyz pid=981 PID 7",
  ].join("\n");
  assert.equal(
    normalize(text, sb),
    [
      "<HOME>/.claude/a.bak.<STAMP> <HOME>/b.bak.<STAMP>",
      "<REPO>/dist <SANDBOX>/stub-state <ISO>",
      "/tmp/tmp.<RAND> pid=<PID> PID <PID>",
    ].join("\n"),
  );
});

test("runCase: the tree holds only what the run wrote, with modes, links, hashes and bak counts", () => {
  const result = runCase(fakeCase, "shell");
  assert.equal(result.status, 3);
  assert.match(result.stdout, /^in <REPO> at <ISO> via tmp\.<RAND> pid <PID>\n$/);
  assert.equal(result.stderr, "warn: <HOME>\n");
  const byPath = new Map(result.tree.map((e) => [e.path, e]));
  assert.equal(byPath.get("<HOME>/.claude/rules/10-level.md")?.mode, "0600");
  assert.equal(byPath.get("<REPO>/dist/run.sh")?.mode, "0755");
  assert.equal(
    byPath.get("<HOME>/.claude/link")?.target,
    "link -> <HOME>/.claude/rules/10-level.md",
  );
  assert.equal(byPath.get("<HOME>/.claude/rules")?.kind, "dir");
  assert.equal(byPath.get("<REPO>/package.json"), undefined, "fixture files are not in the tree");
  assert.equal(byPath.get("<REPO>/config/SOUL.md"), undefined);
  assert.ok(byPath.has("<REPO>/scripts/setup-claude-interactive.sh"), "a seeded file is a change");
  assert.deepEqual(result.bakCount, { "<HOME>/.claude/rules/10-level.md": 2 });
  const paths = result.tree.map((e) => e.path);
  assert.deepEqual(paths, [...paths].sort());
});

test("the hash is of the placeholdered LF text: stable across two sandboxes", () => {
  const a = runCase(fakeCase, "shell");
  const b = runCase(fakeCase, "shell");
  assert.deepEqual(a, b);
  const rules = a.tree.find((e) => e.path === "<HOME>/.claude/rules/10-level.md");
  assert.equal(rules?.sha256?.length, 64);
  assert.match(rules?.sha256 ?? "", /^[0-9a-f]{64}$/);
});

test("treeOf without a baseline lists the fixture files; with one, a removal is recorded", () => {
  const sb = createSetupSandbox();
  assert.ok(treeOf(sb).some((e) => e.path === "<REPO>/package.json"));
  const before = snapshot(sb);
  fs.rmSync(path.join(sb.repo, "package.json"));
  assert.deepEqual(treeOf(sb, before), [{ path: "<REPO>/package.json", kind: "removed" }]);
});

test("writeGolden stores four `.golden` files; readGolden returns them; an unknown case throws", () => {
  const base = tmp();
  const result = runCase(fakeCase, "shell");
  const dir = writeGolden("claude", "fake-run", result, base);
  assert.equal(dir, goldenDir("claude", "fake-run", base));
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    "status.golden",
    "stderr.golden",
    "stdout.golden",
    "tree.json.golden",
  ]);
  assert.deepEqual(readGolden("claude", "fake-run", base), serialize(result));
  const stored: unknown = JSON.parse(serialize(result)["tree.json"]);
  assert.deepEqual(
    typeof stored === "object" && stored !== null ? Reflect.get(stored, "bakCount") : null,
    { "<HOME>/.claude/rules/10-level.md": 2 },
  );
  assert.throws(() => readGolden("claude", "nope", base), /golden file missing: .*status\.golden/);
});

test("regen mode writes to SETUP_GOLDEN_OUT and never to the fixtures directory", () => {
  const out = tmp();
  const saved = { regen: process.env["SETUP_GOLDEN_REGEN"], out: process.env["SETUP_GOLDEN_OUT"] };
  process.env["SETUP_GOLDEN_REGEN"] = "1";
  process.env["SETUP_GOLDEN_OUT"] = out;
  try {
    checkGolden(fakeCase, runCase(fakeCase, "shell"), "shell");
  } finally {
    for (const [key, value] of [
      ["SETUP_GOLDEN_REGEN", saved.regen],
      ["SETUP_GOLDEN_OUT", saved.out],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.ok(fs.existsSync(path.join(out, "claude/fake-run/stdout.golden")));
  assert.equal(fs.existsSync(goldenDir("claude", "fake-run", FIXTURES_DIR)), false);
});

test("a failing comparison names the case and prints a readable diff", () => {
  const base = tmp();
  const result = runCase(fakeCase, "shell");
  writeGolden("claude", "fake-run", result, base);
  checkGolden(fakeCase, result, "shell", base);
  const drifted = { ...result, stdout: "changed line\n", status: 0 };
  assert.throws(
    () => checkGolden(fakeCase, drifted, "ts", base),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /golden mismatch for claude\/fake-run \[ts\]: harness self-test/);
      assert.match(message, /--- claude\/fake-run\/stdout\.golden \(expected\)/);
      assert.match(message, /^-in <REPO> at <ISO>/m);
      assert.match(message, /^\+changed line$/m);
      assert.match(message, /^-3$/m);
      assert.doesNotMatch(message, /stderr\.golden/);
      return true;
    },
  );
});
