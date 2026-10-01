// jsonc.test.ts — tests for scripts/lib/jsonc.ts (spec 0245 R8, R12; PLAN v2
// step 9, plan review v1-F2, v1-F4, v2-F3).
//
// - `stripJsonComments` against a corpus of the cases the Gemini CLI JSONC
//   dialect makes tricky, AND byte for byte against the shell reference
//   `gs_strip_jsonc` (scripts/lib/gemini-settings.sh), so the TypeScript port
//   cannot drift. The parity check needs `jq`: it skips locally without it and
//   FAILS when `CI` is set, where the capability declares `tools: [jq]`.
// - `findDuplicateKey` on duplicates at depth, by decoded key value.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/jsonc.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { findDuplicateKey, stripJsonComments } from "../lib/jsonc.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// [label, input, expected output]. Each comment becomes exactly ONE space.
const CORPUS: readonly (readonly [string, string, string])[] = [
  ["empty text", "", ""],
  ["plain JSON is unchanged", '{"a":[1,2],"b":{"c":null}}', '{"a":[1,2],"b":{"c":null}}'],
  ["// and /* inside strings are kept", '{"a":"//not","b":"/*x*/"}', '{"a":"//not","b":"/*x*/"}'],
  ["escaped quote does not end the string", '{"a":"x\\"//y"} // c', '{"a":"x\\"//y"}  '],
  ["escaped backslash then quote ends the string", '{"a":"x\\\\"} // c', '{"a":"x\\\\"}  '],
  ["line comment runs to, not through, the newline", '{"a":1, // c\n"b":2}', '{"a":1,  \n"b":2}'],
  ["the CR of a CRLF belongs to the line comment", '{"a":1} // c\r\n', '{"a":1}  \n'],
  ["block comment becomes one space", '{/* c */"a":1}', '{ "a":1}'],
  ["block comment with extra stars", '/** doc **/{"a":1}', ' {"a":1}'],
  ["multi-line block comment", '{\n/* a\n b */\n"a":1}', '{\n \n"a":1}'],
  ["unclosed block comment runs to EOF", '{"a":1} /* never closed', '{"a":1}  '],
  ["unclosed block ending in a star", '{"a":1} /* x *', '{"a":1}  '],
  ["unclosed string runs to EOF, nothing after is a comment", '{"a":"x // y', '{"a":"x // y'],
  ["1/**/2 stays two tokens", "1/**/2", "1 2"],
  ["a lone slash is not a comment", '{"a":1/2}', '{"a":1/2}'],
  ["BOM is kept", '\uFEFF{"a":1}', '\uFEFF{"a":1}'],
  ["non-ASCII in strings and comments", '{"é":"日本"} // ü\n', '{"é":"日本"}  \n'],
  // plan review v2-F3: trailing-byte handling is compared too.
  ["text ending in an unterminated // comment", '{"a":1}\n// tail', '{"a":1}\n '],
  ["text that is only a // comment", "// only", " "],
];

describe("stripJsonComments", () => {
  for (const [label, input, expected] of CORPUS) {
    test(label, () => {
      assert.equal(stripJsonComments(input), expected);
    });
  }

  test("1/**/2 is rejected by JSON.parse once stripped, as Gemini CLI rejects it", () => {
    assert.throws(() => JSON.parse(stripJsonComments("1/**/2")), SyntaxError);
  });

  test("a stripped commented document parses to the same value", () => {
    const text = '{\n  // the theme\n  "ui": {"theme": "Dracula"}, /* trailing */\n  "n": 1\n}\n';
    assert.deepEqual(JSON.parse(stripJsonComments(text)), { ui: { theme: "Dracula" }, n: 1 });
  });

  test("linear on an adversarial run of escaped quotes", () => {
    const text = `"${'\\"'.repeat(200_000)}`;
    const start = process.hrtime.bigint();
    assert.equal(stripJsonComments(text), text);
    assert.ok(process.hrtime.bigint() - start < 2_000_000_000n, "took over 2 s");
  });
});

/** `gs_strip_jsonc` over `input`, raw bytes out (`-j`: no trailing newline). */
function shellStrip(input: string): string {
  const result = spawnSync(
    "bash",
    [
      "-c",
      'source scripts/lib/common.sh </dev/null && source scripts/lib/gemini-settings.sh </dev/null && jq -Rjs "$_GS_JQ_DEFS gs_strip_jsonc"',
    ],
    { cwd: REPO, input, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `shell reference failed: ${result.stderr}`);
  return result.stdout;
}

const hasJq = spawnSync("jq", ["--version"]).status === 0;

describe("stripJsonComments matches gs_strip_jsonc byte for byte", () => {
  if (!hasJq) {
    if (process.env["CI"]) {
      test("jq is available (required under CI)", () => {
        assert.fail("jq is not on PATH; the parity check is mandatory when CI is set");
      });
    } else {
      test(
        "parity with gs_strip_jsonc",
        { skip: "jq is not on PATH (required only under CI)" },
        () => {},
      );
    }
  } else {
    for (const [label, input] of CORPUS) {
      test(label, () => {
        assert.equal(stripJsonComments(input), shellStrip(input));
      });
    }
  }
});

describe("findDuplicateKey", () => {
  const cases: readonly (readonly [string, string, readonly string[] | null])[] = [
    ["distinct keys", '{"a":1,"b":{"a":2}}', null],
    ["the same key in sibling objects is not a duplicate", '{"x":{"a":1},"y":{"a":1}}', null],
    ["a string value equal to a key is not a key", '{"a":"a","b":["a","b"],"c":":"}', null],
    ["top-level duplicate", '{"a":1,"a":2}', ["a"]],
    [
      "duplicate at depth, array positions as decimal strings",
      '{"x":{"y":[{"k":1},{"k":1,"k":2}]}}',
      ["x", "y", "1", "k"],
    ],
    ["keys compare by decoded value", '{"a":1,"\\u0061":2}', ["a"]],
    ["whitespace around the colon", '{ "m" : 1 ,\n "m"\t:\n2 }', ["m"]],
    [
      "duplicate mcpServers declaration",
      '{"mcpServers":{"playwright":{},"acme":{},"playwright":{}}}',
      ["mcpServers", "playwright"],
    ],
  ];
  for (const [label, text, expected] of cases) {
    test(label, () => {
      JSON.parse(text); // precondition: text JSON.parse accepts
      assert.deepEqual(findDuplicateKey(text), expected);
    });
  }
});
