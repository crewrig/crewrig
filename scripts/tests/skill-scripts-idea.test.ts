// skill-scripts-idea.test.ts — black-box test of idea/scripts/idea-tally.ts, idea-open.ts and
// idea-close.ts: tally rules (re-designation, implicit candidate, abstention, eligibility,
// replies), the three governance thresholds, --help, exit codes 1, 2 and 3, the dry-run command
// text, and the real run against a fake `gh` that records its argv. No network, no forge.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SKILL_DIR = path.join(REPO, "artifacts", "core", "skills", "idea");
const FILES = path.join(SKILL_DIR, "evals", "files");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "idea-scripts-")));
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the fixtures must live outside the repository");

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface Data {
  mode: string;
  candidate: string | null;
  implicit: boolean;
  votes: { approve: number; reject: number; abstain: number; by_voter: Record<string, string> };
  missing: string[];
  voided_votes: number;
  ignored: { author: string; reason: string }[];
  threshold_met: boolean;
  title: string;
  labels: string[];
  body: string;
  commands: string[];
  session_issue: number | null;
  outcome: string;
  label: string;
  comment: string;
}
interface Envelope {
  ok: boolean;
  data: Data;
  findings: { rule: string; message: string; severity?: string }[];
}
const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;

const run = (
  script: string,
  args: readonly string[],
  opts: { input?: string; path?: string } = {},
): Run => {
  const r = spawnSync(
    process.execPath,
    [path.join(SKILL_DIR, "scripts", `${script}.ts`), ...args],
    {
      cwd: root,
      env: { HOME: root, LC_ALL: "C", PATH: opts.path ?? path.join(root, "no-gh") },
      encoding: "utf8",
      input: opts.input,
      timeout: 30_000,
    },
  );
  assert.doesNotMatch(r.stderr, WARNING, `${script} must not emit a Node warning`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const env = (r: Run): Envelope => JSON.parse(r.stdout) as Envelope;

const GOV = (lines: string): string => `## IDEA Session — T\n\n**Parent issue:** #1\n${lines}\n`;
const prop = (t: string): string => `## Proposal: ${t}\n\n**Submitter:** x\n`;
const thread = (body: string, comments: [string, string][]): string =>
  JSON.stringify({ body, comments: comments.map(([a, b]) => ({ author: { login: a }, body: b })) });
const tally = (t: string, extra: string[] = []): Envelope =>
  env(run("idea-tally", ["--comments-file", "-", "--json", ...extra], { input: t }));

describe("idea-tally on the eval fixtures", () => {
  const fx = (n: string): Envelope =>
    env(run("idea-tally", ["--comments-file", path.join(FILES, n), "--json"]));
  test("re-designation voids earlier votes", () => {
    const e = fx("thread-redesignation.json");
    assert.equal(e.data.candidate, "Append-only table");
    assert.deepEqual([e.data.votes.approve, e.data.votes.reject], [1, 1]);
    assert.equal(e.data.voided_votes, 3);
    assert.equal(e.data.threshold_met, false);
  });
  test("implicit candidate, abstain excluded, malformed and ineligible votes ignored", () => {
    const e = fx("thread-abstain.json");
    assert.equal(e.data.candidate, "Weekly releases");
    assert.equal(e.data.implicit, true);
    assert.deepEqual([e.data.votes.approve, e.data.votes.reject, e.data.votes.abstain], [2, 1, 1]);
    assert.equal(e.data.threshold_met, true);
    assert.deepEqual(e.data.missing, ["erin"]);
    assert.deepEqual(e.data.ignored.map((i: { reason: string }) => i.reason).sort(), [
      "malformed",
      "not-eligible",
    ]);
  });
  test("an invalid later [CANDIDATE] designates nothing and voids nothing; solo ignores non-owners", () => {
    const e = fx("thread-invalid-candidate.json");
    assert.equal(e.data.candidate, "YAML config");
    assert.deepEqual([e.data.votes.approve, e.data.votes.reject], [1, 0]);
    assert.equal(e.data.threshold_met, true);
    assert.ok(e.findings.some((f) => f.rule === "invalid-candidate"));
    assert.equal(e.ok, true);
  });
});

describe("idea-tally rules", () => {
  test("unanimity: one REJECT blocks, all APPROVE passes", () => {
    const body = GOV("**Governance mode:** unanimity\n**Owners:** a, b");
    const base: [string, string][] = [
      ["a", prop("P")],
      ["a", "VOTE: APPROVE"],
    ];
    assert.equal(tally(thread(body, [...base, ["b", "VOTE: REJECT"]])).data.threshold_met, false);
    assert.equal(tally(thread(body, [...base, ["b", "VOTE: ABSTAIN"]])).data.threshold_met, false);
    assert.equal(tally(thread(body, [...base, ["b", "VOTE: APPROVE"]])).data.threshold_met, true);
  });
  test("vote: exact boundary reaches the quorum, all-abstain never does", () => {
    const body = GOV("**Governance mode:** vote\n**Voters:** a, b, c\n**Quorum:** 67");
    const p: [string, string] = ["a", prop("P")];
    // 2 of 3 is 66.7 percent: below 67
    assert.equal(
      tally(
        thread(body, [p, ["a", "VOTE: APPROVE"], ["b", "VOTE: APPROVE"], ["c", "VOTE: REJECT"]]),
      ).data.threshold_met,
      false,
    );
    assert.equal(
      tally(
        thread(body, [p, ["a", "VOTE: APPROVE"], ["b", "VOTE: APPROVE"], ["c", "VOTE: REJECT"]]),
        ["--quorum", "66"],
      ).data.threshold_met,
      true,
    );
    assert.equal(
      tally(thread(body, [p, ["a", "VOTE: ABSTAIN"], ["b", "VOTE: ABSTAIN"]])).data.threshold_met,
      false,
    );
  });
  test("a reply is not a vote, a duplicate vote keeps the latest, logins compare case-insensitively", () => {
    const body = GOV("**Governance mode:** solo\n**Owner:** Boss");
    const j = JSON.parse(
      thread(body, [
        ["x", prop("P")],
        ["boss", "VOTE: REJECT"],
        ["BOSS", "VOTE: APPROVE"],
      ]),
    ) as { comments: unknown[] };
    j.comments.push({ author: { login: "boss" }, body: "VOTE: REJECT", in_reply_to: 1 });
    const e = tally(JSON.stringify(j));
    assert.equal(e.data.threshold_met, true);
    assert.ok(e.findings.some((f) => f.rule === "duplicate-vote"));
  });
  test("two surviving proposals and no valid candidate exit 1 with candidate-required", () => {
    const body = GOV("**Governance mode:** solo\n**Owner:** a");
    const r = run("idea-tally", ["--comments-file", "-", "--json"], {
      input: thread(body, [
        ["a", prop("P")],
        ["a", prop("Q")],
        ["a", "VOTE: APPROVE"],
      ]),
    });
    assert.equal(r.status, 1);
    const e = env(r);
    assert.equal(e.ok, false);
    assert.equal(e.data.candidate, null);
    assert.equal(e.findings[0]?.rule, "candidate-required");
  });
  test("a triage rejection leaves a lone survivor, and the options override the body", () => {
    const body = GOV("**Governance mode:** solo\n**Owner:** a");
    const e = tally(
      thread(body, [
        ["a", prop("P")],
        ["a", prop("Q")],
        ["a", "[TRIAGE-REJECTED] Proposal: Q"],
        ["z", "VOTE: APPROVE"],
      ]),
      ["--owner", "z"],
    );
    assert.equal(e.data.candidate, "P");
    assert.equal(e.data.threshold_met, true);
  });
  test("a bare array of comments needs the governance options", () => {
    const arr = JSON.stringify([
      { author: "a", body: prop("P") },
      { author: "a", body: "VOTE: APPROVE" },
    ]);
    assert.equal(run("idea-tally", ["--comments-file", "-", "--json"], { input: arr }).status, 3);
    const e = tally(arr, ["--mode", "solo", "--owner", "a"]);
    assert.equal(e.data.threshold_met, true);
  });
});

describe("contract: help, usage and precondition", () => {
  for (const s of ["idea-tally", "idea-open", "idea-close"]) {
    test(`${s} --help prints the usage and exits 0`, () => {
      const r = run(s, ["--help"]);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Usage:/);
    });
    test(`${s} rejects an unknown option with exit 2 and a usage finding`, () => {
      const r = run(s, ["--bogus", "--json"]);
      assert.equal(r.status, 2);
      const e = env(r);
      assert.deepEqual([e.ok, e.data, e.findings[0]?.rule], [false, null, "usage"]);
    });
  }
  test("idea-tally exits 3 when gh cannot run", () => {
    const r = run("idea-tally", ["--issue", "5", "--json"]);
    assert.equal(r.status, 3);
    assert.equal(env(r).findings[0]?.rule, "precondition");
  });
  test("idea-tally needs exactly one source", () => {
    assert.equal(run("idea-tally", []).status, 2);
    assert.equal(run("idea-tally", ["--issue", "5", "--comments-file", "-"]).status, 2);
  });
  test("an unreadable or non-JSON input exits 3", () => {
    assert.equal(run("idea-tally", ["--comments-file", "missing.json"]).status, 3);
    assert.equal(run("idea-tally", ["--comments-file", "-"], { input: "nope" }).status, 3);
  });
});

describe("idea-open", () => {
  const base = [
    "--mode",
    "vote",
    "--issue",
    "58",
    "--description",
    "Audit trail storage",
    "--voters",
    "alice,@bob",
    "--quorum",
    "60",
  ];
  test("--dry-run prints both commands and creates nothing", () => {
    const r = run("idea-open", [...base, "--dry-run", "--json"]);
    assert.equal(r.status, 0);
    const e = env(r);
    assert.equal(e.data.title, "[IDEA] Audit trail storage (parent #58)");
    assert.deepEqual(e.data.labels, ["idea-session", "idea-vote"]);
    assert.match(e.data.body, /\*\*Voters:\*\* alice, bob\n\*\*Quorum:\*\* 60\n/);
    assert.equal(e.data.session_issue, null);
    assert.match(
      e.data.commands[0],
      /^gh issue create --title '\[IDEA\] Audit trail storage \(parent #58\)' --label idea-session --label idea-vote --body '/,
    );
    assert.match(e.data.commands[1], /^gh issue comment 58 /);
  });
  test("the body of every mode parses back through idea-tally", () => {
    for (const args of [
      ["--mode", "solo", "--owner", "ann"],
      ["--mode", "unanimity", "--owners", "ann,bob"],
      ["--mode", "vote", "--voters", "ann,bob", "--quorum", "50"],
    ]) {
      const open = env(
        run("idea-open", [...args, "--issue", "9", "--description", "D", "--dry-run", "--json"]),
      );
      const t = thread(open.data.body, [
        ["ann", prop("P")],
        ["ann", "VOTE: APPROVE"],
        ["bob", "VOTE: APPROVE"],
      ]);
      const e = tally(t);
      assert.equal(e.data.threshold_met, true, args.join(" "));
    }
  });
  test("usage errors: missing governance parameters, bad quorum", () => {
    assert.equal(
      run("idea-open", ["--mode", "solo", "--issue", "1", "--description", "D"]).status,
      2,
    );
    assert.equal(
      run("idea-open", [
        "--mode",
        "vote",
        "--issue",
        "1",
        "--description",
        "D",
        "--voters",
        "a",
        "--quorum",
        "101",
      ]).status,
      2,
    );
    assert.equal(
      run("idea-open", ["--mode", "vote", "--issue", "1", "--description", "D", "--quorum", "50"])
        .status,
      2,
    );
  });
  test("exit 3 when gh is unavailable", () => {
    assert.equal(run("idea-open", base).status, 3);
  });
});

describe("idea-close", () => {
  const tallyOf = (met: boolean): string =>
    JSON.stringify({
      ok: true,
      data: { candidate: "P", threshold_met: met, votes: { approve: 3, reject: 1, abstain: 0 } },
      findings: [],
    });
  test("resolved: renders the comment, label and close command", () => {
    const r = run(
      "idea-close",
      [
        "--issue",
        "91",
        "--outcome",
        "resolved",
        "--parent",
        "58",
        "--spec",
        "100:Build it",
        "--tally-file",
        "-",
        "--dry-run",
        "--json",
      ],
      { input: tallyOf(true) },
    );
    assert.equal(r.status, 0);
    const e = env(r);
    assert.equal(e.data.label, "idea-resolved");
    assert.match(
      e.data.comment,
      /\*\*Winning proposal:\*\* P\n\*\*Vote tally:\*\* APPROVE: 3, REJECT: 1, ABSTAIN: 0\n/,
    );
    assert.match(e.data.comment, /- #100: Build it/);
    assert.match(e.data.commands[1], /^gh issue edit 91 --add-label idea-resolved$/);
    assert.equal(e.data.commands[2], "gh issue close 91");
  });
  test("resolved is refused when the tally says the threshold is not met", () => {
    const r = run(
      "idea-close",
      [
        "--issue",
        "91",
        "--outcome",
        "resolved",
        "--parent",
        "58",
        "--spec",
        "100:x",
        "--tally-file",
        "-",
        "--dry-run",
        "--json",
      ],
      { input: tallyOf(false) },
    );
    assert.equal(r.status, 1);
    assert.equal(env(r).findings[0]?.rule, "threshold-not-met");
  });
  test("resolved with explicit counts needs a winner; a winner that differs from the tally is refused", () => {
    assert.equal(
      run("idea-close", [
        "--issue",
        "1",
        "--outcome",
        "resolved",
        "--parent",
        "2",
        "--spec",
        "3:x",
        "--approve",
        "1",
        "--reject",
        "0",
        "--abstain",
        "0",
      ]).status,
      2,
    );
    const r = run(
      "idea-close",
      [
        "--issue",
        "1",
        "--outcome",
        "resolved",
        "--parent",
        "2",
        "--spec",
        "3:x",
        "--winner",
        "Other",
        "--tally-file",
        "-",
        "--dry-run",
        "--json",
      ],
      { input: tallyOf(true) },
    );
    assert.equal(r.status, 1);
    assert.equal(env(r).findings[0]?.rule, "winner-mismatch");
  });
  test("no-consensus needs a reason and never carries the resolved label", () => {
    assert.equal(
      run("idea-close", ["--issue", "1", "--outcome", "no-consensus", "--parent", "2"]).status,
      2,
    );
    const e = env(
      run("idea-close", [
        "--issue",
        "1",
        "--outcome",
        "no-consensus",
        "--parent",
        "2",
        "--reason",
        "camps diverge",
        "--dry-run",
        "--json",
      ]),
    );
    assert.equal(e.data.label, "idea-no-consensus");
    assert.match(e.data.comment, /\*\*Reason:\*\* camps diverge/);
    assert.doesNotMatch(e.data.commands.join("\n"), /idea-resolved/);
  });
});

describe("real runs against a fake gh", { skip: process.platform === "win32" }, () => {
  const bin = path.join(root, "bin");
  const log = path.join(root, "gh.log");
  fs.mkdirSync(bin, { recursive: true });
  const fake = (body: string): string => {
    fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${log}"\n${body}\n`, {
      mode: 0o755,
    });
    fs.rmSync(log, { force: true });
    return bin;
  };
  const calls = (): string[] =>
    fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter((l) => /^issue (create|comment|edit|close|view)/.test(l));
  test("idea-tally --issue reads through gh issue view --json", () => {
    const p = fake(`/bin/cat "${path.join(FILES, "thread-redesignation.json")}"`);
    const r = run("idea-tally", ["--issue", "7", "--repo", "o/r", "--json"], { path: p });
    assert.equal(r.status, 0);
    assert.equal(env(r).data.candidate, "Append-only table");
    assert.match(calls()[0] ?? "", /^issue view 7 --json body,comments -R o\/r$/);
  });
  test("idea-open creates then comments with the new issue number", () => {
    const p = fake(`case "$1 $2" in "issue create") echo https://github.com/o/r/issues/77;; esac`);
    const r = run(
      "idea-open",
      ["--mode", "solo", "--owner", "ann", "--issue", "5", "--description", "D", "--json"],
      { path: p },
    );
    assert.equal(r.status, 0);
    assert.equal(env(r).data.session_issue, 77);
    const c = calls();
    assert.equal(c.length > 1, true);
    assert.match(
      fs.readFileSync(log, "utf8"),
      /issue comment 5 --body IDEA session opened: #77 \(solo mode\)\./,
    );
  });
  test("idea-close runs comment, label, close in that order; a failing gh exits 3", () => {
    let p = fake("exit 0");
    assert.equal(
      run(
        "idea-close",
        ["--issue", "9", "--outcome", "no-consensus", "--parent", "2", "--reason", "r"],
        { path: p },
      ).status,
      0,
    );
    assert.deepEqual(
      calls().map((l) => l.split(" ").slice(0, 3).join(" ")),
      ["issue comment 9", "issue edit 9", "issue close 9"],
    );
    p = fake("echo boom >&2; exit 1");
    const r = run(
      "idea-close",
      ["--issue", "9", "--outcome", "no-consensus", "--parent", "2", "--reason", "r", "--json"],
      { path: p },
    );
    assert.equal(r.status, 3);
    assert.equal(calls().length, 1);
  });
});
