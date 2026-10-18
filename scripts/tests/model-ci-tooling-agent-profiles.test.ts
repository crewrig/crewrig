// model-ci-tooling-agent-profiles.test.ts — TS-only assertions of scripts/check-agent-profiles.ts
// (spec 0262 requirements 7, 24): the real repository, the exit 2 paths and the deliberate
// deviations. The shell-versus-TypeScript comparison was retired with the switch; the case table
// is asserted by scripts/tests/check-agent-profiles-*.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/worktree-fixtures.ts";

const TS = path.join(REPO, "scripts", "check-agent-profiles.ts");
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(cmd: string, args: string[], repoDir: string): Run {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: repoDir },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const runTs = (args: string[], repo: string): Run =>
  run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS, ...args], repo);

function tree(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cap-")));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return root;
}

const BASE = `intelligence: medium
reasoning: medium
specialization: general
context: 100000
speed: fast
modalities: [text, vision]
locality: any
tuning:
  temperature: 0.7
  top-p: 0.9
  top-k: 40
  max-output-tokens: 2048
  max-turns: 10`;

/** An agent source whose metadata.model block is `block` (indented under `model:`). */
function agent(block: string): string {
  const body = block
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
  return `---\nname: probe\ndescription: "Fixture."\nmetadata:\n  model:\n${body}\n---\nBody.\n`;
}

const mutate = (from: string, to: string): string => agent(BASE.replace(from, to));

describe("check-agent-profiles.ts on the real repository and exit 2 paths", () => {
  test("the real repository, default glob, is clean", () => {
    const files = spawnSync("git", ["ls-files", "artifacts/*/agents/*/AGENT.md"], {
      cwd: REPO,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter((f) => f !== "");
    assert.ok(files.length > 0);
    const copy = tree(
      Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(REPO, f), "utf8")])),
    );
    const r = runTs([], copy);
    assert.equal(r.status, 0, r.stderr);
  });

  test("no yq prerequisite: the entry reports on the real sources with a PATH that holds no yq", () => {
    const files = spawnSync("git", ["ls-files", "artifacts/*/agents/*/AGENT.md"], {
      cwd: REPO,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter((f) => f !== "");
    assert.ok(files.length > 0);
    const copy = tree(
      Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(REPO, f), "utf8")])),
    );
    const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS], {
      encoding: "utf8",
      env: { PATH: path.dirname(process.execPath), LC_ALL: "C", CREWRIG_REPO_DIR: copy },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /yq/);
    const bad = tree({
      "artifacts/core/agents/probe/AGENT.md": mutate("speed: fast", "speed: bogus"),
    });
    const rb = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS], {
      encoding: "utf8",
      env: { PATH: path.dirname(process.execPath), LC_ALL: "C", CREWRIG_REPO_DIR: bad },
    });
    assert.equal(rb.status, 1, rb.stderr);
  });

  test("exit 2 paths", () => {
    assert.equal(runTs([], tree({ "x.txt": "" })).status, 2);
    assert.equal(runTs([], tree({ "artifacts/core/agents/x/readme.md": "" })).status, 2);
    assert.equal(runTs(["/nonexistent/AGENT.md"], tree({ "x.txt": "" })).status, 2);
  });
});

describe("check-agent-profiles.ts alone", () => {
  test("a 65-bit integer knob is one Error line, exit 1 (requirement 24 (c))", () => {
    const text = mutate("top-k: 40", "top-k: 99999999999999999999");
    const root = tree({ "artifacts/core/agents/probe/AGENT.md": text });
    const ts = runTs([], root);
    assert.equal(ts.status, 1);
    assert.match(ts.stderr, /^Error: .+: integer expression expected\n$/);
  });

  test("an explicit tag is one Error line, exit 1 (requirement 24 (f))", () => {
    const text = `---\nmetadata:\n  model:\n    intelligence: !custom x\n---\n`;
    const root = tree({ "artifacts/core/agents/probe/AGENT.md": text });
    const ts = runTs([], root);
    assert.equal(ts.status, 1);
    assert.match(ts.stderr, /^Error: .+: unknown tag [^\n]+\n$/);
    assert.equal(ts.stdout, "");
  });
});
