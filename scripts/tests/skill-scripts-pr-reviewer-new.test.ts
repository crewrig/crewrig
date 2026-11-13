// skill-scripts-pr-reviewer-new.test.ts — behaviour of the four scripts the pr-reviewer skill
// bundles for the fixed steps of a review: ci-preflight, iter-label, post-verdict, lint-verdict.
// Run from a copy of the skill directory outside the repository, with a fake `gh` (no network).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import { copySkill, envelope, fakeGh, run, tempDir } from "./lib/skill-scripts-pr-reviewer-cli.ts";

const root = tempDir("pr-reviewer-new-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const skill = copySkill(root);
const gh = fakeGh(root);
const PATH = `${gh.bin}${path.delimiter}${path.dirname(process.execPath)}`;
const work = path.join(root, "work");
fs.mkdirSync(work);
const file = (name: string, text: string): string => {
  const p = path.join(work, name);
  fs.writeFileSync(p, text);
  return p;
};
const answer = (key: string, out: string, rc = 0): void => {
  fs.writeFileSync(path.join(gh.state, `${key}.out`), out);
  fs.writeFileSync(path.join(gh.state, `${key}.rc`), String(rc));
};
const calls = (): string[] => {
  try {
    return fs
      .readFileSync(path.join(gh.state, "calls.log"), "utf8")
      .split("\n")
      .filter((l) => l !== "");
  } catch {
    return [];
  }
};
beforeEach(() => {
  for (const f of fs.readdirSync(gh.state)) fs.rmSync(path.join(gh.state, f));
});
const withGh = { path: PATH };
const checks = (...pairs: [string, string][]): string =>
  JSON.stringify(pairs.map(([name, bucket]) => ({ name, bucket })));

describe("ci-preflight", () => {
  test("all checks passing: overall pass, ceiling APPROVE, exit 0 (skipped counts as pass)", () => {
    const f = file("c1.json", checks(["a", "pass"], ["b", "skipping"]));
    const r = run(skill, "ci-preflight", ["--json", "--checks-file", f]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(envelope(r).data, {
      overall: "pass",
      checks: [
        { name: "a", bucket: "pass" },
        { name: "b", bucket: "pass" },
      ],
      verdict_ceiling: "APPROVE",
    });
    assert.deepEqual(calls(), []);
  });
  test("a failing or cancelled check: overall fail, REQUEST_CHANGES, one finding per check, exit 1", () => {
    const f = file("c2.json", checks(["a", "pass"], ["b", "fail"], ["c", "cancel"]));
    const r = run(skill, "ci-preflight", ["--json", "--checks-file", f]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.equal(env.data?.["overall"], "fail");
    assert.equal(env.data?.["verdict_ceiling"], "REQUEST_CHANGES");
    assert.equal(env.findings.length, 2);
  });
  test("a pending check: overall pending, ceiling COMMENT, exit 1", () => {
    const r = run(skill, "ci-preflight", [
      "--json",
      "--checks-file",
      file("c3.json", checks(["a", "pending"])),
    ]);
    assert.equal(r.status, 1);
    assert.equal(envelope(r).data?.["verdict_ceiling"], "COMMENT");
  });
  test("fail wins over pending", () => {
    const r = run(skill, "ci-preflight", [
      "--json",
      "--checks-file",
      file("c4.json", checks(["a", "pending"], ["b", "fail"])),
    ]);
    assert.equal(envelope(r).data?.["overall"], "fail");
  });
  test("it queries gh and passes --required", () => {
    answer("pr_checks", checks(["a", "pass"]));
    const r = run(skill, "ci-preflight", ["12", "--repo", "o/r", "--required", "--json"], withGh);
    assert.equal(r.status, 0, r.stderr);
    assert.match(calls()[0] ?? "", /^pr checks 12 --repo o\/r --required --json name,bucket$/);
  });
  test("--wait repeats the query while pending and reports the last one", () => {
    fs.writeFileSync(path.join(gh.state, "pr_checks.1.out"), checks(["a", "pending"]));
    fs.writeFileSync(path.join(gh.state, "pr_checks.2.out"), checks(["a", "pass"]));
    const r = run(
      skill,
      "ci-preflight",
      ["12", "--wait", "3", "--interval", "1", "--json"],
      withGh,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(calls().length, 2);
  });
  test("--wait stops at the attempt limit and still reports pending", () => {
    answer("pr_checks", checks(["a", "pending"]));
    const r = run(
      skill,
      "ci-preflight",
      ["12", "--wait", "2", "--interval", "1", "--json"],
      withGh,
    );
    assert.equal(r.status, 1);
    assert.equal(calls().length, 2);
    assert.equal(envelope(r).data?.["overall"], "pending");
  });
  test("no checks reported is a pass, not an error", () => {
    fs.writeFileSync(
      path.join(gh.state, "pr_checks.err"),
      "no checks reported on the 'x' branch\n",
    );
    fs.writeFileSync(path.join(gh.state, "pr_checks.rc"), "1");
    assert.equal(run(skill, "ci-preflight", ["12"], withGh).status, 0);
  });
  test("a gh answer that is not JSON is a precondition failure (exit 3)", () => {
    answer("pr_checks", "boom", 1);
    const r = run(skill, "ci-preflight", ["12", "--json"], withGh);
    assert.equal(r.status, 3);
    assert.equal(envelope(r).data, null);
  });
  test("an unreadable --checks-file exits 3; no pull request number exits 2", () => {
    assert.equal(
      run(skill, "ci-preflight", ["--checks-file", path.join(work, "gone.json")]).status,
      3,
    );
    assert.equal(run(skill, "ci-preflight", []).status, 2);
  });
});

describe("iter-label", () => {
  test("one iter label: its number, nothing changed, no call", () => {
    const f = file("l1.json", JSON.stringify(["bug", "iter:3"]));
    const r = run(skill, "iter-label", ["--labels-file", f, "--json"]);
    assert.equal(r.status, 0);
    assert.deepEqual(envelope(r).data, { iter: 3, applied: false });
    assert.deepEqual(calls(), []);
  });
  test("several iter labels: the highest wins and a warning is reported", () => {
    const f = file("l2.json", JSON.stringify([{ name: "iter:1" }, { name: "iter:4" }]));
    const env = envelope(run(skill, "iter-label", ["--labels-file", f, "--json"]));
    assert.equal(env.data?.["iter"], 4);
    assert.equal(env.findings[0]?.severity, "warning");
  });
  test("no iter label: iter:1 is added through gh pr edit --add-label", () => {
    answer("pr_view", JSON.stringify({ labels: [{ name: "bug" }] }));
    const r = run(skill, "iter-label", ["12", "--repo", "o/r", "--json"], withGh);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(envelope(r).data, { iter: 1, applied: true });
    assert.ok(calls().includes("pr edit 12 --repo o/r --add-label iter:1"));
  });
  test("--dry-run prints the command and runs no edit", () => {
    answer("pr_view", JSON.stringify({ labels: [] }));
    const r = run(skill, "iter-label", ["12", "--dry-run", "--json"], withGh);
    assert.equal(r.status, 0);
    assert.match(String(envelope(r).data?.["command"]), /gh pr edit 12 --add-label iter:1/);
    assert.ok(!calls().some((c) => c.startsWith("pr edit")));
  });
  test("a refused label edit exits 3 with no ordinal", () => {
    answer("pr_view", JSON.stringify({ labels: [] }));
    answer("pr_edit", "", 1);
    const r = run(skill, "iter-label", ["12", "--json"], withGh);
    assert.equal(r.status, 3);
    assert.equal(envelope(r).data, null);
  });
  test("no pull request number exits 2", () => {
    assert.equal(run(skill, "iter-label", []).status, 2);
  });
});

const APPROVE = "## Verdict: APPROVE\nseat: review/1\n\nbody\n";
describe("post-verdict", () => {
  const args = (body: string, extra: string[]): string[] => ["12", "--body-file", body, ...extra];
  test("the same identity posts a plain comment, never a review event", () => {
    const r = run(
      skill,
      "post-verdict",
      args(file("v1.md", APPROVE), [
        "--event",
        "approve",
        "--login",
        "a",
        "--author",
        "a",
        "--json",
      ]),
      withGh,
    );
    assert.equal(r.status, 0, r.stderr);
    const env = envelope(r);
    assert.equal(env.data?.["rung"], "comment");
    assert.equal(env.data?.["posted"], true);
    assert.ok(calls().some((c) => c.startsWith("pr comment 12 --body-file")));
    assert.ok(!calls().some((c) => c.startsWith("pr review")));
  });
  test("distinct identities post a formal review with the matching event", () => {
    for (const [ev, flag] of [
      ["approve", "--approve"],
      ["request-changes", "--request-changes"],
      ["comment", "--comment"],
    ]) {
      fs.rmSync(path.join(gh.state, "calls.log"), { force: true });
      const r = run(
        skill,
        "post-verdict",
        args(file("v2.md", "seat: review/1\n"), [
          "--event",
          ev as string,
          "--login",
          "a",
          "--author",
          "b",
        ]),
        withGh,
      );
      assert.equal(r.status, 0, r.stderr);
      assert.ok(
        calls().some((c) => c.startsWith("pr review 12") && c.includes(flag as string)),
        ev,
      );
    }
  });
  test("with the same identity a body without the matching Verdict header is refused (exit 1)", () => {
    const r = run(
      skill,
      "post-verdict",
      args(file("v3.md", "seat: review/1\n"), [
        "--event",
        "approve",
        "--login",
        "a",
        "--author",
        "a",
        "--json",
      ]),
      withGh,
    );
    assert.equal(r.status, 1);
    assert.equal(envelope(r).findings[0]?.rule, "verdict-header");
    assert.deepEqual(calls(), []);
  });
  test("the header must match the event", () => {
    const r = run(
      skill,
      "post-verdict",
      args(file("v4.md", APPROVE), ["--event", "request-changes", "--login", "a", "--author", "a"]),
      withGh,
    );
    assert.equal(r.status, 1);
  });
  test("a body over 12288 bytes is refused whatever the transport (exit 1)", () => {
    const r = run(
      skill,
      "post-verdict",
      args(file("big.md", `${APPROVE}${"x".repeat(12300)}`), [
        "--event",
        "approve",
        "--login",
        "a",
        "--author",
        "b",
        "--json",
      ]),
      withGh,
    );
    assert.equal(r.status, 1);
    assert.equal(envelope(r).findings[0]?.rule, "body-size");
  });
  test("--dry-run prints the command and runs no write", () => {
    const r = run(
      skill,
      "post-verdict",
      args(file("v5.md", APPROVE), [
        "--event",
        "approve",
        "--login",
        "a",
        "--author",
        "a",
        "--dry-run",
        "--json",
      ]),
      withGh,
    );
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.["posted"], false);
    assert.deepEqual(calls(), []);
  });
  test("the identities are looked up through gh when not given", () => {
    answer("api_user", "me\n");
    answer("pr_view", "me\n");
    const r = run(
      skill,
      "post-verdict",
      args(file("v6.md", APPROVE), ["--event", "approve", "--json"]),
      withGh,
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(envelope(r).data?.["rung"], "comment");
    assert.ok(calls().some((c) => c.startsWith("api user")));
  });
  test("a refused post exits 3 with rung denied and says to return the verdict", () => {
    answer("pr_comment", "", 1);
    const r = run(
      skill,
      "post-verdict",
      args(file("v7.md", APPROVE), [
        "--event",
        "approve",
        "--login",
        "a",
        "--author",
        "a",
        "--json",
      ]),
      withGh,
    );
    assert.equal(r.status, 3);
    assert.equal(envelope(r).data?.["rung"], "denied");
    assert.match(envelope(r).findings[0]?.message ?? "", /return the verdict to the orchestrator/);
  });
  test("an unreadable body exits 3; a missing event exits 2", () => {
    assert.equal(
      run(
        skill,
        "post-verdict",
        args(path.join(work, "gone.md"), ["--event", "approve", "--login", "a", "--author", "a"]),
        withGh,
      ).status,
      3,
    );
    assert.equal(
      run(
        skill,
        "post-verdict",
        args(file("v8.md", APPROVE), ["--login", "a", "--author", "a"]),
        withGh,
      ).status,
      2,
    );
  });
});

const verdict = (lines: string[]): string => `${lines.join("\n")}\n`;
const GOOD = verdict([
  "## Verdict: REQUEST CHANGES",
  "seat: review/1892",
  "",
  "**Finding 1 (i2-F1)**",
  "",
  "class: tech",
  "text",
  "",
  "**Finding 2 (i2-F2)**",
  "",
  "class: arch",
  "text",
]);
const lint = (body: string, extra: string[] = ["--surface", "review"]) =>
  run(skill, "lint-verdict", [...extra, "--json", file("verdict.md", body)]);
describe("lint-verdict", () => {
  test("a well-formed review verdict passes (exit 0)", () => {
    const r = lint(GOOD, ["--surface", "review", "--ordinal", "2"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(envelope(r).findings, []);
  });
  test("a verdict without findings passes", () => {
    assert.equal(lint("## Verdict: APPROVE\nseat: review/5\n\nok\n").status, 0);
  });
  test("a finding with no class line is reported and names its identifier", () => {
    const r = lint(GOOD.replace("class: arch\n", ""));
    assert.equal(r.status, 1);
    const f = envelope(r).findings.find((x) => x.rule === "class-missing");
    assert.match(f?.message ?? "", /i2-F2/);
  });
  test("an unknown class value and a duplicated class line are reported", () => {
    assert.ok(
      envelope(lint(GOOD.replace("class: tech", "class: minor"))).findings.some(
        (f) => f.rule === "class-value",
      ),
    );
    assert.ok(
      envelope(lint(GOOD.replace("class: tech", "class: tech\nclass: arch"))).findings.some(
        (f) => f.rule === "class-duplicate",
      ),
    );
  });
  test("an identifier of the wrong surface, a repeated one and a wrong ordinal are reported", () => {
    assert.ok(
      envelope(lint(GOOD.replace("i2-F1", "s2-F1"))).findings.some((f) => f.rule === "id-format"),
    );
    assert.ok(
      envelope(lint(GOOD.replace("i2-F2", "i2-F1"))).findings.some(
        (f) => f.rule === "id-duplicate",
      ),
    );
    assert.ok(
      envelope(lint(GOOD, ["--surface", "review", "--ordinal", "3"])).findings.some(
        (f) => f.rule === "id-ordinal",
      ),
    );
  });
  test("a lowercase sub-finding suffix is accepted on the plan surface", () => {
    const body = verdict([
      "### Verdict: APPROVE",
      "seat: plan/1892",
      "",
      "**Finding 1 (v1-F2a)**",
      "",
      "class: tech",
      "x",
    ]);
    assert.equal(lint(body, ["--surface", "plan"]).status, 0);
  });
  test("a missing, malformed or wrong-surface seat line is reported", () => {
    assert.ok(envelope(lint("## Verdict: APPROVE\n")).findings.some((f) => f.rule === "seat-line"));
    assert.ok(
      envelope(lint("## Verdict: APPROVE\nseat: nonsense\n")).findings.some(
        (f) => f.rule === "seat-line",
      ),
    );
    assert.ok(
      envelope(lint("## Verdict: APPROVE\nseat: plan/1\n")).findings.some(
        (f) => f.rule === "seat-surface",
      ),
    );
  });
  test("--prior-ids requires each prior identifier in the audit, a sub-finding counting for its parent", () => {
    const body = verdict([
      "## Verdict: APPROVE",
      "seat: review/1",
      "",
      "audit: i1-F1 addressed, i1-F2a addressed",
    ]);
    assert.equal(lint(body, ["--surface", "review", "--prior-ids", "i1-F1,i1-F2"]).status, 0);
    const missing = lint(body, ["--surface", "review", "--prior-ids", "i1-F1,i1-F3"]);
    assert.equal(missing.status, 1);
    assert.ok(
      envelope(missing).findings.some(
        (f) => f.rule === "prior-audit" && f.message.includes("i1-F3"),
      ),
    );
  });
  test("--transport checks where the seat line sits", () => {
    const review = verdict(["seat: review/1", "", "body"]);
    assert.equal(lint(review, ["--surface", "review", "--transport", "review"]).status, 0);
    assert.equal(
      lint(`intro\n${review}`, ["--surface", "review", "--transport", "review"]).status,
      1,
    );
    const comment = verdict(["## Verdict: APPROVE", "seat: review/1"]);
    assert.equal(lint(comment, ["--surface", "review", "--transport", "comment"]).status, 0);
    assert.equal(
      lint(verdict(["## Verdict: APPROVE", "", "text", "seat: review/1"]), [
        "--surface",
        "review",
        "--transport",
        "comment",
      ]).status,
      1,
    );
    const plan = verdict([
      "## PLAN review of v1 — issue #1",
      "",
      "### Verdict: APPROVE",
      "seat: plan/1",
    ]);
    assert.equal(lint(plan, ["--surface", "plan", "--transport", "plan"]).status, 0);
  });
  test("text inside a code fence is ignored", () => {
    const body = verdict([
      "## Verdict: APPROVE",
      "seat: review/1",
      "",
      "```",
      "**Finding 1 (i1-F1)**",
      "```",
    ]);
    assert.equal(lint(body).status, 0);
  });
  test("standard input is read with `-`; an unreadable input exits 3; no surface exits 2", () => {
    assert.equal(
      run(skill, "lint-verdict", ["--surface", "review", "-"], { input: GOOD }).status,
      0,
    );
    assert.equal(
      run(skill, "lint-verdict", ["--surface", "review", path.join(work, "gone.md")]).status,
      3,
    );
    assert.equal(run(skill, "lint-verdict", [file("x.md", GOOD)]).status, 2);
  });
});
