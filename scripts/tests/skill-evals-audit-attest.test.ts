// skill-evals-audit-attest.test.ts — traceability gap-fillers, second half (spec 0290 + delta-01).
//
// The exec-bit stale scenario (R35, R37; the record is schema 2, 0304 R25, R26), the --changed / attestation selection equality (R34) and the
// documentation contract (R19, R26, R38). No key, no network, no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestMain } from "../lib/skill-evals/attest-cli.ts";
import { attestSelection } from "../lib/skill-evals/attest.ts";
import { selectChanged } from "../lib/skill-evals/select.ts";
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
import { buildRecord, writeRecord } from "./lib/skill-evals-record.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// ------------------------------------------------------------------- R35, R37 (exec bit), R34

test("the executable bit makes a results file stale: index mode toggled, bytes untouched (scenario: exec bit through the index)", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
    commitAll(repo, "edit");
    const before = selectionOf(repo, "demo");
    writeRecord(before.skill.dirAbs, buildRecord(before));
    repo.git("add", "-A");
    assert.equal(attestSelection(selectionOf(repo, "demo")).status, "pass");
    repo.git("update-index", "--chmod=-x", `${skillRel("demo")}/scripts/run.sh`);
    const after = selectionOf(repo, "demo");
    assert.notEqual(after.headHash, before.headHash);
    assert.equal(attestSelection(after).status, "stale");
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 1);
    assert.match(s.out, /demo: stale/);
  } finally {
    repo.cleanup();
  }
});

test("the set `--changed` selects equals the set the attestation check examines for the same base (R34)", () => {
  const repo = makeRepo();
  try {
    for (const n of ["alpha", "beta", "gamma", "delta"]) writeSkill(repo, n);
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("alpha"), "references", "ref.md"), "more\n");
    fs.writeFileSync(path.join(repo.root, skillRel("beta"), "evals", "results.json"), "{}\n");
    fs.appendFileSync(path.join(repo.root, skillRel("gamma"), "scripts", "run.sh"), "echo x\n");
    writeSkill(repo, "epsilon");
    commitAll(repo, "changes");
    const picked = selectChanged(repo.root, "origin/main");
    assert.ok("selections" in picked);
    const names = picked.selections.map((s) => s.skill.name).sort();
    assert.deepEqual(names, ["alpha", "epsilon", "gamma"]);
    const s = sink();
    attestMain([], cleanEnv(), repo.root, s.io);
    const examined = [...s.out.matchAll(/^(\w+): /gm)].map((m) => m[1]).sort();
    assert.deepEqual(examined, names);
  } finally {
    repo.cleanup();
  }
});

// ---------------------------------------------------------------------- documentation contract

test("docs/skill-evals.md documents every declared setting, the provisional calibration, the trust model and the Claude Code scope (R19, R23, R26, R38)", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs", "skill-evals.md"), "utf8");
  const settings = fs.readFileSync(
    path.join(REPO_ROOT, "scripts", "lib", "skill-evals", "settings.ts"),
    "utf8",
  );
  const names = [...settings.matchAll(/^export const ([A-Z_]+)\s*=/gm)].map((m) => m[1] as string);
  assert.ok(names.length >= 15);
  const undocumented = names.filter(
    (n) =>
      ![
        "RUNNER_VERSION",
        "EVIDENCE_MIN_CHARS",
        "JUDGE_MAX_TOKENS",
        "JUDGE_RETRY_ALLOWANCE",
        "EXECUTOR_TOOLS",
        "DEFAULT_OUT_DIR",
        "JUDGE_MODEL",
        "TOKEN_VAR",
        "API_KEY_VAR",
      ].includes(n) && !doc.includes(n),
  );
  assert.deepEqual(undocumented, [], "every spec-declared setting appears in the documentation");
  for (const needle of [
    /regression-blocking|REGRESSION_BLOCKING/,
    /missing-evals-blocking|MISSING_EVALS_BLOCKING/,
    /#1852/,
    /provisional/i,
    /pr-logbook/,
    /Trust model/,
    /forgeable/,
    /Claude Code only/,
    /`claude`/,
    /docs\/cli-matrix\/rows/,
  ])
    assert.match(doc, needle);
});

// ------------------------------------------------- delta-03 R44: residual risk and prerequisites

/** The seven statements of delta-03 R44 (a)-(g), each a bullet with a plain bold topic lead-in. */
const R44_LEAD_INS = [
  "Prerequisite",
  "API key opt-in and credential exposure",
  "Filesystem reach",
  "Shared state files and concurrency",
  "Measured cost",
  "Checked-out pull requests",
  "Network variables",
] as const;

