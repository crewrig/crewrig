// build-extension-suite-context.test.ts — the context render (spec 0181, issue #1007) through
// the real `node scripts/build-extension.ts --target all` in a sandbox: Case 19 in full.
// Replaces scripts/tests/test-build-extension.sh (case 19).
//
// Every span-shape output is asserted twice: stripped of trailing newlines (what the Bash
// `$(cat)` compared) and as raw bytes (nothing pinned them before). One sandbox, sequential tests.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import {
  cloneTemplate,
  createTemplate,
  fixtureManifest,
  render,
  writeFile,
  writeManifest,
  check,
  type EntryResult,
} from "./lib/extension-sandbox.ts";

let root = "";
let ctx = "";
before(() => {
  root = cloneTemplate(createTemplate());
  ctx = writeManifest(
    root,
    "ctxfix",
    fixtureManifest("ctxfix", {
      commands: { location: "commands/" },
      skills: { location: "skills/" },
      context: { source: "CONTEXT.md" },
    }),
  );
  writeFile(
    ctx,
    "commands/ok-cmd.md",
    '---\nname: ok-cmd\ndescription: "ok"\ntype: command\n---\nBody.\n',
  );
  writeFile(
    ctx,
    "skills/ok-skill/SKILL.md",
    '---\nname: ok-skill\ndescription: "ok"\n---\nBody.\n',
  );
});

const GEMINI = (): string => path.join(root, "build", "extensions", "ctxfix", "GEMINI.md");
const CLAUDE = (): string => path.join(ctx, "dist-claude-plugin", "ctxfix", "CLAUDE.md");
const COPILOT = (): string =>
  path.join(root, "dist-copilot-plugin", "ctxfix", "skills", "ctxfix-context", "SKILL.md");
const ANTIGRAVITY = (): string =>
  path.join(root, "dist-antigravity-plugin", "ctxfix", "rules", "AGENTS.md");

function clean(): void {
  for (const dir of [
    path.join(root, "build"),
    path.join(ctx, "dist-claude-plugin"),
    path.join(root, "dist-copilot-plugin"),
    path.join(root, "dist-antigravity-plugin"),
  ])
    fs.rmSync(dir, { recursive: true, force: true });
}

/** Write CONTEXT.md, start from empty build roots, render every target. */
function ctxCase(content: string): EntryResult {
  fs.writeFileSync(path.join(ctx, "CONTEXT.md"), content);
  clean();
  return render(root, "all", "ctxfix");
}

const raw = (file: string): string => fs.readFileSync(file, "utf8");
const stripped = (file: string): string => raw(file).replace(/\n+$/, "");

describe("Case 19 — the nine diagnostics", () => {
  const ROWS: readonly (readonly [string, string, ...string[]])[] = [
    ["UNKNOWN-TARGET", "x${ONLY:bogus}y${ENDONLY}z", "UNKNOWN-TARGET", "bogus"],
    ["EMPTY-TARGET-LIST", "x${ONLY:}y${ENDONLY}z", "EMPTY-TARGET-LIST"],
    [
      "SPAN-KEPT-NOWHERE",
      "x${EXCEPT:gemini,claude,copilot,antigravity}y${ENDEXCEPT}z",
      "SPAN-KEPT-NOWHERE",
    ],
    ["UNCLOSED-BLOCK", "x${ONLY:claude}y", "UNCLOSED-BLOCK"],
    ["STRAY-BLOCK-END", "x${ENDONLY}y", "STRAY-BLOCK-END"],
    ["MISMATCHED-BLOCK-END", "x${ONLY:claude}y${ENDEXCEPT}z", "MISMATCHED-BLOCK-END"],
    // A CROSSING pair, not a contained one: v2-F2's own input.
    ["NESTED-BLOCK", "A${ONLY:copilot}B${EXCEPT:gemini}C${ENDONLY}D${ENDEXCEPT}E", "NESTED-BLOCK"],
    ["UNRESOLVED-REFERENCE", "x ${COMMAND:nope} y", "UNRESOLVED-REFERENCE", "COMMAND:nope"],
    [
      "UNRESOLVED-REFERENCE-growth",
      "x ${COMMAND:nope} y ${SKILL:alsonope} z",
      "UNRESOLVED-REFERENCE",
      "COMMAND:nope",
      "SKILL:alsonope",
    ],
  ];
  test("Case 19 — nine diagnostic rows", () => assert.equal(ROWS.length, 9));
  for (const [label, content, ...needles] of ROWS) {
    test(`Case 19 (${label}) — fired as expected, naming ${needles.join(" ")}`, () => {
      const res = ctxCase(content);
      assert.notEqual(res.status, 0, res.combined);
      for (const needle of needles) assert.ok(res.combined.includes(needle), res.combined);
    });
  }
});

