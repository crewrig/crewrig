// skill-evals-evidence-tolerant.test.ts — tolerant evidence matching (spec 0290 delta-05, R49).
// Offline: the fixtures are the recorded judge answers and produced specs of the #1894 measurements
// (scripts/tests/fixtures/skill-evals-judge-evidence/README.md). No model call, no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { validateEvidence } from "../lib/skill-evals/evidence.ts";
import type { EvidenceMaterial } from "../lib/skill-evals/evidence.ts";
import { gradeRun } from "../lib/skill-evals/grade.ts";
import { EVIDENCE_WINDOW_CHARS, EVIDENCE_WINDOW_SHARE } from "../lib/skill-evals/settings.ts";
import { parseJudgeAnswer } from "../lib/skill-evals/judge.ts";
import { formatSkill } from "../lib/skill-evals/report.ts";
import { tmpDir } from "./lib/skill-evals-fixtures.ts";
import { makeRig } from "./lib/skill-evals-run-rig.ts";

const FIX = path.join(import.meta.dirname, "fixtures", "skill-evals-judge-evidence");
const load = (dir: string) => {
  const spec = fs.readFileSync(path.join(FIX, dir, "produced-spec.md"), "utf8");
  const answers = parseJudgeAnswer(
    fs.readFileSync(path.join(FIX, dir, "judge.txt"), "utf8"),
    4,
  ).flatMap((a) => (a?.evidence === undefined ? [] : [a.evidence]));
  const material: EvidenceMaterial = {
    transcript: "Assistant: done.",
    files: [{ rel: "specs/0042-widget-csv-export.md", content: spec }],
  };
  return { spec, answers, material };
};
const exact = (e: string, m: EvidenceMaterial) =>
  m.files.some((f) => f.content.includes(e)) || m.transcript.includes(e);
const ok = (e: string, m: EvidenceMaterial) => validateEvidence(e, m).ok;

test("the settings are the spec's figures", () => {
  assert.equal(EVIDENCE_WINDOW_CHARS, 40);
  assert.equal(EVIDENCE_WINDOW_SHARE, 0.3);
});

test("recorded flakes: rejected by the exact rule, accepted by R49", () => {
  const cases: Array<[string, number]> = [
    ["m5-eval-1", 3], // heading and bullets joined onto one line (rule 2)
    ["m5-eval-1", 4], // own sentence around a verbatim bullet (rule 3, share 0.38)
    ["m4-eval-3", 2], // requirement quoted inside commentary (rule 3, share 0.54)
    ["m4-eval-3", 3], // ellipsis and markdown markers (rule 2)
    ["m2-eval-3", 2], // over-escaped quotes inside commentary (rule 3, share 0.35)
  ];
  for (const [dir, n] of cases) {
    const { answers, material } = load(dir);
    const e = answers[n - 1] as string;
    assert.equal(exact(e, material), false, `${dir} #${n} is rejected by the exact rule`);
    assert.equal(ok(e, material), true, `${dir} #${n} is accepted by R49`);
  }
});

test("every other recorded answer is still accepted (monotonic: the exact rule's accepts stay accepted)", () => {
  for (const dir of ["m5-eval-1", "m4-eval-3", "m2-eval-3"]) {
    const { answers, material } = load(dir);
    answers.forEach((e, i) => {
      if (exact(e, material)) assert.equal(ok(e, material), true, `${dir} #${i + 1}`);
    });
  }
});

test("fabricated quotes stay rejected", () => {
  const m4 = load("m4-eval-3").material;
  const m5 = load("m5-eval-1").material;
  const why = (e: string, m: EvidenceMaterial) => {
    const r = validateEvidence(e, m);
    return r.ok ? "ok" : r.reason;
  };
  // one word changed in a short quote: no verbatim run reaches 40 letters and digits
  assert.notEqual(why("Given the widgets service succeeds after part of the list", m5), "ok");
  // a real first piece, an invented second one
  assert.notEqual(
    why(
      "### Failure path: service failure ... the command quietly retries the export three times",
      m4,
    ),
    "ok",
  );
  // two real short pieces in the wrong order
  assert.equal(ok("the command prints a usage error ... Failure path: missing path", m4), false);
  assert.equal(ok("Failure path: missing path ... the command prints a usage error", m4), true);
  // a pure paraphrase
  assert.equal(
    ok(
      "The spec adds no extra columns, no column selection, no filtering, sorting or date-range options beyond the ticket",
      m5,
    ),
    false,
  );
  // a short piece next to an ellipsis (fewer than 12 letters and digits)
  assert.equal(ok("### Failure path: service failure ... exits", m4), false);
});

/** Consecutive words of `text` whose letters and digits total exactly `n`, as the text spells them. */
const runOf = (text: string, n: number): string => {
  const ws = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let i = 0; i < ws.length; i++) {
    let sum = 0;
    for (let j = i; j < ws.length; j++) {
      sum += (ws[j] as string).length;
      if (sum === n) return ws.slice(i, j + 1).join(" ");
      if (sum > n) break;
    }
  }
  throw new Error(`no run of ${n}`);
};
// invented words that occur in no fixture
const invented = (n: number) => {
  const out: string[] = [];
  let sum = 0;
  while (sum < n) {
    out.push("zzqx");
    sum += 4;
  }
  return out.join(" ");
};

