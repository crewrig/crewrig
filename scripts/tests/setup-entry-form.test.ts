// setup-entry-form.test.ts — the entry form of the four setup entries and the silence it buys (spec 0256
// requirement 6, spec 0255 R3). Part 1 asserts the CommonJS-form entry mechanically (no module syntax at
// column 0, `warning` listeners removed first, at most 80 lines, the floor guard documented as a separate
// step). Part 2 runs each entry UNSTUBBED with a malformed `--answer`, which fails before anything is
// touched, in a hermetic sandbox (throwaway HOME), and asserts standard error holds exactly one `Error:`
// line: no Node.js warning, no stack trace.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { createInstallSandbox, listTree, runEntry } from "./lib/install-sandbox.ts";

const NAMES = [
  "setup-claude-interactive",
  "setup-gemini-interactive",
  "setup-copilot-interactive",
  "setup-antigravity-interactive",
];
const LIMIT = 80;

/** A file's code, without its full-line comments (which may name `import()`). */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

describe("entry form", () => {
  for (const name of NAMES) {
    const entry = `scripts/${name}.ts`;
    const text = fs.readFileSync(path.join(REPO, entry), "utf8");
    const lines = text.split("\n");

    test(`${entry}: no module syntax or global declaration at column 0`, () => {
      const offending = lines.filter((line) =>
        /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
          line,
        ),
      );
      assert.deepEqual(offending, []);
    });

    test(`${entry}: the first statement removes the warning listeners, before the first import()`, () => {
      const first = lines.find((line) => line.trim() !== "" && !line.startsWith("//"));
      assert.equal(first, 'process.removeAllListeners("warning");');
      const body = code(text);
      assert.ok(body.search(/\bimport\(/) > body.indexOf('process.removeAllListeners("warning")'));
      assert.doesNotMatch(body, /uncaughtException/);
      assert.doesNotMatch(body, /process\.exit\(/);
      assert.match(body, /process\.exitCode\s*=/);
    });

    test(`${entry}: at most ${LIMIT} lines, floor guard documented as a separate step`, () => {
      assert.ok(lines.length - 1 <= LIMIT, `${lines.length - 1} lines`);
      const header = lines.filter((line) => line.startsWith("//")).join("\n");
      assert.match(header, /node scripts\/lib\/node-floor-guard\.js/);
      assert.match(header, /SEPARATE step/);
    });
  }
});

describe("silence", () => {
  for (const name of NAMES) {
    test(`${name}.ts with a malformed --answer writes one Error line to standard error and nothing to HOME`, () => {
      const sandbox = createInstallSandbox();
      const before = listTree(sandbox.home);
      const res = runEntry(sandbox, name, ["--answer", "no-equal-sign"], { leg: "node" });
      assert.doesNotMatch(res.stderr, /\(node:\d+\)|Warning|DeprecationWarning|--trace-warnings/);
      const stderr = res.stderr.split("\n").filter((line) => line !== "");
      assert.equal(stderr.length, 1, res.stderr);
      assert.match(stderr[0] ?? "", /^Error: --answer expects <id>=<value>/);
      assert.equal(res.status, 2);
      assert.deepEqual(listTree(sandbox.home), before);
    });
  }
});
