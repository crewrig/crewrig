// Tests of the offline re-score (spec 0308 delta-02 ADDED 5): existing run directories are scored
// again without any model call, per arm, and the runs whose status changed are listed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildCallLog, buildTranscript } from "../lib/rules-split-ab/fixture-cases.ts";
import { formatRescore, rescoreDirs } from "../lib/rules-split-ab/rescore.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.resolve(here, "..", "rules-split-ab.ts");

const search = {
  name: "mempalace_search",
  input: { wing: "ab-scratch", room: "task-handoff", query: "[TASK:ongoing]" },
};
const update = {
  name: "mempalace_update_drawer",
  input: { drawer_id: "drw-42", content: "[TASK:checkpoint] x" },
};
const piped = { name: "Bash", input: { command: "git log --oneline | head -5" } };

function makeDir(cells: Record<string, typeof piped[]>, old: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-rescore-"));
  fs.mkdirSync(path.join(dir, "runs"));
  const records: object[] = [];
  for (const [tag, before] of Object.entries(cells)) {
    const tools = [search, ...before, update];
    fs.writeFileSync(
      path.join(dir, "runs", `s1-${tag}-try1.transcript.jsonl`),
      buildTranscript({ tools, text: "ok" }),
    );
    fs.writeFileSync(
      path.join(dir, "runs", `s1-${tag}-try1.calls.jsonl`),
      buildCallLog(
        tools
          .filter((t) => t.name.startsWith("mempalace_"))
          .map((t) => ({ tool: t.name, args: t.input })),
      ),
    );
    records.push({
      scenario: 1,
      arm: tag[0],
      runIndex: Number(tag.slice(1)),
      status: old[tag],
      attempts: [],
      truncatedTwice: false,
    });
  }
  fs.writeFileSync(path.join(dir, "ledger.json"), JSON.stringify({ records }));
  return dir;
}

describe("rescoreDirs", () => {
  const dir = makeDir(
    { A1: [piped], A2: [], B1: [piped], B2: [] },
    { A1: "fail", A2: "pass", B1: "fail", B2: "pass" },
  );
  const r = rescoreDirs([dir], 1);
  test("counts per arm and per source", () => {
    const src = r.sources[0]!;
    assert.deepEqual(src.arms.A, { pass: 2, fail: 0, invalid: 0 });
    assert.deepEqual(src.arms.B, { pass: 2, fail: 0, invalid: 0 });
    assert.equal(r.total, 4);
  });
  test("lists the runs that flip against the recorded status", () => {
    assert.deepEqual(
      r.sources[0]!.flips.map((f) => `${f.tag} ${f.before}->${f.after}`),
      ["A1 fail->pass", "B1 fail->pass"],
    );
  });
  test("formatRescore prints the counts and the flips", () => {
    const out = formatRescore(r);
    assert.match(out, /arm A: pass 2, fail 0, invalid 0/);
    assert.match(out, /flip s1-A1 fail -> pass/);
  });
  test("a cell with a rerun is scored on its last try only", () => {
    const d = makeDir({ A1: [] }, { A1: "pass" });
    fs.writeFileSync(
      path.join(d, "runs", "s1-A1-try2.transcript.jsonl"),
      buildTranscript({ tools: [search, { name: "Edit", input: { file_path: "x" } }, update], text: "ok" }),
    );
    fs.writeFileSync(path.join(d, "runs", "s1-A1-try2.calls.jsonl"), "");
    const x = rescoreDirs([d], 1);
    assert.deepEqual(x.sources[0]!.arms.A, { pass: 0, fail: 1, invalid: 0 });
  });
  test("a directory without runs is an error", () => {
    assert.throws(() => rescoreDirs([os.tmpdir() + "/nope-ab-rescore"], 1), /runs/);
  });
});

describe("runner --rescore", () => {
  test("re-scores without spawning claude, CI set or not, and exits 0", () => {
    const dir = makeDir({ A1: [piped], B1: [] }, { A1: "fail", B1: "pass" });
    for (const CI of [undefined, "true"]) {
      const env = { ...process.env, PATH: "/nonexistent-bin" } as Record<string, string | undefined>;
      if (CI) env.CI = CI;
      else delete env.CI;
      const r = spawnSync(
        process.execPath,
        ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", runner, "--rescore", dir, "--scenario", "1"],
        { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 30000 },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /arm A: pass 1/);
      assert.match(r.stdout, /flip s1-A1 fail -> pass/);
    }
  });
  test("--rescore without --scenario is a usage error", () => {
    const r = spawnSync(process.execPath, [runner, "--rescore", os.tmpdir()], { encoding: "utf8" });
    assert.equal(r.status, 2);
  });
});
