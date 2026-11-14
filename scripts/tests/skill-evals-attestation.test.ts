// skill-evals-attestation.test.ts — the attestation check on schema-2 results files (spec 0304 R25,
// R13, R14, R26; 0290 R36-R39, R25). One status per selected skill, recomputed with plan.ts from the
// recorded runs and the merge-base file as it stands now. No key, no network, no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the results files are read back as untyped JSON */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestMain } from "../lib/skill-evals/attest-cli.ts";
import { attestSelection } from "../lib/skill-evals/attest.ts";
import { KEYS } from "../lib/skill-evals/results.ts";
import {
  cleanEnv,
  commitAll,
  makeRepo,
  markOrigin,
  selectionOf,
  sink,
  skillRel,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";
import {
  allPass,
  buildRecord,
  readRecord,
  stagedRuns,
  writeRaw,
  writeRecord,
} from "./lib/skill-evals-record.ts";
import { sixRig } from "./lib/skill-evals-six.ts";

const attest = (r: ReturnType<typeof sixRig>, over = {}) =>
  attestSelection(
    r.sel(),
    { regressionBlocking: false, failBlocking: false, missingEvalsBlocking: false, ...over },
    r.repo.root,
  );

function changedSkill(f: (repo: Repo, name: string) => void): void {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
    commitAll(repo, "edit");
    f(repo, "demo");
  } finally {
    repo.cleanup();
  }
}

test("a fresh schema-2 file passes with no credential variable set and prints the branch count", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeRecord(sel.skill.dirAbs, buildRecord(sel));
    repo.git("add", "-A");
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 0, s.out + s.err);
    assert.match(s.out, /^demo: pass/m);
    assert.match(s.out, /^ {2}measurements on this branch: 1$/m);
  });
});

test("the writer fixes the R6 key order", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeRecord(sel.skill.dirAbs, buildRecord(sel));
    const text = fs.readFileSync(path.join(sel.skill.dirAbs, "evals", "results.json"), "utf8");
    assert.deepEqual(Object.keys(JSON.parse(text)), [...KEYS]);
  });
});

test("stale: the scripts changed after the results file was written (R25)", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeRecord(sel.skill.dirAbs, buildRecord(sel));
    commitAll(repo, "results");
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "scripts", "run.sh"), "echo later\n");
    commitAll(repo, "scripts");
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 1);
    assert.match(s.out, /demo: stale: recorded content_hash .* differs from the current/);
  });
});

test("stale and invalid forms of the file: absent, unparseable, mock, another skill, schema 1, in-progress, another plan", () => {
  const r = sixRig();
  try {
    assert.match(attest(r).reason, /evals\/results\.json is absent/);
    const cases: [string, unknown, string, string][] = [
      ["unparseable", "{not json", "stale", "cannot be parsed"],
      ["mock", { mock: true }, "stale", "mock run"],
      [
        "schema 1",
        { skill_name: "demo", content_hash: "x", status: "pass" },
        "stale",
        "schema 1: re-measure under the sampling plan",
      ],
    ];
    for (const [title, content, status, reason] of cases) {
      writeRaw(r.dir, content);
      const o = attest(r);
      assert.equal(o.status, status, title);
      assert.match(o.reason, new RegExp(reason), title);
      assert.equal(o.blocking, true, `${title} blocks, with no setting to relax it`);
    }
    const good = buildRecord(r.sel(), { evalRuns: allPass(6, 2) });
    writeRaw(r.dir, { ...good, skill_name: "other" });
    assert.match(attest(r).reason, /names another skill/);
    writeRecord(r.dir, { ...good, status: "in-progress" });
    const ip = attest(r);
    assert.equal(ip.status, "stale");
    assert.match(ip.reason, /in-progress \(interrupted\)/);
    writeRecord(r.dir, { ...good, plan: { ...good.plan, acceptFinal: 0.5 } });
    assert.match(attest(r).reason, /plan differs from the sampling plan/);
  } finally {
    r.cleanup();
  }
});

