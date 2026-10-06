// mempalace-transcript-fields.test.ts — payload field reading and the
// byte-bounded cuts of the transcript hook (spec 0247 R8, R12), and
// `firstChars`, the `${v:0:n}` of a UTF-8 locale (R9 room, R10 model response).
//
// Unit tests over scripts/lib/mempalace-transcript/fields.ts, plus one
// black-box run proving the 4000-byte content bound against the stub daemon.

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  firstChars,
  readField,
  renderSelected,
  selectAlt,
  utf8Cut,
  valueAt,
} from "../lib/mempalace-transcript/fields.ts";
import {
  daemonEnv,
  drawerArgs,
  makeHome,
  runHook,
  startStub,
  writeToken,
  type Stub,
} from "./lib/transcript-runtime.ts";
import { cleanupAll } from "./lib/worktree-fixtures.ts";

describe("jq's `//` selection (R8)", () => {
  test("absent, null and false are skipped; the first other value is selected", () => {
    assert.equal(selectAlt({ b: "x" }, [["a"], ["b"]]), "x");
    assert.equal(selectAlt({ a: null, b: "x" }, [["a"], ["b"]]), "x");
    assert.equal(selectAlt({ a: false, b: "x" }, [["a"], ["b"]]), "x");
    assert.equal(selectAlt({ a: false }, [["a"]]), undefined);
  });

  test("an empty string, 0, true, an object and an array ARE selected", () => {
    for (const value of ["", 0, true, {}, []]) {
      assert.deepEqual(selectAlt({ a: value, b: "x" }, [["a"], ["b"]]), value);
    }
  });

  test("paths index objects by key and arrays by position; anything else is absent", () => {
    const payload = { w: ["/p0", "/p1"], t: { c: "cmd" }, s: "str", n: null };
    assert.equal(valueAt(payload, ["w", 0]), "/p0");
    assert.equal(valueAt(payload, ["w", 5]), undefined);
    assert.equal(valueAt(payload, ["t", "c"]), "cmd");
    assert.equal(valueAt(payload, ["s", "c"]), undefined);
    assert.equal(valueAt(payload, ["n", "c"]), undefined);
    assert.equal(valueAt(payload, ["t", 0]), undefined);
    assert.equal(valueAt(payload, ["w", "0"]), undefined);
  });
});

describe("rendering the selected value (R8)", () => {
  test("a non-empty string is used as is", () => {
    assert.equal(renderSelected("text"), "text");
    assert.equal(renderSelected("  spaced  "), "  spaced  ");
  });

  test("a number is rendered in its JSON decimal form", () => {
    assert.equal(renderSelected(42), "42");
    assert.equal(renderSelected(-3.5), "-3.5");
    assert.equal(renderSelected(0), "0");
    assert.equal(renderSelected(1e21), "1e+21");
  });

  test("an empty string, an object, an array and true count as absent", () => {
    for (const value of ["", {}, { a: 1 }, [], ["x"], true, undefined, null]) {
      assert.equal(renderSelected(value), undefined, JSON.stringify(value));
    }
  });

  test("trailing line feeds are dropped as `$(…)` drops them; a text of line feeds only is absent", () => {
    assert.equal(renderSelected("a\n\n"), "a");
    assert.equal(renderSelected("a\nb\n"), "a\nb");
    assert.equal(renderSelected("\n\n"), undefined);
    assert.equal(renderSelected("a\r\n"), "a\r");
  });

  test("readField: an empty string selected first hides a later candidate", () => {
    assert.equal(readField({ a: "", b: "x" }, ["a"], ["b"]), undefined);
    assert.equal(readField({ a: {}, b: "x" }, ["a"], ["b"]), undefined);
    assert.equal(readField({ a: null, b: 7 }, ["a"], ["b"]), "7");
    assert.equal(readField("not an object", ["a"]), undefined);
  });
});

describe("firstChars: Bash's `${v:0:n}` in a UTF-8 locale", () => {
  test("counts code points, not UTF-16 units or bytes", () => {
    assert.equal(firstChars("abcdefghij", 8), "abcdefgh");
    assert.equal(firstChars("éééééééééé", 8), "éééééééé");
    assert.equal(firstChars("😀😀😀😀😀😀😀😀😀", 8), "😀".repeat(8));
    assert.equal(firstChars("ééééé", 3), "ée");
  });

  test("a shorter text is returned whole; zero gives the empty text", () => {
    assert.equal(firstChars("abc", 8), "abc");
    assert.equal(firstChars("", 8), "");
    assert.equal(firstChars("abc", 0), "");
  });
});

/** Every character width, every offset: the cut is the longest whole-character prefix within the bound. */
describe("utf8Cut: at most N bytes, on a character boundary (R12)", () => {
  const samples = ["a", "é", "€", "😀"];

  test("a text within the bound is unchanged", () => {
    assert.equal(utf8Cut("héllo", 6), "héllo");
    assert.equal(utf8Cut("", 0), "");
  });

  for (const ch of samples) {
    test(`${Buffer.byteLength(ch)}-byte characters, every bound from 0 to 13`, () => {
      const text = `x${ch.repeat(4)}`;
      for (let max = 0; max <= 13; max += 1) {
        const cut = utf8Cut(text, max);
        const bytes = Buffer.byteLength(cut);
        assert.ok(bytes <= max, `${max}: ${bytes} bytes`);
        assert.ok(text.startsWith(cut), `${max}: a prefix`);
        assert.doesNotMatch(cut, /�/, `${max}: no replacement character`);
        const next = [...text.slice(cut.length)][0];
        if (next !== undefined) assert.ok(bytes + Buffer.byteLength(next) > max, `${max}: maximal`);
      }
    });
  }

  test("a mixed text cut at 500 bytes", () => {
    const text = "aé€😀".repeat(100);
    const cut = utf8Cut(text, 500);
    assert.ok(Buffer.byteLength(cut) <= 500 && Buffer.byteLength(cut) > 496);
    assert.ok(text.startsWith(cut));
  });
});

describe("the content sent is at most 4000 bytes, cut on a boundary (R12)", () => {
  let stub: Stub;
  let home: string;
  let token: string;
  before(async () => {
    stub = await startStub("ok");
    home = makeHome();
    token = writeToken(path.join(home, "t"));
  });
  after(async () => {
    await stub.stop();
    cleanupAll();
  });

  for (const ch of ["a", "é", "€", "😀"]) {
    test(`a prompt of ${Buffer.byteLength(ch)}-byte characters`, () => {
      const prompt = ch.repeat(5000);
      const res = runHook(["claude-code"], JSON.stringify({ prompt, cwd: "/w/p" }), {
        env: daemonEnv(home, stub.port, token),
      });
      assert.equal(res.status, 0, res.stderr);
      const content = String(drawerArgs(stub.requests().at(-1)!)["content"]);
      const bytes = Buffer.byteLength(content);
      assert.ok(bytes <= 4000 && bytes > 4000 - Buffer.byteLength(ch), `${bytes} bytes`);
      assert.ok(`[USER] ${prompt}`.startsWith(content));
      assert.doesNotMatch(content, /�/);
    });
  }
});
