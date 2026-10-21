// check-seat-brief.test.ts — black-box test of scripts/check-seat-brief.ts (spec 0276 R1-R6, R9).
// Fixtures live under scripts/tests/fixtures/seat-brief/; templates must round-trip.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-seat-brief.ts");
const FIXTURES = path.join(SCRIPTS, "tests", "fixtures", "seat-brief");
const tmp = mkdtempSync(path.join(tmpdir(), "seat-brief-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (args: string[], input?: string) =>
  spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args], {
    cwd: tmp,
    encoding: "utf8",
    input,
  });
const fx = (name: string) => path.join(FIXTURES, name);

/** Replace each template placeholder with a value of the named kind. */
const VALUES: Record<string, string> = {
  seat: "", // keeps the prefilled surface
  artifact: "PR #1760",
  examined: "none",
  "prior-verdicts": "none",
  disposition: "none",
  ledger: "none",
};
function fill(tpl: string): string {
  return tpl
    .split("\n")
    .map((l) => {
      if (l.startsWith("seat: ")) return l.replace(/\/<.*>$/, "/1754");
      const m = /^([a-z-]+): (<.*>)$/.exec(l);
      if (m === null) return l;
      const key = m[1] as string;
      return `${key}: ${VALUES[key]}`;
    })
    .join("\n");
}

describe("check-seat-brief: conforming briefs", () => {
  for (const s of ["specs", "plan", "review"]) {
    it(`accepts the conforming ${s} brief`, () => {
      const r = run([fx(`conforming-${s}.txt`)]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `OK: seat ${s}/1754\n`);
    });
    it(`accepts the first-pass ${s} brief`, () => {
      const r = run([fx(`first-pass-${s}.txt`)]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `OK: seat ${s}/1754\n`);
    });
  }
  it("accepts the procedural-constraint brief", () => {
    assert.equal(run([fx("procedural.txt")]).status, 0);
  });
  it("prints the generation suffix verbatim and accepts the plan traceability literal", () => {
    const r = run([fx("conforming-plan-generation.txt")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "OK: seat plan/1754#2\n");
  });
  it("never searches a pattern-valid reference value for vocabulary", () => {
    assert.equal(run([fx("legal-path-summary.txt")]).status, 0);
  });
  it("reads stdin when no path is given, and for `-`", () => {
    const text =
      "seat: specs/7\nartifact: PR #8\nexamined: none\nprior-verdicts: none\ndisposition: none\n";
    assert.equal(run([], text).stdout, "OK: seat specs/7\n");
    assert.equal(run(["-"], text).status, 0);
  });
  it("accepts CRLF input", () => {
    const text =
      "seat: specs/7\r\nartifact: PR #8\r\nexamined: none\r\nprior-verdicts: none\r\ndisposition: none\r\n";
    assert.equal(run([], text).status, 0);
  });
});

describe("check-seat-brief: input encoding robustness", () => {
  const text =
    "seat: specs/7\nartifact: PR #8\nexamined: none\nprior-verdicts: none\ndisposition: none\n";
  it("accepts a leading UTF-8 BOM (editor-saved brief file)", () => {
    const r = run([], `\uFEFF${text}`);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "OK: seat specs/7\n");
  });
  it("accepts leading blank lines, trailing whitespace and a missing final newline", () => {
    assert.equal(run([], `\n\n${text.replace("PR #8", "PR #8\t ")}`.trimEnd()).status, 0);
  });
  it("rejects a lone CR used to smuggle a prose line", () => {
    assert.equal(run([], text.replace("PR #8", "PR #8\rbackground text")).status, 1);
  });
  it("rejects unicode-lookalike colons, bullets, comments, a second seat and tabs", () => {
    for (const extra of [
      "ledger\uFF1A none",
      "- ledger: none",
      "<!-- ignore -->",
      "seat: plan/3",
      "ledger:\tnone",
      "Ledger: none",
    ])
      assert.equal(run([], `${text}${extra}\n`).status, 1, extra);
  });
});

