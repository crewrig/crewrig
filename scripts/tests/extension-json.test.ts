// extension-json.test.ts — the order-preserving reader and the `jq` writer (spec 0254 R12, 28(c), 28(d)).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { jqText, obj, quote, writeJsonCompact, writeJsonText } from "../lib/extension/json-write.ts";
import { ExtError } from "../lib/extension/types.ts";
import type { JsonValue } from "../lib/extension/types.ts";

const read = (text: string): JsonValue => parseJson(text, "t.json");
const keys = (value: JsonValue): string[] => (value instanceof Map ? [...value.keys()] : []);

describe("parseJson keeps the order jq keeps", () => {
  test("integer-like keys stay where they were written", () => {
    assert.deepEqual(keys(read('{"b":1,"2":2,"1":3}')), ["b", "2", "1"]);
  });

  test("a duplicate key takes the last value at the position of its first", () => {
    const value = read('{"a":1,"b":2,"a":3}');
    assert.deepEqual(keys(value), ["a", "b"]);
    assert.equal(value instanceof Map ? value.get("a") : undefined, 3);
  });

  test("__proto__ is an ordinary key", () => {
    const value = read('{"__proto__":{"x":1},"y":2}');
    assert.deepEqual(keys(value), ["__proto__", "y"]);
  });

  test("a byte-order mark and CRLF line endings are accepted", () => {
    assert.deepEqual(keys(read('﻿{\r\n"a": 1,\r\n"b": 2\r\n}\r\n')), ["a", "b"]);
  });

  test("escapes decode, a lone surrogate reads as U+FFFD", () => {
    assert.equal(read('"\\u00e9\\n\\/\\ud83d\\ude00"'), "é\n/😀");
    assert.equal(read('"\\ud800x"'), "�x");
    assert.equal(read('"\\udc00"'), "�");
  });

  test("scalars and nesting", () => {
    assert.deepEqual(read('[null,true,false,-0.5,1e3,"s",[],{}]'), [null, true, false, -0.5, 1000, "s", [], new Map()]);
  });
});

describe("parseJson rejects what jq rejects, naming the file", () => {
  for (const bad of ["", "{", '{"a":1,}', "[1 2]", '"a\nb"', "01", "1.", "tru", '{"a" 1}', "{} {}", "'a'"]) {
    test(JSON.stringify(bad), () => {
      assert.throws(
        () => read(bad),
        (error: unknown) => error instanceof ExtError && error.message.startsWith("t.json is not valid JSON"),
      );
    });
  }

  test("nesting beyond the bound is refused, not a stack overflow", () => {
    assert.throws(() => read("[".repeat(2000)), ExtError);
  });
});

describe("writeJsonText is jq's pretty form", () => {
  test("indentation, separators, empty containers, final line feed", () => {
    const value = read('{"a":[1,{"b":[]}],"c":{},"d":null}');
    assert.equal(
      writeJsonText(value),
      '{\n  "a": [\n    1,\n    {\n      "b": []\n    }\n  ],\n  "c": {},\n  "d": null\n}\n',
    );
    assert.equal(writeJsonText([]), "[]\n");
    assert.equal(writeJsonText(new Map()), "{}\n");
  });

  test("integer-like keys are written in the order read", () => {
    assert.equal(writeJsonText(read('{"10":1,"2":2}')), '{\n  "10": 1,\n  "2": 2\n}\n');
  });

  test("every escape class", () => {
    assert.equal(quote('"\\/\b\f\n\r\t'), '"\\"\\\\/\\b\\f\\n\\r\\t"');
    assert.equal(quote("\u0001\u001f\u007f"), '"\\u0001\\u001f\\u007f"');
    assert.equal(quote("é 😀"), '"é 😀"');
  });

  test("numbers", () => {
    assert.equal(writeJsonCompact([0, -0, 1, -1.5, 100, 1e21, 2 ** 53]), "[0,-0,1,-1.5,100,1e+21,9007199254740992]");
    assert.throws(() => writeJsonCompact(Number.POSITIVE_INFINITY));
  });

  test("the compact form has no spaces", () => {
    assert.equal(writeJsonCompact(read('{"a": [1, 2], "b": "x"}')), '{"a":[1,2],"b":"x"}');
  });

  test("a parsed document written back equals jq's output for the same text", () => {
    const text = '{"name":"x","list":[1,2,{"k":"v"}],"flag":true,"none":null}';
    assert.equal(writeJsonText(read(text)).replace(/\s+/g, ""), text);
  });
});

describe("jqText is the jq -r rule", () => {
  test("string, absent, null, number, boolean, container", () => {
    assert.equal(jqText("a b"), "a b");
    assert.equal(jqText("tail\n\n"), "tail");
    assert.equal(jqText(undefined), "null");
    assert.equal(jqText(null), "null");
    assert.equal(jqText(3), "3");
    assert.equal(jqText(false), "false");
    assert.equal(jqText(read('{"a":1}')), '{\n  "a": 1\n}');
  });
});

describe("obj", () => {
  test("keeps the order of the pairs and replaces a repeated key in place", () => {
    assert.deepEqual(keys(obj([["b", 1], ["a", 2], ["b", 3]])), ["b", "a"]);
  });
});
