// extension-hooks-entry-form.test.ts — the entry form of the three example hooks and the static
// assertion of spec 0258 R19: no module syntax at column 0, `process.removeAllListeners("warning")`
// as the first statement, the body inside an async wrapper, `process.exitCode` and never
// `process.exit`, built-ins by `process.getBuiltinModule` only, and no `import` statement, no
// `import()` and no `require` outside the comments (strings are kept, so a URL is not a comment).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { HOOKS, REPO } from "./lib/extension-hooks-harness.ts";
import { stripComments } from "./lib/setup-source-scan.ts";

describe("the comment stripper keeps strings and drops comments", () => {
  test("a URL in a string is not a comment; a trailing comment is dropped", () => {
    const source = 'const u = "https://x"; // import("y")\n/* require("z") */ const v = `//`;\n';
    const code = stripComments(source);
    assert.match(code, /"https:\/\/x";/);
    assert.match(code, /`\/\/`;/);
    assert.doesNotMatch(code, /import|require/);
  });
});

for (const hook of HOOKS) {
  const file = `${hook}.ts`;
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  const lines = text.split("\n");
  const code = stripComments(text);

  describe(`${file}: entry form`, () => {
    test("no module syntax or global declaration at column 0", () => {
      const offending = lines.filter((line) =>
        /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
          line,
        ),
      );
      assert.deepEqual(offending, []);
    });

    test("the first statement removes the warning listeners", () => {
      const first = code.split("\n").find((line) => line.trim() !== "");
      assert.equal(first, 'process.removeAllListeners("warning");');
    });

    test("the body is in an async wrapper and the exit code is set, never process.exit", () => {
      assert.match(code, /^void \(async \(\) => \{$/m);
      assert.match(code, /^\}\)\(\);$/m);
      assert.match(code, /process\.exitCode\s*=\s*0/);
      assert.doesNotMatch(code, /process\.exit\s*\(/);
      assert.doesNotMatch(code, /uncaughtException/);
    });

    test("built-ins come from process.getBuiltinModule; standard input is never slurped", () => {
      assert.match(code, /process\.getBuiltinModule\("node:fs"\)/);
      assert.doesNotMatch(code, /readFileSync/);
      assert.doesNotMatch(code, /process\.stdin/);
    });
  });

  describe(`${file}: static assertion (R19)`, () => {
    test("no import statement, no import() and no require outside the comments", () => {
      assert.doesNotMatch(code, /\bimport\b/);
      assert.doesNotMatch(code, /\brequire\b/);
    });
  });
}

describe("the skeleton hook", () => {
  const text = fs.readFileSync(path.join(REPO, "extension-skeleton/hook/hooks/logger.ts"), "utf8");

  test("its header carries the substitution token and mirrors the shell header", () => {
    assert.ok(text.startsWith("// Hook: ${SKELETON_NAME} logger\n"));
    assert.match(text.split("\n")[1] ?? "", /Intercepts tool calls/);
  });

  test("its comment shows where a cheap guard and a lazy import() belong, and only in a comment", () => {
    assert.match(text, /^\/\/.*cheap guard/m);
    assert.match(text, /^\/\/.*lazy import\(\)/m);
    assert.doesNotMatch(stripComments(text), /\bimport\b/);
  });
});
