// Tests for quoteWord (spec 0256 requirement 19): the measured `printf %q`
// alphabet is pinned, every value round-trips through the reader, and the shell
// reads the word back identically.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseTlsEnv } from "../lib/tls-env.ts";
import { quoteWord } from "../lib/tls-env-quote.ts";
import {
  bashVariants,
  measureAll,
  PRINTABLE,
  shellQuote,
  type AlphabetTable,
} from "./lib/tls-quote-measure.ts";

const GOLDEN = path.join(
  import.meta.dirname,
  "fixtures",
  "setup-tls",
  "printf-q-alphabet.json.golden",
);
const posixOnly = { skip: process.platform === "win32" ? "needs bash" : false };
const BARE = "%+-./0123456789:=@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

function roundTrip(value: string): string | undefined {
  const parsed = parseTlsEnv(`export V=${quoteWord(value)}\n`);
  return "vars" in parsed ? parsed.vars["V"] : undefined;
}

function golden(): AlphabetTable {
  return JSON.parse(readFileSync(GOLDEN, "utf8")) as AlphabetTable;
}

test("the pinned table is the one measured: bare everywhere, `#` and `~` not first, a tilde escaped after `:` or `=`", () => {
  const table = golden();
  assert.equal(table.bare, BARE);
  assert.equal(table.bareNotFirst, "#~");
  assert.equal(table.tildeEscapedAfter, ":=");
  assert.equal(table.escaped, " !\"$&'()*,;<>?[\\]^`{|}");
  // the hypothesis `[A-Za-z0-9_@%+=:,./-]` is wrong on the comma, and `^` is escaped
  assert.ok(!table.bare.includes(",") && !table.bare.includes("^"));
  assert.equal(
    [...(table.bare + table.bareNotFirst + table.escaped)].sort().join(""),
    [...PRINTABLE.join("")].sort().join(""),
    "every printable character is in exactly one class",
  );
});

test("the measurement on this machine agrees with the pinned table", posixOnly, () => {
  const { measured } = measureAll();
  assert.ok(measured.length > 0);
  const table = golden();
  for (const m of measured) {
    const label = `${m.variant.bash} ${m.version} ${m.variant.locale}`;
    for (const c of table.bare) {
      for (const pos of [m.alone, m.lead, m.mid, m.trail]) assert.ok(pos.includes(c), label + c);
    }
    for (const c of table.bareNotFirst) {
      assert.ok(m.mid.includes(c) && m.trail.includes(c), `${label} ${c}`);
    }
    // what a bash leaves bare beyond the table is the Bash 3.2 tilde only
    for (const c of PRINTABLE) {
      const extra = [m.alone, m.lead].some((s) => s.includes(c)) && !table.bare.includes(c);
      if (extra) assert.equal(c, "~", label);
    }
    for (const c of table.tildeEscapedAfter) {
      if (!m.version.startsWith("3.")) assert.ok(m.tildeEscapedAfter.includes(c), label);
    }
    for (const c of table.escaped) {
      for (const pos of [m.alone, m.lead, m.mid, m.trail]) assert.ok(!pos.includes(c), label + c);
    }
  }
});

test("printable ASCII: bare for the alphabet, a backslash for the rest, `#` and `~` escaped first", () => {
  for (const c of BARE) assert.equal(quoteWord(c), c);
  for (const c of "#~") {
    assert.equal(quoteWord(c), `\\${c}`);
    assert.equal(quoteWord(`a${c}b`), `a${c}b`);
    assert.equal(quoteWord(`${c}a`), `\\${c}a`);
  }
  for (const c of golden().escaped) assert.equal(quoteWord(`a${c}`), `a\\${c}`);
  assert.equal(quoteWord("a:~b"), "a:\\~b");
  assert.equal(quoteWord("a=~b"), "a=\\~b");
  assert.equal(quoteWord("a/~b"), "a/~b");
  assert.equal(quoteWord("a,b^c"), "a\\,b\\^c");
});

test("the empty value is two single quotes; no word is otherwise single-quoted", () => {
  assert.equal(quoteWord(""), "''");
  for (const v of ["a b", "it's", "$HOME", "\\", "é", "\n", "a'b'c"]) {
    assert.ok(!/^'.*'$/.test(quoteWord(v)), v);
  }
});

