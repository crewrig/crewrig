// skill-scripts-pr-logbook-lint.test.ts — black-box test of pr-logbook/scripts/lint-pr-body.ts
// (spec 0292 R9, R10, R12, R16), written from the spec: title rules, section rules derived from
// the template, CI skip directives outside code, the gitmoji style, exit codes and --json shape.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { FIXTURES, parseEnvelope, run, tempDir } from "./lib/skill-scripts-pr-logbook-cli.ts";

const tmp = tempDir("pr-logbook-lint-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const VALID = fs.readFileSync(path.join(FIXTURES, "valid-body.md"), "utf8");
const GOOD_TITLE = "Add a thing";

const lint = (title: string, body: string, extra: string[] = []) =>
  run("lint-pr-body", ["--title", title, "--body-file", "-", ...extra], { input: body });
const rules = (r: ReturnType<typeof lint>): string[] =>
  parseEnvelope(r).findings.map((f) => `${f.rule}: ${f.message}`);

describe("lint-pr-body: success and --json", () => {
  test("a title and body that break no rule exit 0", () => {
    const r = lint(GOOD_TITLE, VALID);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("--json prints exactly one {ok, data, findings} object, text goes to stderr only", () => {
    const r = lint(GOOD_TITLE, VALID, ["--json"]);
    assert.equal(r.status, 0);
    const env = parseEnvelope(r);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    assert.ok("data" in env);
  });

  test("--json on a failure: ok false, every finding carries rule and message", () => {
    const r = lint(`${GOOD_TITLE}.`, VALID, ["--json"]);
    assert.equal(r.status, 1);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.ok(env.findings.length >= 1);
    for (const f of env.findings) {
      assert.equal(typeof f.rule, "string");
      assert.ok(f.rule.length > 0);
      assert.equal(typeof f.message, "string");
      assert.ok(f.message.length > 0);
    }
  });

  test("--title-file reads the title and --body-file reads a path", () => {
    const t = path.join(tmp, "title.txt");
    const b = path.join(tmp, "body.md");
    fs.writeFileSync(t, `${GOOD_TITLE}\n`);
    fs.writeFileSync(b, VALID);
    assert.equal(run("lint-pr-body", ["--title-file", t, "--body-file", b]).status, 0);
  });
});

describe("lint-pr-body: title rules", () => {
  test("70 code points pass, 71 fail", () => {
    assert.equal(lint("a".repeat(70), VALID).status, 0);
    const r = lint("a".repeat(71), VALID, ["--json"]);
    assert.equal(r.status, 1);
    assert.equal(parseEnvelope(r).findings.length, 1);
  });

  test("length counts Unicode code points, not UTF-16 units or bytes", () => {
    // 70 astral code points = 140 UTF-16 units = 280 bytes: still within the limit.
    assert.equal(lint("😀".repeat(70), VALID).status, 0);
    assert.equal(lint("😀".repeat(71), VALID).status, 1);
  });

  test("a title ending with a period is a finding", () => {
    const r = lint("Add a thing.", VALID, ["--json"]);
    assert.equal(r.status, 1);
    assert.equal(parseEnvelope(r).findings.length, 1);
  });

  test("without --title-style no title-prefix rule applies", () => {
    assert.equal(lint("feat: add a thing", VALID).status, 0);
  });
});

describe("lint-pr-body: --title-style gitmoji", () => {
  const style = ["--title-style", "gitmoji"];
  const ok = (title: string): number | null => lint(title, VALID, style).status;

  test("exactly one emoji and a space passes", () => {
    assert.equal(ok("✨ Add a thing"), 0);
    assert.equal(ok("🐛 Fix a thing"), 0);
  });

  test("an emoji with a variation selector or a ZWJ sequence is one grapheme cluster", () => {
    assert.equal(ok("❤️ Add a thing"), 0);
    assert.equal(ok("👨‍👩‍👧 Add a thing"), 0);
  });

  test("no emoji, a missing space, or two emoji fail", () => {
    assert.equal(ok("Add a thing"), 1);
    assert.equal(ok("✨Add a thing"), 1);
    assert.equal(ok("✨✨ Add a thing"), 1);
  });

  test("a flag is not Extended_Pictographic at its first code point", () => {
    assert.equal(ok("🇫🇷 Add a thing"), 1);
  });

  test("a conventional-commit prefix fails, after the emoji or at the start", () => {
    assert.equal(ok("✨ feat: add a thing"), 1);
    assert.equal(ok("✨ fix(scope): add a thing"), 1);
    assert.equal(ok("feat: add a thing"), 1);
    assert.equal(ok("feat(scope): add a thing"), 1);
  });

  test("a colon later in the text is not a conventional-commit prefix", () => {
    assert.equal(ok("✨ Add a thing: with details"), 0);
  });
});

describe("lint-pr-body: sections of the bundled template", () => {
  test("a missing section is a finding naming the heading", () => {
    const body = VALID.replace(/## How to test this PR\?[\s\S]*?(?=## Detailed)/, "");
    const r = lint(GOOD_TITLE, body, ["--json"]);
    assert.equal(r.status, 1);
    const f = parseEnvelope(r).findings;
    assert.equal(f.length, 1);
    assert.match(f[0]?.message ?? "", /How to test this PR\?/);
  });

  test("a duplicated section is a finding", () => {
    const r = lint(GOOD_TITLE, `${VALID}\n## How to read this PR?\n\nAgain.\n`);
    assert.equal(r.status, 1);
  });

  test("sections out of order are a finding", () => {
    const body = [
      "Purpose.",
      "## How to test this PR?\n\nx",
      "## How to read this PR?\n\nx",
      "## Detailed description (for agents)\n\nx",
    ].join("\n\n");
    assert.equal(lint(GOOD_TITLE, body).status, 1);
  });

  test("an empty preamble is a finding", () => {
    const body = VALID.slice(VALID.indexOf("## How to read"));
    const r = lint(GOOD_TITLE, body);
    assert.equal(r.status, 1);
  });

  test("the wording of a section or the preamble is not checked", () => {
    const body =
      "x\n\n## How to read this PR?\n\ny\n\n## How to test this PR?\n\nz\n\n## Detailed description (for agents)\n\nw\n";
    assert.equal(lint(GOOD_TITLE, body).status, 0);
  });
});

describe("lint-pr-body: CI skip directives", () => {
  test("scenario: missing section plus [skip ci] gives two findings and exit 1", () => {
    const body = VALID.replace(/## How to test this PR\?[\s\S]*?(?=## Detailed)/, "") + "\n[skip ci]\n";
    const r = lint(GOOD_TITLE, body, ["--json"]);
    assert.equal(r.status, 1);
    const f = parseEnvelope(r).findings;
    assert.equal(f.length, 2);
    assert.ok(f.some((x) => /How to test this PR\?/.test(x.message)));
    assert.ok(f.some((x) => /skip ci/i.test(x.message)));
  });

  for (const directive of ["[skip ci]", "[ci skip]", "[skip actions]", "[no ci]", "[SKIP CI]", "[No Ci]"]) {
    test(`${directive} in the body is a finding`, () => {
      assert.equal(lint(GOOD_TITLE, `${VALID}\nnote ${directive}\n`).status, 1);
    });
  }

  test("a directive in the title is a finding", () => {
    assert.equal(lint("Add a thing [skip ci]", VALID).status, 1);
    assert.equal(lint("Add a thing [CI SKIP]", VALID).status, 1);
  });

  test("a directive inside an inline code span is ignored", () => {
    assert.equal(lint(GOOD_TITLE, `${VALID}\nDo not write \`[skip ci]\` here.\n`).status, 0);
  });

  test("a directive inside a fenced code block is ignored", () => {
    const body = `${VALID}\n\`\`\`text\n[skip ci]\n\`\`\`\n`;
    assert.equal(lint(GOOD_TITLE, body).status, 0);
  });

  test("a directive after a closed fence is found again", () => {
    const body = `${VALID}\n\`\`\`\nx\n\`\`\`\n[skip ci]\n`;
    assert.equal(lint(GOOD_TITLE, body).status, 1);
  });
});

describe("lint-pr-body: --template", () => {
  const tpl = path.join(FIXTURES, "project-template.md");
  const projectBody = path.join(FIXTURES, "project-body.md");

  test("scenario: a project template with ## Summary and ## Testing exits 0, no CrewRig heading required", () => {
    const r = run("lint-pr-body", ["--title", GOOD_TITLE, "--body-file", projectBody, "--template", tpl]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("the sections come from the template: a missing one is named", () => {
    const r = run("lint-pr-body", ["--title", GOOD_TITLE, "--body-file", "-", "--template", tpl, "--json"], {
      input: "## Summary\n\nx\n",
    });
    assert.equal(r.status, 1);
    const f = parseEnvelope(r).findings;
    assert.equal(f.length, 1);
    assert.match(f[0]?.message ?? "", /Testing/);
  });

  test("a template without a preamble requires none", () => {
    // project-body.md starts straight at a heading and passes (above); here the order is checked.
    const r = run("lint-pr-body", ["--title", GOOD_TITLE, "--body-file", "-", "--template", tpl], {
      input: "## Testing\n\nx\n\n## Summary\n\ny\n",
    });
    assert.equal(r.status, 1);
  });
});

describe("lint-pr-body: usage errors (exit 2), preconditions (exit 3), --help", () => {
  test("no argument is a usage error", () => {
    assert.equal(run("lint-pr-body", []).status, 2);
  });

  test("an unknown option is a usage error", () => {
    assert.equal(run("lint-pr-body", ["--title", "x", "--body-file", "-", "--bogus"], { input: "" }).status, 2);
  });

  test("a missing title or a missing body is a usage error", () => {
    assert.equal(run("lint-pr-body", ["--body-file", "-"], { input: VALID }).status, 2);
    assert.equal(run("lint-pr-body", ["--title", "x"]).status, 2);
  });

  test("an unknown --title-style value is a usage error", () => {
    assert.equal(lint("x", VALID, ["--title-style", "nope"]).status, 2);
  });

  test("a usage error with --json still prints one envelope with ok false", () => {
    const r = run("lint-pr-body", ["--json", "--bogus"]);
    assert.equal(r.status, 2);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.ok(env.findings.length >= 1);
  });

  test("an unreadable body file is a precondition failure", () => {
    const r = run("lint-pr-body", ["--title", "x", "--body-file", path.join(tmp, "nope.md")]);
    assert.equal(r.status, 3);
  });

  test("an unreadable template is a precondition failure", () => {
    const r = lint("x", VALID, ["--template", path.join(tmp, "nope.md")]);
    assert.equal(r.status, 3);
  });

  test("--help prints usage on stdout and exits 0", () => {
    const r = run("lint-pr-body", ["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage: /);
    assert.equal(r.stderr, "");
  });
});