test("a key missing, or of the wrong type, is invalid and blocks (R11)", () => {
  const r = sixRig();
  try {
    const good = buildRecord(r.sel(), { evalRuns: allPass(6, 2) }) as unknown as Record<
      string,
      unknown
    >;
    const { ledger: _l, ...noLedger } = good;
    writeRaw(r.dir, noLedger);
    assert.equal(attest(r).status, "invalid");
    assert.match(attest(r).reason, /lacks the key ledger/);
    writeRaw(r.dir, { ...good, status: "weird" });
    assert.equal(attest(r).status, "invalid");
    assert.match(attest(r).reason, /status has the wrong type/);
  } finally {
    r.cleanup();
  }
});

test("a post-measurement fixture edit makes the file stale naming the eval (R14)", () => {
  const r = sixRig();
  try {
    writeRecord(r.dir, buildRecord(r.sel(), { evalRuns: allPass(6, 2) }));
    commitAll(r.repo, "results");
    assert.equal(attest(r).status, "pass");
    fs.appendFileSync(
      path.join(r.dir, "evals", "files", "in.txt"),
      "edited after the measurement\n",
    );
    const o = attest(r);
    assert.equal(o.status, "stale");
    assert.match(o.reason, /eval 1 changed after the measurement/);
  } finally {
    r.cleanup();
  }
});

test("an eval added or removed after the measurement makes the file stale naming it (R14)", () => {
  const r = sixRig({ evals: 6 });
  try {
    const rec = buildRecord(r.sel(), { evalRuns: allPass(6, 2) });
    writeRecord(r.dir, { ...rec, evals: rec.evals.filter((e) => e.id !== 4) });
    // eval 4 is in the tree but not recorded
    const added = attest(r);
    assert.equal(added.status, "invalid", "the runs no longer match the stage path counts");
    writeRecord(r.dir, rec);
    const evalsFile = path.join(r.dir, "evals", "evals.json");
    const doc = JSON.parse(fs.readFileSync(evalsFile, "utf8"));
    doc.evals.push({ ...doc.evals[0], id: 7 });
    fs.writeFileSync(evalsFile, JSON.stringify(doc));
    const seven = attest(r);
    // the evals.json edit changes the content hash first: the file is stale either way
    assert.equal(seven.status, "stale");
  } finally {
    r.cleanup();
  }
});

test("the recorded status must follow from the recorded runs: a rejected pool recorded as pass is invalid", () => {
  const r = sixRig();
  try {
    const runs = stagedRuns(6, [2], [6]);
    writeRecord(r.dir, { ...buildRecord(r.sel(), { evalRuns: runs }), status: "pass" });
    const o = attest(r);
    assert.equal(o.status, "invalid");
    assert.match(o.reason, /recorded status pass differs from the recomputed status fail/);
    assert.equal(o.blocking, true);
  } finally {
    r.cleanup();
  }
});

test("a recorded fail is reported with both rates, and blocks only under fail-blocking", () => {
  const r = sixRig();
  try {
    writeRecord(r.dir, buildRecord(r.sel(), { evalRuns: stagedRuns(6, [2], [6]) }));
    const o = attest(r);
    assert.equal(o.status, "fail");
    assert.match(o.reason, /eval pass rate 6\/12 \(stage 1\)/);
    assert.equal(o.blocking, false);
    assert.equal(attest(r, { failBlocking: true }).blocking, true);
  } finally {
    r.cleanup();
  }
});

test("the regression is recomputed against the merge-base file as it stands now, and blocks only under regression-blocking", () => {
  const r = sixRig({ base: { evalRuns: allPass(6, 4) } });
  try {
    writeRecord(r.dir, r.head({ evalRuns: stagedRuns(6, [2, 2], [8, 12]), probeRuns: [[true]] }));
    const o = attest(r);
    assert.equal(o.status, "regression", o.reason);
    assert.match(o.reason, /base 24\/24, head 20\/24, drop 0\.167, p 0\.055/);
    assert.equal(o.blocking, false);
    assert.equal(attest(r, { regressionBlocking: true }).blocking, true);
    const s = sink();
    attestMain([], cleanEnv(), r.repo.root, s.io);
    assert.match(s.out, /demo: regression: base 24\/24/);
  } finally {
    r.cleanup();
  }
});

