// build-components-hardening-printed-values.test.ts — review pass 4 of delta 01: the lines the build
// prints that carry a VALUE READ FROM A SOURCE (the diagnostic records of spec 0198 and the
// `offering:`, `native:`, `fm:`, `prose:` lines of `--resolve`) write each control character except
// TAB as lower-case `\xNN`. TAB stays: the records are tab-separated by design. The `--diagnostics`
// FILE is written raw. A record with no control character other than TAB prints byte for byte.
//
// On the real mappings no declared value reaches `offering:`, `native:`, `fm:` or `prose:` with a
// control character: a declared value outside its domain is dropped, and only the `model-drop`
// record carries it. The `--resolve` case therefore asserts that record route; the four lines are
// pinned by the unit tests of `escapeControlKeepTab`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { escapeControl, escapeControlKeepTab } from "../lib/escape-control.ts";
import { createSandbox } from "./fixtures/build-components/hardening-kit.ts";
import type { Sandbox } from "./fixtures/build-components/hardening-kit.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { RunResult } from "./lib/build-fixture-tree.ts";

const tree = createFixtureTree();
const SKIP =
  process.platform === "win32" ? "skipped: printed paths use the native separator" : false;
const lines = (text: string): string[] => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
const RAW_NOT_TAB = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const AGENT = "artifacts/core/agents/forge/AGENT.md";

const agent = (intelligence: string): string =>
  `---\nname: forge\ndescription: "d"\nmetadata:\n  model:\n    intelligence: ${intelligence}\n---\nBody.\n`;

function sandbox(intelligence: string): Sandbox {
  const box = createSandbox(tree);
  box.seedMappings();
  box.write(AGENT, agent(intelligence));
  return box;
}

function assertInert(run: RunResult): void {
  for (const line of [...lines(run.stdout), ...lines(run.stderr)]) {
    assert.ok(!line.startsWith("::"), `forged line: ${line}`);
    assert.ok(!RAW_NOT_TAB.test(line), `raw control character: ${JSON.stringify(line)}`);
  }
  assert.doesNotMatch(run.stdout + run.stderr, /\r/);
}

const fields = (cli: string, value: string): string[] => [
  "model-drop",
  "forge",
  cli,
  "metadata.model.intelligence",
  value,
  "unsupported-on-cli",
];

describe("a diagnostic record carries a source value, escaped but for TAB", { skip: SKIP }, () => {
  const HOSTILE = '"nonsense\\n::error::forged"';

  test("a build: one escaped record, its five TABs intact, nothing forged", () => {
    const box = sandbox(HOSTILE);
    const run = box.run(["--target", "copilot"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assertInert(run);
    const records = lines(run.stderr).filter((l) => l.startsWith("model-drop"));
    assert.deepEqual(records, [fields("copilot", "nonsense\\x0a::error::forged").join("\t")]);
    assert.equal(records[0]?.split("\t").length, 6);
  });

  test("the --diagnostics file keeps the raw text, newline included", () => {
    const box = sandbox(HOSTILE);
    const file = path.join(box.container, "diag.txt");
    const run = box.run(["--target", "copilot", "--diagnostics", file]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const raw = fs.readFileSync(file, "utf8");
    assert.ok(lines(raw).includes("::error::forged\tunsupported-on-cli"), JSON.stringify(raw));
    assert.equal(raw, `${fields("copilot", "nonsense\n::error::forged").join("\t")}\n`);
  });

  test("--resolve: the record is escaped, every printed line is inert", () => {
    const box = sandbox(HOSTILE);
    for (const target of ["copilot", "claude", "gemini"]) {
      const run = box.run(["--resolve", path.join(box.repo, AGENT), target]);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assertInert(run);
      const all = [...lines(run.stdout), ...lines(run.stderr)].filter((l) =>
        l.includes("nonsense"),
      );
      // Only copilot drops the value; claude and gemini print nothing that carries it.
      assert.equal(all.length > 0, target === "copilot", target);
      for (const line of all) assert.match(line, /nonsense\\x0a::error::forged/, target);
    }
  });

  test("a tab inside a value is kept, as the field separator is", () => {
    const box = sandbox('"a\\tb\\u0001c"');
    const run = box.run(["--target", "copilot"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const [record] = lines(run.stderr).filter((l) => l.startsWith("model-drop"));
    assert.equal(record, fields("copilot", "a\tb\\x01c").join("\t"));
  });
});

describe("a record with no control character is printed as before", { skip: SKIP }, () => {
  test("the stderr line and the --diagnostics file equal the raw record", () => {
    const box = sandbox("nonsense");
    const file = path.join(box.container, "diag.txt");
    const run = box.run(["--target", "copilot", "--diagnostics", file]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const record = fields("copilot", "nonsense").join("\t");
    assert.deepEqual(
      lines(run.stderr).filter((l) => l.startsWith("model-")),
      [record],
    );
    assert.equal(fs.readFileSync(file, "utf8"), `${record}\n`);
  });
});

describe("escapeControlKeepTab and escapeControl", () => {
  test("keep-tab: TAB kept; LF, CR, ESC, NUL, DEL and the rest of C0 escaped in lower case", () => {
    assert.equal(escapeControlKeepTab("a\tb"), "a\tb");
    assert.equal(
      escapeControlKeepTab("\n\r\u001b\u0000\u007f\u001f"),
      "\\x0a\\x0d\\x1b\\x00\\x7f\\x1f",
    );
  });

  test("keep-tab: a backslash, a printable text, C1, accents and astral characters are untouched", () => {
    for (const text of ["a\\x0a", "\\", "plain text ~", "\u0080é", "😀 \u{1f9d1}‍\u{1f4bb}"]) {
      assert.equal(escapeControlKeepTab(text), text);
    }
  });

  test("escapeControl escapes TAB as \\x09, the one difference", () => {
    assert.equal(escapeControl("a\tb"), "a\\x09b");
    for (const text of ["\n\r\u001b\u0000\u007f", "x\\y", "😀"]) {
      assert.equal(escapeControlKeepTab(text), escapeControl(text));
    }
  });
});
