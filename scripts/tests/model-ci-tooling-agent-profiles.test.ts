// model-ci-tooling-agent-profiles.test.ts — differential test of scripts/check-agent-profiles.ts
// against scripts/check-agent-profiles.sh (spec 0262 requirements 1-4, 7, 24): the same
// input through both entries under LC_ALL=C must give equal stdout, stderr and status.
// The shell leg needs bash and yq; it is skipped on Windows and where yq is absent.
// Inputs: the real repository, then scratch trees built from the cases of
// scripts/tests/test-check-agent-profiles.sh and the yq-reader classes of requirement 31.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const SH = path.join(REPO, "scripts", "check-agent-profiles.sh");
const TS = path.join(REPO, "scripts", "check-agent-profiles.ts");
const HAS_YQ = !WINDOWS && spawnSync("yq", ["--version"], { stdio: "ignore" }).status === 0;
const SKIP = HAS_YQ ? false : "SKIP: shell leg needs bash and yq (not on win32)";
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

const runSh = (args: string[], repo: string): Run => run("bash", [SH, ...args], repo);
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

const CASES: Record<string, string> = {
  baseline: agent(BASE),
  "P1 scalar": `---\nname: p\nmetadata:\n  model: not-a-map\n---\n`,
  "P1 empty": `---\nname: p\nmetadata:\n  model:\n---\n`,
  "P1 list": `---\nname: p\nmetadata:\n  model: [a]\n---\n`,
  "P1 alias": `---\nname: p\nx: &m {intelligence: low}\nmetadata:\n  model: *m\n---\n`,
  P2: agent(`${BASE}\nbogus: x`),
  "P2 spaced key": agent(`${BASE}\n"intelligence reasoning": x`),
  "P2 duplicate keys": agent(`${BASE}\nbogus: 1\nbogus: 2`),
  P3: agent(`${BASE}\n  bogus-knob: 1`),
  P4: mutate("intelligence: medium", "intelligence: bogus"),
  "P4 alias name": mutate("intelligence: medium", "intelligence: sonnet"),
  "P4 empty": mutate("intelligence: medium", "intelligence:"),
  "P4 quoted null": mutate("intelligence: medium", 'intelligence: "~"'),
  "P4 empty collection": mutate("intelligence: medium", "intelligence: {}"),
  P5: mutate("reasoning: medium", "reasoning: off"),
  "P6 speed": mutate("speed: fast", "speed: bogus"),
  "P6 locality": mutate("locality: any", "locality: bogus"),
  "P6 member": mutate("[text, vision]", '["text", "bogus"]'),
  "P6 numeric member": mutate("[text, vision]", "[1e3, 0x1F, null, ~]"),
  P7: mutate("context: 100000", "context: 0"),
  "P7 signed": mutate("context: 100000", "context: -5"),
  "P7 float": mutate("context: 100000", "context: 1.5"),
  "P7 zeros": mutate("context: 100000", "context: 00"),
  "P7 underscore": mutate("context: 100000", "context: 1_000"),
  "P8 temp high": mutate("temperature: 0.7", "temperature: 5.0"),
  "P8 temp string": mutate("temperature: 0.7", 'temperature: "hot"'),
  "P8 temp dots": mutate("temperature: 0.7", "temperature: 1.2.3"),
  "P8 temp lone dot": mutate("temperature: 0.7", 'temperature: "."'),
  "P8 temp edge": mutate("temperature: 0.7", "temperature: 2.0"),
  "P8 top-p floor": mutate("top-p: 0.9", "top-p: 0"),
  "P8 top-p high": mutate("top-p: 0.9", "top-p: 1.5"),
  "P8 top-p one": mutate("top-p: 0.9", "top-p: 1"),
  "P8 top-k": mutate("top-k: 40", "top-k: 0"),
  "P8 top-k float": mutate("top-k: 40", "top-k: 4.5"),
  "P8 max-output-tokens": mutate("max-output-tokens: 2048", "max-output-tokens: 0"),
  "P8 max-turns": mutate("max-turns: 10", "max-turns: 0"),
  "P8 max-turns empty": mutate("max-turns: 10", "max-turns:"),
  "P8 two knobs": mutate("top-k: 40", "top-k: 0\n  max-turns: x").replace("max-turns: 10\n", ""),
  P9: mutate("specialization: general", "specialization: Not_Kebab"),
  "P9 open enum": mutate("specialization: general", "specialization: image-generation"),
  "P9 trailing dash": mutate("specialization: general", "specialization: a-"),
  "P10 list": mutate("tuning:\n  temperature: 0.7", "tuning: [a, b]\n  x: 1").replace(
    /\n {2}x: 1[\s\S]*$/,
    "",
  ),
  "P10 scalar": agent(`intelligence: low\ntuning: 3`),
  "P10 alias": agent(`intelligence: low\ntuning: *t`),
  "empty tuning": agent(`intelligence: low\ntuning: {}`),
  "P11 scalar": mutate("[text, vision]", "text"),
  "P11 mapping": mutate("[text, vision]", "{a: text}"),
  "P11 empty": mutate("[text, vision]", ""),
  "P1+P2+P4 accumulate": agent(`intelligence: x\nbogus: 1\nspeed: y`),
  "claude model only": `---\nname: p\nmetadata:\n  claude:\n    model: sonnet\n---\n`,
  "no metadata": `---\nname: p\n---\n`,
  "no front matter": `Body only.\n`,
  "front matter without close": `---\nname: p\nmetadata:\n  model:\n    intelligence: bogus\n`,
  "crlf front matter": agent(BASE).replace(/\n/g, "\r\n"),
  "metadata scalar": `---\nmetadata: x\n---\n`,
  "metadata list": `---\nmetadata: [model]\n---\n`,
  "metadata false": `---\nmetadata: false\n---\n`,
  "invalid yaml": `---\nmetadata: [unterminated\n---\n`,
  "duplicate model": `---\nmetadata:\n  model:\n    intelligence: low\n  model:\n    intelligence: bogus\n---\n`,
};

