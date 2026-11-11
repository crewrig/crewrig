// skill-evals-cli.test.ts — the entry points (spec 0290 R16, R20, R21, R22, R25 and the
// invalid / no-evals scenarios). Mock mode or failing preconditions only: no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main, parseArgs } from "../lib/skill-evals/cli.ts";
import {
  cleanEnv,
  commitAll,
  evalsJson,
  makeRepo,
  markOrigin,
  sink,
  skillRel,
  tmpDir,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";
import { MockExecutor } from "../lib/skill-evals/executor/mock.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENTRY = path.join(REPO_ROOT, "scripts", "skill-evals.ts");

function withRepo(f: (repo: Repo, out: string) => Promise<void> | void) {
  return async () => {
    const repo = makeRepo();
    const out = tmpDir();
    try {
      writeSkill(repo, "demo");
      commitAll(repo, "base");
      markOrigin(repo);
      fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
      commitAll(repo, "edit");
      await f(repo, out);
    } finally {
      repo.cleanup();
      fs.rmSync(out, { recursive: true, force: true });
    }
  };
}

test("parseArgs: one skill or --changed, --out, --mock, --ticket, --base", () => {
  assert.deepEqual(parseArgs(["demo", "--mock", "--out", "o"]), {
    name: "demo",
    changed: false,
    out: "o",
    mock: true,
    base: "origin/main",
  });
  assert.deepEqual(parseArgs(["--", "--changed", "--ticket", "12"]), {
    changed: true,
    out: ".skill-evals",
    mock: false,
    ticket: "12",
    base: "origin/main",
  });
  for (const bad of [[], ["a", "b"], ["--changed", "a"], ["--nope"], ["--out"]])
    assert.ok("error" in (parseArgs(bad) as object), bad.join(" "));
});

test(
  "an unknown skill name exits non-zero naming it",
  withRepo(async (repo, out) => {
    const s = sink();
    const code = await main(["nope", "--out", out], cleanEnv(), repo.root, s.io);
    assert.equal(code, 2);
    assert.match(s.err, /unknown skill: nope/);
  }),
);

test(
  "a mock run of one skill prints the per-skill summary with status mock, writes the layout and exits 0",
  withRepo(async (repo, out) => {
    const s = sink();
    const code = await main(["demo", "--mock", "--out", out], cleanEnv(), repo.root, s.io, {
      executor: new MockExecutor(),
    });
    assert.equal(code, 0, s.out + s.err);
    assert.match(
      s.out,
      /^demo: status=mock with_skill=1\.00 without_skill=1\.00 delta=\+0\.00 base=1\.00 executor_runs=3 judge_calls=\d+ cost_usd=0\.03 trigger_probes=1/m,
    );
    assert.match(s.out, /^invocation: skills=1 executor_runs=3/m);
    for (const f of [
      "benchmark.json",
      "eval-1/with_skill/grading.json",
      "eval-1/without_skill/transcript.md",
      "base/eval-1/with_skill/grading.json",
    ])
      assert.ok(fs.existsSync(path.join(out, "demo", f)), f);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(out, "demo", "benchmark.json"), "utf8")).mock,
      true,
    );
  }),
);

test(
  "--changed selects the changed skill and says so when nothing changed",
  withRepo(async (repo, out) => {
    const s = sink();
    assert.equal(await main(["--changed", "--mock", "--out", out], cleanEnv(), repo.root, s.io), 0);
    assert.match(s.out, /^demo: status=mock/m);
    markOrigin(repo);
    const none = sink();
    assert.equal(
      await main(["--changed", "--mock", "--out", out], cleanEnv(), repo.root, none.io),
      0,
    );
    assert.match(none.out, /nothing to run/);
  }),
);