describe("Case 19 — R5: an undeclared command reference produces no context output", () => {
  let res: EntryResult;
  before(() => {
    res = ctxCase("x ${COMMAND:nope} y");
  });
  test("Case 19 (R5) — an undeclared command reference fails the render, naming the token and the file", () => {
    assert.notEqual(res.status, 0, res.combined);
    assert.ok(res.combined.includes("UNRESOLVED-REFERENCE"), res.combined);
    assert.ok(res.combined.includes("CONTEXT.md"), res.combined);
  });
  test("Case 19 (R5) — no context output was produced under any of the four build roots", () => {
    for (const file of [GEMINI(), CLAUDE(), COPILOT(), ANTIGRAVITY()])
      assert.equal(fs.existsSync(file), false, `${file} exists despite the R5 failure`);
  });
});

describe("Case 19 — the span shapes the prototype run proved necessary", () => {
  test("Case 19 (splice) — a dropped multi-line span joins its prefix and suffix into one line", () => {
    const res = ctxCase("before${ONLY:copilot}\nmiddle\n${ENDONLY}after\n");
    assert.equal(res.status, 0, res.combined);
    assert.equal(stripped(GEMINI()), "beforeafter");
    assert.equal(raw(GEMINI()), "beforeafter\n");
  });

  test("Case 19 (consumed-line) — the interior line's own content never appears in the output", () => {
    const res = ctxCase("A\n${ONLY:copilot}\nwholly inside\n${ENDONLY}\nB\n");
    assert.equal(res.status, 0, res.combined);
    assert.equal(stripped(GEMINI()), "A\n\nB");
    assert.equal(raw(GEMINI()), "A\n\nB\n");
    assert.ok(!raw(GEMINI()).includes("wholly inside"));
  });

  test("Case 19 (kept-alone-on-line) — a kept ${ONLY:...} alone on its own line leaks no blank line", () => {
    const res = ctxCase("A\n${ONLY:claude}\nkept\n${ENDONLY}\nB\n");
    assert.equal(res.status, 0, res.combined);
    assert.equal(stripped(CLAUDE()), "A\nkept\nB");
    assert.equal(raw(CLAUDE()), "A\nkept\nB\n");
  });
});

describe("Case 19 — R4 passthrough and R15", () => {
  test("Case 19 (R4 passthrough) — ${extensionPath} and the escaped ${ONLY:copilot} survive verbatim on every target", () => {
    const res = ctxCase("path ${extensionPath} and $${ONLY:copilot} literal.");
    assert.equal(res.status, 0, res.combined);
    for (const file of [GEMINI(), CLAUDE(), ANTIGRAVITY()]) {
      assert.ok(fs.existsSync(file), `${file} missing`);
      const text = raw(file);
      assert.ok(text.includes("${extensionPath}"), file);
      assert.ok(text.includes("${ONLY:copilot}"), file);
    }
    assert.ok(fs.existsSync(COPILOT()), "copilot context skill missing");
    assert.ok(raw(COPILOT()).includes("${extensionPath}"));
  });

  test("Case 19 (R15 negative) — an extension declaring no context section renders/checks cleanly, no GEMINI.md produced or declared", () => {
    clean();
    writeManifest(root, "nocontext", fixtureManifest("nocontext"));
    const res = check(root, "nocontext");
    assert.equal(res.status, 0, res.combined);
    assert.ok(!/GEMINI\.md/i.test(res.combined), res.combined);
  });
});