function check(label: string, args: string[], repo: string): void {
  const sh = runSh(args, repo);
  const ts = runTs(args, repo);
  assert.deepEqual(ts, sh, `${label}: TypeScript output differs from the shell`);
}

describe("check-agent-profiles.ts against check-agent-profiles.sh", { skip: SKIP }, () => {
  test("the real repository, default glob", () => {
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
    check("real tree", [], copy);
    check(
      "real tree (named)",
      files.map((f) => path.join(copy, f)),
      copy,
    );
  });

  for (const [name, text] of Object.entries(CASES)) {
    test(`case: ${name}`, () => {
      const root = tree({ "artifacts/core/agents/probe/AGENT.md": text });
      check(name, [], root);
      check(`${name} (named)`, [path.join(root, "artifacts/core/agents/probe/AGENT.md")], root);
    });
  }

  test("several sources, byte-order glob, accumulated diagnostics", () => {
    const root = tree({
      "artifacts/core/agents/b/AGENT.md": CASES["P4"] ?? "",
      "artifacts/core/agents/a-b/AGENT.md": CASES["P5"] ?? "",
      "artifacts/core/agents/a/AGENT.md": CASES["P6 speed"] ?? "",
      "artifacts/community/agents/z/AGENT.md": CASES["baseline"] ?? "",
      "artifacts/core-x/agents/y/AGENT.md": CASES["P4"] ?? "",
      "artifacts/community/agents/.hidden/AGENT.md": CASES["P4"] ?? "",
    });
    check("multi", [], root);
  });

  test("exit 2 paths", () => {
    check("no artifacts", [], tree({ "x.txt": "" }));
    check("no agent sources", [], tree({ "artifacts/core/agents/x/readme.md": "" }));
    check("missing named file", ["/nonexistent/AGENT.md"], tree({ "x.txt": "" }));
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