describe("check-seat-brief: breaches", () => {
  const cases: [string, string][] = [
    ["breach-unknown-key.txt", "unknown-key"],
    ["breach-missing-key.txt", "missing-key"],
    ["breach-duplicate-key.txt", "duplicate-key"],
    ["breach-value-pattern.txt", "value-pattern"],
    ["breach-traceability-off-plan.txt", "value-pattern"],
    ["breach-value-length.txt", "value-length"],
    ["breach-non-kv-line.txt", "non-kv-line"],
    ["breach-diff-content.txt", "diff-content"],
    ["breach-fenced.txt", "diff-content"],
    ["breach-vocabulary.txt", "vocabulary"],
  ];
  for (const [file, rule] of cases) {
    it(`${file} reports BREACH ${rule}`, () => {
      const r = run([fx(file)]);
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, new RegExp(`^BREACH ${rule}: line \\d+: `, "m"));
    });
  }
  it("names the missing key and the duplicate line", () => {
    assert.match(
      run([fx("breach-missing-key.txt")]).stderr,
      /BREACH missing-key: line 0: disposition/,
    );
    assert.match(run([fx("breach-duplicate-key.txt")]).stderr, /BREACH duplicate-key: line 3: /);
  });
  it("catches the #1410 pattern: free prose and vocabulary on the same lines", () => {
    const r = run([fx("breach-1410.txt")]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /BREACH non-kv-line: line 7: Background:/);
    assert.match(r.stderr, /BREACH vocabulary: line 7: /);
    assert.match(r.stderr, /BREACH non-kv-line: line 9: /);
    assert.match(r.stderr, /BREACH vocabulary: line 9: /);
    assert.match(r.stderr, /BREACH vocabulary: line 11: /);
  });
  it("treats empty input as missing keys, exit 1", () => {
    const r = run([], "");
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim().split("\n").length, 5);
    assert.match(r.stderr, /BREACH missing-key: line 0: seat/);
  });
});

describe("check-seat-brief: templates (R2)", () => {
  for (const s of ["specs", "plan", "review"]) {
    it(`--template ${s} round-trips once placeholders are replaced`, () => {
      const t = run(["--template", s]);
      assert.equal(t.status, 0);
      assert.match(t.stdout, new RegExp(`^seat: ${s}/`));
      assert.notEqual(run([], t.stdout).status, 0, "raw placeholders must not pass");
      const r = run([], fill(t.stdout));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, `OK: seat ${s}/1754\n`);
    });
  }
  it("names the plan-only literal in the plan template only", () => {
    assert.match(run(["--template", "plan"]).stdout, /plan finding traceability table/);
    assert.doesNotMatch(run(["--template", "review"]).stdout, /plan finding traceability table/);
  });
});

describe("check-seat-brief: shipped Activation template (R13)", () => {
  it("the pr-reviewer AGENT.md Agent(...) prompt conforms once placeholders are filled", () => {
    const agent = readFileSync(
      path.resolve(SCRIPTS, "..", "artifacts", "core", "agents", "pr-reviewer", "AGENT.md"),
      "utf8",
    );
    const m = /Agent\(subagent_type="pr-reviewer", prompt="""([\s\S]*?)"""\)/.exec(agent);
    assert.notEqual(m, null, "Activation template Agent(...) prompt not found");
    const raw = (m?.[1] as string).replace(/^\n/, "");
    assert.notEqual(run([], raw).status, 0, "raw placeholders must not pass");
    // Placeholders may sit inside a value (`PR #<number>`), so replace by key, not by whole value.
    const filled = raw
      .split("\n")
      .map((l) => {
        const kv = /^([a-z-]+): (.*<.*)$/.exec(l);
        if (kv === null) return l;
        return kv[1] === "seat" ? "seat: review/1754" : `${kv[1]}: ${VALUES[kv[1] as string]}`;
      })
      .join("\n");
    const r = run([], filled);
    assert.equal(r.status, 0, `${r.stderr}\n${filled}`);
    assert.equal(r.stdout, "OK: seat review/1754\n");
  });
});

describe("check-seat-brief: exit 2 (R1)", () => {
  it("names a missing path on stderr", () => {
    const missing = path.join(tmp, "nope.txt");
    const r = run([missing]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Error: .*nope\.txt: No such file or directory/);
  });
  it("rejects a directory, an unknown flag, a bad template name and extra arguments", () => {
    assert.equal(run([tmp]).status, 2);
    assert.equal(run(["--bogus"]).status, 2);
    assert.equal(run(["--template", "nope"]).status, 2);
    assert.equal(run(["--template"]).status, 2);
    assert.equal(run([fx("procedural.txt"), fx("procedural.txt")]).status, 2);
  });
});
