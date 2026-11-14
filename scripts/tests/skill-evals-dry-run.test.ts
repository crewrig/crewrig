// skill-evals-dry-run.test.ts — the authoring guard (spec 0304 R20): `--dry-run [--eval <id>]` runs
// the deterministic checks of an eval on a hand-written sample, then makes one judge call per eval
// with expectations and no executor run. A sample that fails its own check exits 1, a conforming
// sample that the judge fails does not change the exit code, nothing is written, and the judge spend
// is printed and checked against the caps. Offline: a recording judge endpoint, no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main, parseArgs } from "../lib/skill-evals/cli.ts";
import { buildRecord, writeRecord } from "./lib/skill-evals-record.ts";
import {
  cleanEnv,
  commitAll,
  makeRepo,
  markOrigin,
  selectionOf,
  sink,
  skillRel,
  tmpDir,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";
import { judgeFetch } from "./lib/skill-evals-run-rig.ts";

const KEYENV = { ANTHROPIC_API_KEY: "sk-test" };
const ARGS = ["--use-api-key", "--ticket", "1958"];

interface EvalSpec {
  readonly id: number;
  readonly checks: unknown[];
  readonly expectations: string[];
}
const evalsText = (specs: EvalSpec[]) =>
  JSON.stringify({
    skill_name: "demo",
    evals: specs.map((s) => ({
      prompt: `Task ${s.id}`,
      expected_output: "o",
      files: [],
      ...s,
    })),
    trigger_probes: [{ query: "q", should_trigger: true }],
  });
const CHECKS = [
  { type: "file_exists", path: "report.md" },
  { type: "exit_code", script: "scripts/run.sh", args: [], expected: 0 },
];
const TWO = ["Expectation 1 holds", "Expectation 2 holds"];

/** A repo whose `demo` has the given evals, `samples` written under evals/samples/, committed on a branch. */
function sampleRepo(specs: EvalSpec[], samples: Record<string, string> = {}) {
  const repo = makeRepo();
  writeSkill(repo, "demo", { "evals/evals.json": evalsText(specs) });
  commitAll(repo, "base");
  markOrigin(repo);
  const dir = path.join(repo.root, skillRel("demo"));
  fs.appendFileSync(path.join(dir, "SKILL.md"), "edit\n");
  for (const [rel, text] of Object.entries(samples)) {
    fs.mkdirSync(path.dirname(path.join(dir, "evals", "samples", rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, "evals", "samples", rel), text);
  }
  commitAll(repo, "edit");
  return { repo, dir };
}
const conforming = {
  "1/report.md": "# Report\nok\n",
  "1/transcript.md": "Assistant: the quick brown fox wrote the report\n",
};

async function dry(
  repo: Repo,
  argv: string[],
  extra: Record<string, unknown> = {},
  env: Record<string, string> = KEYENV,
) {
  const out = tmpDir();
  const s = sink();
  const j = judgeFetch();
  try {
    const code = await main(
      ["demo", "--dry-run", "--out", out, ...argv],
      cleanEnv(env),
      repo.root,
      s.io,
      {
        fetchImpl: j.fetch,
        declare: () => ({ ok: true }),
        sleep: async () => undefined,
        ...extra,
      },
    );
    return { code, out: s.out, err: s.err, requests: j.requests };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
const treeOf = (dir: string) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((p) => {
      const f = path.join(dir, p);
      return fs.statSync(f).isFile() ? `${p}:${fs.readFileSync(f, "utf8")}` : p;
    });

test("a conforming sample: one judge call, PASS per expectation, exit 0, no executor, nothing written", async () => {
  const { repo, dir } = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }], conforming);
  try {
    const before = treeOf(path.join(dir, "evals"));
    const r = await dry(repo, [...ARGS, "--eval", "1"]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.requests.length, 1, "one judge call for the eval");
    assert.match(r.out, /demo: eval 1: 2 expectation\(s\) judged on the sample/);
    assert.match(r.out, /^ {2}PASS: Expectation 1 holds$/m);
    assert.match(r.out, /^ {2}PASS: Expectation 2 holds$/m);
    assert.match(r.out, /dry-run spend: 0\.03 \(1 judge calls, assumed\)/);
    assert.deepEqual(
      treeOf(path.join(dir, "evals")),
      before,
      "nothing under evals/ changes: no results.json, no ledger entry",
    );
    assert.equal(fs.existsSync(path.join(dir, "evals", "results.json")), false);
  } finally {
    repo.cleanup();
  }
});

test("a judge FAIL on a conforming sample is printed as a defect of the case or the sample and the exit stays 0", async () => {
  const { repo } = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }], {
    ...conforming,
    "1/transcript.md": "Assistant: BROKEN answer, and the quick brown fox\n",
  });
  try {
    const r = await dry(repo, ARGS);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^ {2}FAIL: Expectation 1 holds$/m);
    assert.match(r.out, /defect of the case or of the sample on a conforming sample/);
  } finally {
    repo.cleanup();
  }
});