/** The text of the `## ...` section whose heading matches, up to the next `## ` heading. */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && heading.test(l));
  assert.ok(start >= 0, `no section matching ${String(heading)}`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

const bullet = (sectionText: string, leadIn: string): string => {
  const line = sectionText.split("\n").find((l) => l.startsWith(`- **${leadIn}.**`));
  assert.ok(line !== undefined, `missing bullet "- **${leadIn}.**"`);
  return line;
};

for (const [name, file] of [
  ["docs/skill-evals.md", path.join("docs", "skill-evals.md")],
  ["ADR 0023", path.join("docs", "adr", "0023-skill-eval-executor.md")],
] as const) {
  test(`R44: ${name} carries the seven statements as bullets with their topic lead-ins`, () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    const sec = section(text, /Residual risk and prerequisites/);
    for (const leadIn of R44_LEAD_INS) bullet(sec, leadIn);
    const bullets = sec.split("\n").filter((l) => l.startsWith("- **"));
    assert.equal(bullets.length, R44_LEAD_INS.length, "one bullet per statement, no more");
    // (a) the logged-in prerequisite; setup-token and the key are optional overrides
    const a = bullet(sec, "Prerequisite");
    assert.match(a, /installed and logged in/i);
    assert.match(a, /optional override/);
    assert.match(a, /claude setup-token/);
    assert.match(a, /ANTHROPIC_API_KEY/);
    // (b) the key is used only with --use-api-key; the residual stated accurately
    const b = bullet(sec, "API key opt-in and credential exposure");
    assert.match(b, /only with `--use-api-key`/);
    assert.match(b, /no longer in the agent's environment/);
    assert.match(b, /file under the real configuration directory/);
    assert.match(b, /keychain/);
    assert.match(b, /`security` command/);
    assert.match(b, /not unreachable/, "the keychain is not described as unreachable");
    assert.match(b, /`CLAUDE_CODE_OAUTH_TOKEN`/);
    assert.match(b, /previous residual stands unchanged/);
    // (c) the real HOME, no false boundary
    const c = bullet(sec, "Filesystem reach");
    assert.match(c, /real `HOME`/);
    assert.match(c, /`Bash`, `Read`, `Write` and `Edit`/);
    assert.match(c, /false boundary/);
    // (d) shared state files, concurrency of 4 to verify by the maintainer smoke run
    const d = bullet(sec, "Shared state files and concurrency");
    assert.match(d, /credential refresh/);
    assert.match(d, /default of 4/);
    assert.match(d, /maintainer smoke run/);
    assert.match(d, /EXECUTOR_CONCURRENCY/);
    // (e) the measured cost, an input to #1852
    const e = bullet(sec, "Measured cost");
    for (const n of ["0.03", "0.022", "0.028", "0.025", "#1852"]) assert.ok(e.includes(n), n);
    assert.match(e, /Sonnet 5\.5/);
    // (f) a checked-out pull request runs as the contributor
    const f = bullet(sec, "Checked-out pull requests");
    assert.match(f, /not (?:your own|the contributor's)/);
    assert.match(f, /real `HOME`/);
    assert.match(f, /scripts/);
    // (g) the network variables may embed proxy credentials
    const g = bullet(sec, "Network variables");
    assert.match(g, /proxy URL may embed credentials/);
    assert.match(g, /agent's `Bash`/);
  });
}

test("R44, R26: the document names the logged-in prerequisite, --use-api-key and the model pin, and never lists `claude setup-token` as the preferred path", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs", "skill-evals.md"), "utf8");
  const adr = fs.readFileSync(
    path.join(REPO_ROOT, "docs", "adr", "0023-skill-eval-executor.md"),
    "utf8",
  );
  // the logged-in prerequisite comes first among the requirements
  const requirements = section(doc, /Requirements and scope of the measurement/);
  assert.match(bullet(requirements, "Prerequisite"), /installed[\s\S]*logged in/);
  assert.match(bullet(requirements, "Prerequisite"), /`claude` binary/);
  for (const [name, text] of [
    ["document", doc],
    ["ADR", adr],
  ] as const) {
    assert.match(text, /`--use-api-key`/, name);
    assert.match(text, /claude-sonnet-5-5/, name);
    assert.doesNotMatch(
      text,
      /claude-sonnet-4-6[^\n]*(?:pinned|default)/i,
      `${name}: the old model pin is gone`,
    );
    const sentences = text.split(/(?<=[.!?])\s+|\n/).filter((x) => x.includes("setup-token"));
    assert.ok(sentences.length > 0, name);
    for (const sentence of sentences)
      assert.doesNotMatch(
        sentence.replace(/\bnot (?:the )?(?:preferred|recommended)\b/gi, ""),
        /\b(?:preferred|recommended)\b/i,
        `${name}: setup-token is presented as preferred: ${sentence}`,
      );
  }
  // the credential table of the document: the session is the default, setup-token an optional override
  const credentials = section(doc, /^## Credentials/);
  assert.match(credentials, /logged-in Claude Code session: no variable is needed/);
  const tokenRow = credentials.split("\n").find((l) => l.includes("claude setup-token"));
  assert.ok(
    tokenRow !== undefined && /Optional override/.test(tokenRow),
    "token row is an optional override",
  );
  assert.match(doc, /Claude Code only/);
  assert.match(doc, /docs\/cli-matrix\/rows/);
});
