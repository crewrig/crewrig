// json-ordered.ts — an order-preserving JSON reader (spec 0254 R12).
//
// `JSON.parse` builds ordinary objects, which list integer-like keys first in
// ascending order (`{"b":1,"2":2,"1":3}` reads back as `1, 2, b`) and read `__proto__`
// specially, so a manifest written back through it would not be what `jq` wrote. This
// reader returns objects as `Map`s: every string key, integer-like ones included,
// keeps the position it was first written at, and a duplicate key takes the last
// value at the position of its first, which is `jq`'s rule.
//
// Reads what `jq` reads and rejects what it rejects: strict JSON, with a leading
// UTF-8 byte-order mark and CRLF line endings accepted (R21). A lone surrogate escape
// reads as U+FFFD, as `jq` does. A failure is an `ExtError` naming the file, where
// `jq` printed its own parse error (listed deviation 28(c)).

import { ExtError } from "./types.ts";
import type { JsonValue } from "./types.ts";

const BOM = "﻿";
/** `jq` refuses deeper nesting than this reader follows; the figure only bounds recursion. */
const MAX_DEPTH = 512;

class Reader {
  private pos = 0;

  private readonly text: string;
  private readonly file: string;

  constructor(text: string, file: string) {
    this.text = text;
    this.file = file;
  }

  fail(detail: string): never {
    throw new ExtError(`${this.file} is not valid JSON: ${detail} (offset ${this.pos})`);
  }

  private skipWhitespace(): void {
    for (;;) {
      const ch = this.text.charCodeAt(this.pos);
      if (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09) this.pos++;
      else return;
    }
  }

  readDocument(): JsonValue {
    this.skipWhitespace();
    const value = this.readValue(0);
    this.skipWhitespace();
    if (this.pos < this.text.length) this.fail("unexpected content after the value");
    return value;
  }

  private readValue(depth: number): JsonValue {
    if (depth > MAX_DEPTH) this.fail("nesting too deep");
    const ch = this.text[this.pos];
    if (ch === "{") return this.readObject(depth);
    if (ch === "[") return this.readArray(depth);
    if (ch === '"') return this.readString();
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) return this.readNumber();
    return this.readLiteral();
  }

  private readLiteral(): JsonValue {
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return value;
      }
    }
    return this.fail("unexpected token");
  }

  private readNumber(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.text.slice(this.pos, this.pos + 400),
    );
    if (match === null) return this.fail("invalid number");
    this.pos += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.fail("number out of range");
    return value;
  }

  private readString(): string {
    this.pos++; // opening quote
    let out = "";
    for (;;) {
      const ch = this.text[this.pos];
      if (ch === undefined) return this.fail("unterminated string");
      const code = ch.charCodeAt(0);
      if (ch === '"') {
        this.pos++;
        return out;
      }
      if (code < 0x20) return this.fail("control character in string");
      if (ch !== "\\") {
        out += ch;
        this.pos++;
        continue;
      }
      out += this.readEscape();
    }
  }

  private readEscape(): string {
    const esc = this.text[this.pos + 1];
    const simple: Readonly<Record<string, string>> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (esc !== undefined && esc in simple) {
      this.pos += 2;
      return simple[esc] ?? "";
    }
    if (esc !== "u") return this.fail("invalid escape");
    const high = this.readHex4(this.pos + 2);
    this.pos += 6;
    if (high >= 0xd800 && high <= 0xdbff) {
      if (this.text[this.pos] === "\\" && this.text[this.pos + 1] === "u") {
        const low = this.readHex4(this.pos + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          this.pos += 6;
          return String.fromCharCode(high, low);
        }
      }
      return "�";
    }
    if (high >= 0xdc00 && high <= 0xdfff) return "�";
    return String.fromCharCode(high);
  }

  private readHex4(at: number): number {
    const digits = this.text.slice(at, at + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) return this.fail("invalid \\u escape");
    return Number.parseInt(digits, 16);
  }

  private readArray(depth: number): JsonValue[] {
    this.pos++;
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return items;
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.readValue(depth + 1));
      this.skipWhitespace();
      const ch = this.text[this.pos++];
      if (ch === "]") return items;
      if (ch !== ",") return this.fail("expected ',' or ']'");
    }
  }

  private readObject(depth: number): Map<string, JsonValue> {
    this.pos++;
    const map = new Map<string, JsonValue>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return map;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') return this.fail("expected a string key");
      const key = this.readString();
      this.skipWhitespace();
      if (this.text[this.pos++] !== ":") return this.fail("expected ':'");
      this.skipWhitespace();
      map.set(key, this.readValue(depth + 1));
      this.skipWhitespace();
      const ch = this.text[this.pos++];
      if (ch === "}") return map;
      if (ch !== ",") return this.fail("expected ',' or '}'");
    }
  }
}

/** Parse `text`, naming `file` in the error. Accepts a leading byte-order mark and CRLF. */
export function parseJson(text: string, file: string): JsonValue {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  return new Reader(body, file).readDocument();
}
