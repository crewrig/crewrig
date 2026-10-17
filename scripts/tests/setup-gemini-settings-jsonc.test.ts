// setup-gemini-settings-jsonc.test.ts — groups G6, G7 and G12 of
// scripts/tests/test-setup-gemini-settings-merge.sh (spec 0263): repair of a file that is not a JSON
// object, the strict number grammar, commented files, and the size bounds of the comment-aware reader.
// Fixtures are bytes (`Buffer.from`) so no editor can normalise a BOM or a no-break space.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import {
  COMMENT_WARN,
  INVALID_WARN,
  MODE_SKIP,
  ORACLE_SEQ,
  TEMPLATE_FILES,
  caseWith,
  canon,
  docText,
  expectMode600,
  expectNoTmp,
  expectWarningBackup,
  freshDoc,
  gsWrite,
  readDoc,
  stdout,
} from "./lib/gemini-settings-rig.ts";

type Obj = Record<string, unknown>;

describe("G6 a file that is not a JSON object is repaired", () => {
  const files: [string, Buffer][] = [
    ["truncated object", Buffer.from('{"hooks":')],
    ["array", Buffer.from("[1, 2]\n")],
    ["string", Buffer.from('"s"\n')],
    ["null", Buffer.from("null\n")],
    ["number joined across a block comment", Buffer.from('{"a": 1/**/2}\n')],
    ["literal split by a block comment", Buffer.from('{"t": tr/* x */ue}\n')],
    [
      "leading UTF-8 BOM",
      Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{"ui": {"theme": "x"}}\n')]),
    ],
    ["lone no-break space", Buffer.from([0xc2, 0xa0])],
  ];
  for (const [label, bytes] of files) {
    test(`6 ${label}: replaced by the absent-file document, backup holds the prior bytes`, () => {
      const c = gsWrite(caseWith(bytes), "");
      assert.equal(c.rc, 0);
      assert.equal(docText(c), freshDoc(""));
      assert.ok(stdout(c).includes(`WARNING: ${c.target} ${INVALID_WARN}`), stdout(c));
      expectWarningBackup(c, INVALID_WARN, bytes);
      expectNoTmp(c);
      if (!MODE_SKIP) expectMode600(c);
    });
  }

  const rejected: [string, string][] = [
    ["leading-zero number", '{"ui": {"theme": "x"}, "retries": 01}'],
    ["Infinity literal", '{"ui": {"theme": "x"}, "limit": Infinity}'],
    ["nan literal", '{"ui": {"theme": "x"}, "limit": nan}'],
    ["plus-signed number", '{"ui": {"theme": "x"}, "retries": +1}'],
    ["leading-zero number after a comment", '{"ui": {"theme": "x"}, /* c */ "retries": 007}'],
  ];
  for (const [label, content] of rejected) {
    test(`6b ${label} is rejected like JSON.parse does`, () => {
      const c = gsWrite(caseWith(`${content}\n`), "");
      assert.equal(c.rc, 0);
      assert.equal(docText(c), freshDoc(""));
      assert.ok(stdout(c).includes(`WARNING: ${c.target} ${INVALID_WARN}`));
    });
  }

  const accepted: [string, string, unknown][] = [
    ["negative zero", '{"n": -0}', -0],
    ["upper-case exponent with sign", '{"n": 1E+2}', 100],
    ["fraction with negative exponent", '{"n": 0.5e-3}', 0.0005],
    [
      "number list after a comment",
      '/* c */ {"n": [0, -1.5, 10e2, true, false, null]}',
      [0, -1.5, 1000, true, false, null],
    ],
    [
      "rejected forms inside a string",
      '{"n": "01 +1 .5 Infinity NaN nan 0x1"}',
      "01 +1 .5 Infinity NaN nan 0x1",
    ],
  ];
  for (const [label, content, expected] of accepted) {
    test(`6c ${label} is merged, compared by value`, () => {
      const c = gsWrite(caseWith(`${content}\n`), "");
      assert.equal(c.rc, 0);
      assert.deepEqual(readDoc(c)["n"], expected);
      assert.ok(!stdout(c).includes(INVALID_WARN));
    });
  }
});

