// Spec 0283 R5/R6: the path gate, ci-cache-guard --capability/--print-key and the ci-job action.
// Fixtures live in mkdtemp directories only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { cacheKey } from "../lib/ci-cache-guard/key.ts";
import { decide } from "../lib/ci-paths-gate/gate.ts";

const ok = (out: string) => async () => out;
const G = { "pull-request": ["a/**"], push: ["a/**"] };

test("pull_request: match and no match", async () => {
  assert.equal((await decide("x", "pull_request", "", G, ok("a/f\nb/g\n"))).changed, true);
  assert.equal((await decide("x", "pull_request", "", G, ok("b/g\n"))).changed, false);
});
test("no base and missing before fail open with a reason", async () => {
  const d = await decide("x", "push", "0".repeat(40), G, ok(""));
  assert.deepEqual([d.changed, d.failOpen], [true, "no base commit"]);
  const fail = async (a: string[]) => {
    if (a[0] === "diff" || a[0] === "fetch") throw new Error("boom");
    if (a[0] === "rev-parse") return "other";
    throw new Error("missing");
  };
  const d2 = await decide("x", "push", "abc123", G, fail);
  assert.equal(d2.changed, true);
  assert.match(d2.failOpen ?? "", /not fetchable/);
});
test("schedule and no paths are always true; unsupported glob throws", async () => {
  assert.equal((await decide("x", "schedule", "", G)).changed, true);
  assert.equal((await decide("x", "workflow_dispatch", "", G)).changed, true);
  assert.equal((await decide("x", "pull_request", "", {}, ok("z"))).changed, true);
  await assert.rejects(decide("x", "pull_request", "", { "pull-request": ["a/{b,c}"] }, ok("z")));
});

const REF = `capabilities:
  - id: demo
    name: "Demo"
    trigger:
      - on: pull-request
        branches: [main]
    portability: portable
    paths:
      - "a/**"
    cache:
      env: [FOO]
    command:
      - echo hi
`;
function repo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  fs.mkdirSync(path.join(d, "ci"));
  fs.mkdirSync(path.join(d, "a"));
  fs.writeFileSync(path.join(d, "ci/ci-capabilities.yml"), REF);
  fs.writeFileSync(path.join(d, "a/f.txt"), "hello");
  return d;
}
// The gate reads GITHUB_OUTPUT and the event variables; a CI runner sets them, so scrub every
// GITHUB_* and GATE_* variable to keep the stdout assertions hermetic on any host.
const hermeticEnv = (env: Record<string, string>): NodeJS.ProcessEnv => {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^(GITHUB_|GATE_)/.test(k)) delete base[k];
  return { ...base, ...env };
};
const cli = (script: string, args: string[], cwd: string, env: Record<string, string> = {}) =>
  spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.resolve(script), ...args],
    { cwd, encoding: "utf8", env: { ...hermeticEnv(env), REPO_DIR: cwd } },
  );

test("cli: shadow annotations, unsupported glob exit 2, schedule", () => {
  const d = repo();
  const a = cli(
    "scripts/ci-paths-gate.ts",
    ["--capability", "demo", "--event", "schedule", "--filter-result", "true"],
    d,
  );
  assert.match(a.stdout, /changed=true/);
  assert.match(a.stdout, /::notice title=ci-paths-gate-shadow::demo agree filter=true gate=true/);
  const b = cli(
    "scripts/ci-paths-gate.ts",
    ["--capability", "demo", "--event", "schedule", "--filter-result", "false"],
    d,
  );
  assert.match(
    b.stdout,
    /::warning title=ci-paths-gate-shadow::demo DISAGREE filter=false gate=true/,
  );
  fs.writeFileSync(path.join(d, "ci/ci-capabilities.yml"), REF.replace('"a/**"', '"a/{b,c}"'));
  const c = cli("scripts/ci-paths-gate.ts", ["--capability", "demo", "--event", "pull_request"], d);
  assert.equal(c.status, 2);
});

test("cache guard: --print-key equals the --key-files hash and --capability resolves the lists", () => {
  const d = repo();
  const direct = cacheKey({ keyFiles: "a/**", keyEnv: "FOO", args: [], cwd: d, env: { FOO: "1" } });
  const p = cli(
    "scripts/ci-cache-guard.ts",
    ["--key-files", "a/**", "--key-env", "FOO", "--print-key"],
    d,
    { FOO: "1" },
  );
  assert.equal(p.stdout.trim(), direct);
  const c = cli("scripts/ci-cache-guard.ts", ["--capability", "demo", "--print-key"], d, {
    FOO: "1",
  });
  assert.equal(c.stdout.trim(), direct);
  const m = cli(
    "scripts/ci-cache-guard.ts",
    ["--capability", "demo", "--key-files", "x", "--print-key"],
    d,
  );
  assert.equal(m.status, 2);
});

test("ci-job action: inputs, step order, gated cancel step, no || true", () => {
  const t = fs.readFileSync(".github/actions/ci-job/action.yml", "utf8");
  for (const i of ["id:", "node:", "install:", "task:", "cache:", "shadow-filter:"])
    assert.ok(t.includes(`\n  ${i}`), i);
  const order = [
    "actions/setup-node",
    "ci-paths-gate.ts",
    "setup-task",
    "npm ci",
    "node-floor-guard",
    'task "ci:',
    "cancel-on-failure",
  ];
  let at = -1;
  for (const o of order) {
    const n = t.indexOf(o, at + 1);
    assert.ok(n > at, `${o} out of order`);
    at = n;
  }
  assert.match(
    t,
    /node-version: \$\{\{ inputs\.node \}\}\n\s+cache: \$\{\{ inputs\.install != 'none' && 'npm' \|\| '' \}\}/,
    "setup-node caches npm unless install is none",
  );
  assert.match(
    t,
    /run == 'true' && failure\(\)\n\s+uses: \.\/\.github\/actions\/cancel-on-failure/,
  );
  assert.ok(!/\|\|\s*true/.test(t));
});

test("ci-job action: no expression inside a run script, one production install (i2-F1, i2-F2)", () => {
  const t = fs.readFileSync(".github/actions/ci-job/action.yml", "utf8");
  // i2-F2: every inputs.*/steps.* value reaches a `run:` through env:, never interpolated.
  const lines = t.split("\n");
  for (const [i, line] of lines.entries()) {
    const m = /^(\s*)run: (\|)?(.*)$/.exec(line);
    if (!m) continue;
    const indent = (m[1] ?? "").length;
    const body = [m[3] ?? ""];
    if (m[2]) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j] ?? "";
        if (l.trim() !== "" && l.length - l.trimStart().length <= indent) break;
        body.push(l);
      }
    }
    assert.ok(!body.join("\n").includes("${{"), `expression interpolated in run at line ${i + 1}`);
  }
  // i2-F1: the pre-gate production install is the only one; omit-dev adds no second install.
  const prod = t.match(/run: npm ci --omit=dev --workspaces=false/g) ?? [];
  assert.equal(prod.length, 1, "exactly one production install");
  assert.ok(
    t.indexOf("npm ci --omit=dev") < t.indexOf("ci-paths-gate.ts"),
    "the production install precedes the gate",
  );
});
