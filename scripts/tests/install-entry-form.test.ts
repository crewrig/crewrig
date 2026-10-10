// install-entry-form.test.ts — the entry form of the thirteen install, manage and link entries and the
// silence it buys (spec 0255 R3, R4, R24; spec 0250 R3). Part 1 asserts the CommonJS-form entry
// mechanically on each entry (no module syntax at column 0, `warning` listeners removed first, at most
// 60 lines, the floor guard documented as a separate step). Part 2 runs each entry UNSTUBBED with no
// argument, on the runner's Node.js, no flag and no option in the environment, in a hermetic sandbox
// (throwaway HOME), and asserts standard error holds nothing but the entry's own `Usage:` line.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { createInstallSandbox, runEntry } from "./lib/install-sandbox.ts";

const NAMES = [
  "install-extension",
  "install-extension-all",
  "install-claude-plugin",
  "install-copilot-plugin",
  "install-antigravity-extension",
  "install-workspace",
  "manage-claude-component",
  "manage-copilot-component",
  "manage-antigravity-component",
  "manage-workspace-component",
  "link-extensions",
  "unlink-extensions",
  "unlink-component",
];
const LIMIT = 60;

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
    });
  }
});

describe("silence", () => {
  for (const name of NAMES) {
    test(`${name}.ts with no argument writes nothing but its own usage to standard error`, () => {
      const sandbox = createInstallSandbox();
      const res = runEntry(sandbox, name, [], { leg: "node" });
      assert.doesNotMatch(res.stderr, /\(node:\d+\)|Warning|DeprecationWarning|--trace-warnings/);
      const stderr = res.stderr.split("\n").filter((line) => line !== "");
      for (const line of stderr) assert.match(line, /^Usage: [a-z-]+\.sh /, line);
      assert.ok(res.status === 0 || res.status === 1, `status ${res.status}`);
    });
  }
});