describe("G7 a commented file is merged; strings holding // and /* are intact", () => {
  const schema =
    "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json";
  const commented = `{
  // team proxy
  "$schema": "${schema}",
  /* a block
     comment */
  "ui": {"theme": "dark"}, /* inline */
  "notes": "has // and /* */ inside",
  "quote": "escaped \\" quote // x",
  "back": "back\\\\", // a comment right after an escaped backslash
  "proxy": "http://proxy.example:8080/*"
}
`;
  test("7a comments dropped with a warning and a backup, strings and $schema unchanged", () => {
    const c = gsWrite(caseWith(commented), "");
    assert.equal(c.rc, 0);
    const d = readDoc(c);
    assert.deepEqual(d["ui"], { theme: "dark" });
    assert.deepEqual(
      [d["notes"], d["quote"], d["back"], d["proxy"]],
      ["has // and /* */ inside", 'escaped " quote // x', "back\\", "http://proxy.example:8080/*"],
    );
    assert.equal(d["$schema"], schema);
    assert.deepEqual((d["context"] as Obj)["fileName"], TEMPLATE_FILES);
    assert.equal(canon((d["mcpServers"] as Obj)["sequentialthinking"]), canon(ORACLE_SEQ));
    assert.ok(stdout(c).includes(`WARNING: ${c.target} ${COMMENT_WARN}`));
    expectWarningBackup(c, COMMENT_WARN, commented);
    assert.ok(!stdout(c).includes(INVALID_WARN));
  });

  test("7b an unclosed block comment runs to the end of the file; 7c a plain re-run is quiet", () => {
    const c = gsWrite(caseWith('{"ui": {"theme": "x"}}\n/* never closed\n'), "");
    assert.equal(c.rc, 0);
    assert.deepEqual(readDoc(c)["ui"], { theme: "x" });
    assert.ok(stdout(c).includes(`WARNING: ${c.target} ${COMMENT_WARN}`));
    // 7c runs on the output of 7b: the template $schema URL holds `//` and is not a comment.
    c.out.length = 0;
    gsWrite(c, "");
    assert.equal(c.rc, 0);
    assert.ok(!stdout(c).includes(COMMENT_WARN), stdout(c));
  });
});

describe("G12 size bounds of the comment-aware reader", () => {
  const BOUND_MS = 5000;
  const entries = (n: number): string =>
    JSON.stringify(
      {
        hooks: {
          Notification: Array.from({ length: n }, (_, i) => ({
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `echo entry ${i} // not a comment /* nor this */ padding-padding-padding-padding`,
              },
            ],
          })),
        },
      },
      null,
      2,
    );
  const run = (text: string, floor: number): { c: ReturnType<typeof gsWrite>; ms: number } => {
    assert.ok(Buffer.byteLength(text) >= floor, `fixture too small: ${Buffer.byteLength(text)}`);
    const c = caseWith(text);
    const t0 = performance.now();
    gsWrite(c, "");
    return { c, ms: performance.now() - t0 };
  };
  const hooks = (c: ReturnType<typeof gsWrite>): { command: string }[] =>
    (readDoc(c)["hooks"] as { Notification: { hooks: { command: string }[] }[] }).Notification.map(
      (e) => e.hooks[0] ?? { command: "" },
    );

  test("12 a ~200 KB plain JSON file: 900 entries kept, no comment warning, under 5 s", () => {
    const { c, ms } = run(`${entries(900)}\n`, 190000);
    assert.equal(c.rc, 0);
    assert.ok(ms <= BOUND_MS, `took ${ms} ms`);
    assert.equal(hooks(c).length, 900);
    assert.ok(!stdout(c).includes(COMMENT_WARN));
  });

  test("12b a ~64 KB commented file: 280 entries, entry 7 intact, warning, under 5 s", () => {
    const text = `// operator notes\n${entries(280).replaceAll('"matcher"', '/* entry */ "matcher"')}\n`;
    const { c, ms } = run(text, 60000);
    assert.equal(c.rc, 0);
    assert.ok(ms <= BOUND_MS, `took ${ms} ms`);
    assert.equal(hooks(c).length, 280);
    assert.equal(
      hooks(c)[7]?.command,
      "echo entry 7 // not a comment /* nor this */ padding-padding-padding-padding",
    );
    assert.ok(stdout(c).includes(`WARNING: ${c.target} ${COMMENT_WARN}`));
  });

  test("12c a ~200 KB commented file: 900 entries, entry 899 intact, warning, under 5 s", () => {
    const lines = entries(900).split("\n");
    lines[1] = `/* generated */ ${lines[1] ?? ""}`;
    const body = lines.join("\n").replace('"Notification"', '/* event */ "Notification"');
    const text = `// operator notes: hooks generated by a local tool\n${body}\n/* end of file */\n`;
    const { c, ms } = run(text, 190000);
    assert.equal(c.rc, 0);
    assert.ok(ms <= BOUND_MS, `took ${ms} ms`);
    assert.equal(hooks(c).length, 900);
    assert.equal(
      hooks(c)[899]?.command,
      "echo entry 899 // not a comment /* nor this */ padding-padding-padding-padding",
    );
    assert.ok(stdout(c).includes(`WARNING: ${c.target} ${COMMENT_WARN}`));
  });
});