test("a sample that fails its own check is sample-invalid, naming the eval and the check, exit 1, with no judge call", async () => {
  const missing = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }], {
    "1/transcript.md": "fox\n",
  });
  const badScript = sampleRepo(
    [
      {
        id: 1,
        checks: [{ type: "exit_code", script: "scripts/run.sh", args: [], expected: 3 }],
        expectations: TWO,
      },
    ],
    { "1/transcript.md": "the quick brown fox\n" },
  );
  try {
    const a = await dry(missing.repo, ARGS);
    assert.equal(a.code, 1);
    assert.match(a.out, /demo: eval 1: sample-invalid: check file_exists: report\.md/);
    assert.equal(a.requests.length, 0);
    const b = await dry(badScript.repo, ARGS);
    assert.equal(b.code, 1);
    assert.match(
      b.out,
      /sample-invalid: check exit_code: scripts\/run\.sh exits with 3: observed: exit code 0 \(expected 3\)/,
    );
  } finally {
    missing.repo.cleanup();
    badScript.repo.cleanup();
  }
});

test("an eval with no sample is skipped with a line; when none has one the command exits 1 with `dry-run: no sample for <skill>`", async () => {
  const some = sampleRepo(
    [
      { id: 1, checks: CHECKS, expectations: TWO },
      { id: 2, checks: [], expectations: ["x"] },
    ],
    conforming,
  );
  const none = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }]);
  try {
    const a = await dry(some.repo, ARGS);
    assert.equal(a.code, 0, a.out + a.err);
    assert.match(a.out, /^no sample for eval 2$/m);
    assert.equal(a.requests.length, 1);
    const b = await dry(none.repo, ARGS);
    assert.equal(b.code, 1);
    assert.match(b.out, /^no sample for eval 1$/m);
    assert.match(b.out, /^dry-run: no sample for demo$/m);
    assert.equal(b.requests.length, 0, "nothing was checked, nothing was judged");
  } finally {
    some.repo.cleanup();
    none.repo.cleanup();
  }
});

test("--eval is accepted only with --dry-run (exit 2), an unknown eval id exits 2, and --dry-run takes one skill", async () => {
  const { repo } = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }], conforming);
  try {
    const s = sink();
    const code = await main(["demo", "--eval", "1"], cleanEnv(KEYENV), repo.root, s.io);
    assert.equal(code, 2);
    assert.match(s.err, /--eval is accepted only with --dry-run/);
    const unknown = await dry(repo, [...ARGS, "--eval", "99"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /unknown eval id 99 for demo/);
    assert.equal(unknown.requests.length, 0);
    assert.ok("error" in (parseArgs(["--dry-run", "--changed"]) as object));
    assert.ok("error" in (parseArgs(["demo", "--dry-run", "--eval", "x"]) as object));
    assert.deepEqual(
      (({ dryRun, evalId }) => ({ dryRun, evalId }))(
        parseArgs(["demo", "--dry-run", "--eval", "7"]) as never,
      ),
      { dryRun: true, evalId: 7 },
    );
  } finally {
    repo.cleanup();
  }
});

test("under --mock no judge call is made and the sample is still checked", async () => {
  const { repo } = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }], conforming);
  try {
    const r = await dry(repo, ["--mock"], {}, {});
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.requests.length, 0);
    assert.match(r.out, /no judge call under --mock/);
  } finally {
    repo.cleanup();
  }
});

test("samples stay out of the content hash: adding evals/samples/ changes no hash", () => {
  const { repo, dir } = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }]);
  try {
    const before = selectionOf(repo, "demo").headHash;
    fs.mkdirSync(path.join(dir, "evals", "samples", "1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "evals", "samples", "1", "report.md"), "sample\n");
    assert.equal(selectionOf(repo, "demo").headHash, before);
  } finally {
    repo.cleanup();
  }
});

test("the dry-run spend is checked against the ticket cap with its own worst case, before any call, and not persisted", async () => {
  const { repo } = sampleRepo([{ id: 1, checks: CHECKS, expectations: TWO }], conforming);
  try {
    writeSkill(repo, "other");
    const sel = selectionOf(repo, "other");
    writeRecord(sel.skill.dirAbs, {
      ...buildRecord(sel, { ticket: "1958" }),
      cost_usd: 24.99,
      judge_cost_usd: 0,
    });
    const r = await dry(repo, ARGS);
    assert.equal(r.code, 1);
    assert.match(
      r.err,
      /ticket 1958: spent 24\.99 USD plus the summed worst case 0\.06 USD exceeds max-ticket-usd 25 USD/,
    );
    assert.equal(r.requests.length, 0);
    // a dry-run under the cap leaves no trace in any results file
    const ok = await dry(repo, [...ARGS, "--ticket", "2000"]);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(
      fs.existsSync(path.join(repo.root, skillRel("demo"), "evals", "results.json")),
      false,
    );
  } finally {
    repo.cleanup();
  }
});