test("boundaries of rule 3: 40 letters and digits, and a 30 percent share", () => {
  const { spec, material } = load("m4-eval-3");
  const run40 = runOf(spec, 40);
  const run39 = runOf(spec, 39);
  // 40 of 40 + 88 = 128 letters and digits: share 0.3125, accepted
  assert.equal(ok(`${invented(80)} ${run40} ${invented(8)}`, material), true);
  // a run one letter short of the 40 floor, share 39/127 = 0.307: rejected on the floor
  assert.equal(ok(`${invented(80)} ${run39} ${invented(8)}`, material), false);
  // 40 of 40 + 100 = 140: share 0.286 < 0.30, rejected on the share
  assert.equal(ok(`${invented(96)} ${run40} ${invented(4)}`, material), false);
});

test("a real run inside a much longer invented claim is rejected", () => {
  const { material } = load("m5-eval-1");
  const real =
    "### Failure path: existing file preserved\n\n- **Given** `widgets.csv` already exists with prior content";
  assert.equal(ok(real, material), true, "the real run alone is exact");
  const claim = `${invented(300)} ${real}`;
  assert.equal(exact(claim, material), false);
  assert.equal(ok(claim, material), false);
});

test("gradeRun: a fabricated PASS is still recorded failed as unsupported; a tolerant one passes", async () => {
  const { material, answers } = load("m5-eval-1");
  const run = async (evidence: string) =>
    gradeRun({
      evalCase: {
        id: 1,
        prompt: "p",
        expected_output: "o",
        files: [],
        expectations: ["x"],
        checks: [],
      },
      outputsDir: (() => {
        const d = tmpDir();
        fs.mkdirSync(path.join(d, "specs"), { recursive: true });
        fs.writeFileSync(
          path.join(d, "specs", "0042-widget-csv-export.md"),
          material.files[0]?.content ?? "",
        );
        return d;
      })(),
      skillDir: "/none",
      transcript: material.transcript,
      judge: async () => [{ verdict: "PASS", evidence }],
    });
  const tolerant = await run(answers[2] as string);
  assert.equal(tolerant.expectations[0]?.passed, true);
  const fabricated = await run(
    "the widgets service never fails and the command always exits with success quietly",
  );
  assert.equal(fabricated.expectations[0]?.passed, false);
  assert.match(fabricated.expectations[0]?.evidence ?? "", /the PASS verdict was unsupported/);
});

// --- R50: the rule that accepted each evidence is recorded and counted -------------------------

const gradeWith = async (
  fixture: string,
  evidence: string,
  file = "specs/0042-widget-csv-export.md",
) => {
  const { material } = load(fixture);
  const d = tmpDir();
  fs.mkdirSync(path.dirname(path.join(d, file)), { recursive: true });
  fs.writeFileSync(path.join(d, file), material.files[0]?.content ?? "");
  const g = await gradeRun({
    evalCase: {
      id: 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: ["x"],
      checks: [],
    },
    outputsDir: d,
    skillDir: "/none",
    transcript: material.transcript,
    judge: async () => [{ verdict: "PASS", evidence }],
  });
  return g.expectations[0];
};

test("grading.json records the accepting rule, and the window share for rule 3 only", async () => {
  const m5 = load("m5-eval-1").answers;
  const exactE = await gradeWith("m5-eval-1", m5[1] as string);
  assert.equal(exactE?.evidence_match, "exact");
  assert.equal("window_share" in (exactE ?? {}), false);
  const normalised = await gradeWith("m5-eval-1", m5[2] as string);
  assert.equal(normalised?.evidence_match, "normalised");
  assert.equal("window_share" in (normalised ?? {}), false);
  const window = await gradeWith("m5-eval-1", m5[3] as string);
  assert.equal(window?.evidence_match, "window");
  assert.equal(window?.window_share, 0.38);
  const ref = await gradeWith("m5-eval-1", "specs/0042-widget-csv-export.md:3");
  assert.equal(ref?.evidence_match, "path_line");
  const failed = await gradeWith(
    "m5-eval-1",
    "the widgets service never fails and always exits quietly",
  );
  assert.equal(failed?.passed, false);
  assert.equal("evidence_match" in (failed ?? {}), false);
  assert.equal("window_share" in (failed ?? {}), false);
});

test("a mock run records the rule on judged entries only, and the report prints evidence_window", async () => {
  const rig = makeRig({ evalsCount: 2 });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.text + r.stderr);
    const g = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "run-1", "grading.json"), "utf8"),
    ) as { expectations: Array<Record<string, unknown>> };
    assert.equal("evidence_match" in (g.expectations[0] ?? {}), false, "a check carries no rule");
    assert.equal(g.expectations[1]?.["evidence_match"], "exact");
    assert.match(r.text, /evidence_window: 0 of 4/);
  } finally {
    rig.cleanup();
  }
});

test("the report line counts rule-3 acceptances, including zero", () => {
  const base = {
    skill: "demo",
    status: "pass" as const,
    blocking: false,
    executorRuns: 1,
    judgeCalls: 1,
    costUsd: 0,
    messages: [],
  };
  assert.match(
    formatSkill({ ...base, evidenceAccepted: 2, evidenceWindow: 1 }),
    /evidence_window: 1 of 2/,
  );
  assert.match(
    formatSkill({ ...base, evidenceAccepted: 3, evidenceWindow: 0 }),
    /evidence_window: 0 of 3/,
  );
  assert.doesNotMatch(formatSkill(base), /evidence_window/);
});