test("control characters, newline and DEL are `$'...'` words of octal escapes", () => {
  assert.equal(quoteWord("\n"), "$'\\012'");
  assert.equal(quoteWord("a\tb"), "a$'\\011'b");
  assert.equal(quoteWord("\x7f"), "$'\\177'");
  assert.equal(quoteWord("\x01\x1f"), "$'\\001\\037'");
  assert.equal(quoteWord("é"), "$'\\303\\251'");
});

test("NUL and a lone surrogate are rejected", () => {
  assert.throws(() => quoteWord("a\0b"), /NUL/);
  assert.throws(() => quoteWord("\ud800"), /well-formed/);
});

test("values round-trip through the reader", () => {
  const values = [
    "/etc/ssl/cert.pem",
    "/path with spaces/ca bundle.pem",
    "/tmp/$HOME/`id`/$(x)",
    'it\'s "quoted"',
    "back\\slash\\\\double",
    "C:\\Users\\Jane Doe\\certs\\ca.pem",
    "D:\\a b\\c.pem",
    "#leading-hash",
    "~/leading-tilde",
    "x:~/y",
    "a=~",
    "/caf\u00e9/\u20ac/\u{1f510}.pem",
    `/${"d".repeat(4090)}`,
    "line1\nline2\r\n\ttab\x01\x7f",
    "$'already-ansi'",
    "'",
    "''",
    "a,b^c|d;e&f<g>h(i)j*k?l[m]n{o}p!q",
    "",
  ];
  for (const v of values) assert.equal(roundTrip(v), v, JSON.stringify(v.slice(0, 40)));
  for (const c of PRINTABLE) {
    for (const v of [c, `a${c}`, `${c}a`, `${c}${c}`, `:${c}`, `${c}~`]) {
      assert.equal(roundTrip(v), v, JSON.stringify(v));
    }
  }
});

test("a 4096-character path is one line", () => {
  const long = `/${"é".repeat(2000)}${"x".repeat(2000)}`;
  assert.equal(roundTrip(long), long);
  assert.ok(!quoteWord(long).includes("\n"));
});

test("the shell sources the file and reads the value back", posixOnly, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tls-quote-"));
  try {
    const values = [
      '/a b/$HOME/`x`/it\'s"q"\\z',
      "x:~/y",
      "~tilde",
      "#hash",
      "a,b^c",
      "caf\u00e9 \u20ac",
      "tab\there\nnewline",
      "C:\\Program Files\\ca.pem",
      "",
    ];
    for (const v of values) {
      const file = path.join(dir, "env.sh");
      writeFileSync(file, `export NODE_EXTRA_CA_CERTS=${quoteWord(v)}\n`);
      for (const variant of bashVariants()) {
        const run = spawnSync(
          variant.bash,
          ["-c", `. ${JSON.stringify(file)}; printf %s "$NODE_EXTRA_CA_CERTS"`],
          {
            env: { PATH: process.env["PATH"] ?? "", HOME: dir, LC_ALL: variant.locale },
            encoding: "buffer",
          },
        );
        assert.equal(run.status, 0);
        assert.equal(
          run.stdout.toString("utf8"),
          v,
          `${variant.bash} ${variant.locale} ${JSON.stringify(v)}`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("for printable ASCII the word equals `printf %q` of the same bash, bytes", posixOnly, () => {
  const words: string[] = [];
  for (const c of PRINTABLE) words.push(c, `${c}a`, `a${c}a`, `a${c}`, `/${c}`, `${c}${c}`);
  words.push("/etc/ssl/cert.pem", "/p a/ca (1).pem", "C:\\Users\\x y\\ca.pem", "a,b", "a^b");
  const variants = bashVariants();
  assert.ok(variants.length > 0);
  for (const variant of variants) {
    const quoted = shellQuote(variant, words);
    words.forEach((word, i) => {
      // Bash 3.2 leaves a tilde bare at the start and after `:`: sourced, it expands
      // to the home directory. quoteWord deliberately escapes it (Bash 5 does too).
      const bash32Tilde = /^~|[:=]~/.test(word);
      if (bash32Tilde && quoted[i] !== quoteWord(word)) {
        assert.equal(quoted[i], word, `${variant.bash} 3.2 tilde ${word}`);
        return;
      }
      assert.equal(
        quoteWord(word),
        quoted[i],
        `${variant.bash} ${variant.locale} ${JSON.stringify(word)}`,
      );
    });
  }
});