test("a branch measured against 24/24 is recomputed after main advances with a base at 12/24, and no printed base stops it", () => {
  const r = sixRig({ base: { evalRuns: allPass(6, 4) } });
  try {
    writeRecord(r.dir, r.head({ evalRuns: stagedRuns(6, [2, 2], [8, 12]) }));
    commitAll(r.repo, "head results");
    assert.equal(attest(r).status, "regression");
    // main advances with a base file at 12 of 24, and the branch is replayed onto it
    const file = path.join(r.dir, "evals", "results.json");
    const headText = fs.readFileSync(file, "utf8");
    const baseSha = r.repo.git("rev-parse", "origin/main").trim();
    r.repo.git("checkout", "-q", "-b", "side", baseSha);
    writeRecord(r.dir, buildRecord(r.sel(), { evalRuns: stagedRuns(6, [4], [12]) }));
    commitAll(r.repo, "main advances");
    markOrigin(r.repo);
    fs.appendFileSync(path.join(r.dir, "SKILL.md"), "edit\n");
    fs.writeFileSync(file, headText);
    commitAll(r.repo, "branch replayed");
    const o = attest(r);
    assert.equal(o.status, "pass", `${o.status}: ${o.reason}`);
  } finally {
    r.cleanup();
  }
});

test("no-evals warns and blocks only under missing-evals-blocking; invalid always blocks", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "plain", {}, { evals: false });
    writeSkill(repo, "broken", { "evals/evals.json": "{}" });
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("plain"), "SKILL.md"), "x\n");
    fs.appendFileSync(path.join(repo.root, skillRel("broken"), "SKILL.md"), "x\n");
    commitAll(repo, "edit");
    const off = { regressionBlocking: false, failBlocking: false, missingEvalsBlocking: false };
    const plain = attestSelection(selectionOf(repo, "plain"));
    assert.equal(plain.status, "no-evals");
    assert.equal(plain.blocking, false);
    assert.equal(
      attestSelection(selectionOf(repo, "plain"), { ...off, missingEvalsBlocking: true }).blocking,
      true,
    );
    const broken = attestSelection(selectionOf(repo, "broken"), off);
    assert.equal(broken.status, "invalid");
    assert.equal(broken.blocking, true);
  } finally {
    repo.cleanup();
  }
});

test("a symlink or an untracked non-ignored file makes the attestation invalid naming the path", () => {
  changedSkill((repo) => {
    fs.symlinkSync("run.sh", path.join(repo.root, skillRel("demo"), "scripts", "l.sh"));
    repo.git("add", "-A");
    const a = attestSelection(selectionOf(repo, "demo"));
    assert.equal(a.status, "invalid");
    assert.match(a.reason, /scripts\/l\.sh/);
  });
});

test("the entry script runs without credentials, prints a line per skill and appends to the job summary", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeRecord(sel.skill.dirAbs, buildRecord(sel));
    repo.git("add", "-A");
    const summary = path.join(repo.root, "summary.md");
    const entry = path.resolve(import.meta.dirname, "..", "skill-evals-attestation.ts");
    const r = spawnSync(process.execPath, [entry], {
      cwd: repo.root,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        CREWRIG_REPO_DIR: repo.root,
        BASE_REF: "origin/main",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^demo: pass/m);
    assert.match(fs.readFileSync(summary, "utf8"), /- demo: pass/);
    assert.equal(r.stderr, "", "the entry form prints no Node.js warning");
  });
});

test("the attestation check never reads a credential variable and makes no model call", () => {
  const dir = path.resolve(import.meta.dirname, "../lib/skill-evals");
  const src = ["attest-cli.ts", "attest.ts"]
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("");
  for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "fetch(", "spawn("])
    assert.equal(src.includes(name), false, name);
  assert.equal(typeof readRecord, "function");
});