test("invalid evals.json blocks before any model call and reports both violations with file and JSON path", async () => {
  const repo = makeRepo();
  const out = tmpDir();
  try {
    const doc = JSON.parse(evalsJson("other")) as { evals: Record<string, unknown>[] };
    doc.evals.push({ ...doc.evals[0] });
    writeSkill(repo, "demo", { "evals/evals.json": JSON.stringify(doc) });
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "x\n");
    commitAll(repo, "edit");
    const executor = new MockExecutor();
    const s = sink();
    const code = await main(
      ["demo", "--out", out],
      cleanEnv({ ANTHROPIC_API_KEY: "k" }),
      repo.root,
      s.io,
      {
        executor,
        fetchImpl: (() => {
          throw new Error("network");
        }) as unknown as typeof fetch,
      },
    );
    assert.equal(code, 1);
    assert.match(s.out, /^demo: status=invalid/m);
    assert.match(s.out, /evals\.json: \$\.skill_name: R6/);
    assert.match(s.out, /evals\.json: \$\.evals\[1\]\.id: R3/);
    assert.equal(executor.calls.length, 0, "no model call");
    assert.equal(fs.existsSync(path.join(out, "demo")), false);
  } finally {
    repo.cleanup();
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("a skill without evals/ warns and exits 0; missing-evals-blocking flips the same condition; an evals/ dir with no evals.json is invalid", async () => {
  const repo = makeRepo();
  const out = tmpDir();
  try {
    writeSkill(repo, "plain", {}, { evals: false });
    writeSkill(repo, "hollow", { "evals/results.json": "{}\n" }, { evals: false });
    commitAll(repo, "base");
    markOrigin(repo);
    for (const n of ["plain", "hollow"])
      fs.appendFileSync(path.join(repo.root, skillRel(n), "SKILL.md"), "x\n");
    commitAll(repo, "edit");
    const s = sink();
    assert.equal(await main(["plain", "--mock", "--out", out], cleanEnv(), repo.root, s.io), 0);
    assert.match(s.out, /^plain: status=no-evals/m);
    assert.match(s.out, /warning: plain has no evals\/ directory/);
    const blocked = sink();
    assert.equal(
      await main(["plain", "--mock", "--out", out], cleanEnv(), repo.root, blocked.io, {
        settings: { missingEvalsBlocking: true },
      }),
      1,
    );
    const hollow = sink();
    assert.equal(
      await main(["hollow", "--mock", "--out", out], cleanEnv(), repo.root, hollow.io),
      1,
    );
    assert.match(hollow.out, /status=invalid[\s\S]*evals\.json is missing/);
  } finally {
    repo.cleanup();
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test(
  "a symlink or an untracked non-ignored file makes the run invalid before any model call",
  withRepo(async (repo, out) => {
    fs.writeFileSync(path.join(repo.root, skillRel("demo"), "scripts", "helper.sh"), "#!/bin/sh\n");
    const executor = new MockExecutor();
    const s = sink();
    assert.equal(
      await main(["demo", "--mock", "--out", out], cleanEnv(), repo.root, s.io, { executor }),
      1,
    );
    assert.match(s.out, /status=invalid/);
    assert.match(s.out, /scripts\/helper\.sh.*git add/);
    assert.equal(executor.calls.length, 0);
  }),
);

test(
  "the task entry: missing credentials exit 3 naming both variables, no results file, nothing written",
  withRepo(async (repo) => {
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, "demo"],
      {
        cwd: repo.root,
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "", CREWRIG_REPO_DIR: repo.root },
      },
    );
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(r.stderr, /ANTHROPIC_API_KEY/);
    assert.equal(
      fs.existsSync(path.join(repo.root, skillRel("demo"), "evals", "results.json")),
      false,
    );
    assert.equal(fs.existsSync(path.join(repo.root, ".skill-evals")), false);
  }),
);

test(
  "the task entry in mock mode runs end to end, prints no Node.js warning, and exits 0",
  withRepo(async (repo, out) => {
    const r = spawnSync(process.execPath, [ENTRY, "demo", "--mock", "--out", out], {
      cwd: repo.root,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", CREWRIG_REPO_DIR: repo.root },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /status=mock/);
    assert.equal(r.stderr, "");
    const bad = spawnSync(process.execPath, [ENTRY, "missing", "--mock"], {
      cwd: repo.root,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", CREWRIG_REPO_DIR: repo.root },
    });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown skill: missing/);
  }),
);

test(
  "the runner tests need no key and make no model call: the real claude binary is never used by mock runs",
  withRepo(async (repo, out) => {
    const dir = tmpDir();
    const marker = path.join(dir, "called");
    const stub = path.join(dir, "claude");
    fs.writeFileSync(stub, `#!/bin/sh\necho called > ${marker}\nexit 99\n`, { mode: 0o755 });
    try {
      const s = sink();
      const code = await main(
        ["demo", "--mock", "--out", out],
        cleanEnv({ SKILL_EVALS_CLAUDE_BIN: stub }),
        repo.root,
        s.io,
      );
      assert.equal(code, 0, s.out + s.err);
      assert.equal(fs.existsSync(marker), false, "mock mode never spawns claude");
      for (const f of ["with_skill", "without_skill"])
        for (const j of ["grading.json"])
          assert.equal(
            JSON.parse(fs.readFileSync(path.join(out, "demo", "eval-1", f, j), "utf8")).mock,
            true,
          );
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(out, "demo", "benchmark.json"), "utf8")).mock,
        true,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }),
);
