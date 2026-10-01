// hook-config.test.ts — tests for scripts/lib/hook-config.ts (spec 0243 R23, v1-F4).
//
// The backup mirrors `backup_file` of scripts/lib/common.sh: owner-only whatever
// the target's mode, earlier backups narrowed, symlinks never followed or
// chmod-ed, same-second collisions probed with a capped `.NN` suffix.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  backupFile,
  type BackupResult,
  LossyJsonError,
  NotAJsonObjectError,
  readJsonConfig,
  readJsonObject,
  serialiseJson,
  writeJsonConfig,
} from "../lib/hook-config.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hook-config-")),
  );
  temps.push(dir);
  return dir;
}
const posix = process.platform !== "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
const NOW = new Date(2026, 8, 30, 12, 34, 56);
const STAMP = "20260930-123456";
const quiet = { now: NOW, warn: () => undefined };

describe("readJsonObject", () => {
  test("absent file → null; object → object", () => {
    const dir = tempDir();
    assert.equal(readJsonObject(path.join(dir, "none.json")), null);
    fs.writeFileSync(path.join(dir, "a.json"), '{"a":1}');
    assert.deepEqual(readJsonObject(path.join(dir, "a.json")), { a: 1 });
  });

  for (const text of ["[]", "3", "null", '"s"', "{oops"]) {
    test(`refuses ${text}`, () => {
      const file = path.join(tempDir(), "c.json");
      fs.writeFileSync(file, text);
      assert.throws(() => readJsonObject(file), NotAJsonObjectError);
    });
  }
});

describe("writeJsonConfig", () => {
  test(
    "two-space JSON with a trailing newline, mode 0600 (also over a 0644 file)",
    { skip: !posix },
    () => {
      const file = path.join(tempDir(), "c.json");
      fs.writeFileSync(file, "{}", { mode: 0o644 });
      fs.chmodSync(file, 0o644);
      writeJsonConfig(file, { a: [1], b: { c: true } });
      assert.equal(fs.readFileSync(file, "utf8"), serialiseJson({ a: [1], b: { c: true } }));
      assert.equal(
        fs.readFileSync(file, "utf8"),
        '{\n  "a": [\n    1\n  ],\n  "b": {\n    "c": true\n  }\n}\n',
      );
      assert.equal(mode(file), 0o600);
    },
  );

  test(
    "a failed write leaves the target byte-identical and no temporary file",
    { skip: !posix },
    () => {
      const dir = tempDir();
      const file = path.join(dir, "c.json");
      fs.writeFileSync(file, '{"keep":1}\n');
      const circular: Record<string, unknown> = {};
      circular["self"] = circular;
      assert.throws(() => writeJsonConfig(file, circular));
      assert.equal(fs.readFileSync(file, "utf8"), '{"keep":1}\n');
      assert.deepEqual(fs.readdirSync(dir), ["c.json"]);
    },
  );
});

function backupPath(result: BackupResult): string {
  assert.equal(result.status, "made");
  return result.status === "made" ? result.path : "";
}

describe("backupFile", () => {
  test("an unwritable directory reports failed, not absent", { skip: !posix || isRoot }, () => {
    const dir = tempDir();
    const file = path.join(dir, "c.json");
    fs.writeFileSync(file, "{}");
    fs.chmodSync(dir, 0o555);
    try {
      const warnings: string[] = [];
      assert.deepEqual(backupFile(file, { now: NOW, warn: (m) => warnings.push(m) }), {
        status: "failed",
      });
      assert.equal(warnings.length, 1);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  test("no target → no backup", () => {
    assert.deepEqual(backupFile(path.join(tempDir(), "none.json"), quiet), { status: "absent" });
  });

  test(
    "copies as <target>.bak.<YYYYMMDD-HHMMSS> at 0600 even from a 0644 source",
    { skip: !posix },
    () => {
      const file = path.join(tempDir(), "c.json");
      fs.writeFileSync(file, '{"token":"s3cret"}');
      fs.chmodSync(file, 0o644);
      const made = backupPath(backupFile(file, quiet));
      assert.equal(made, `${file}.bak.${STAMP}`);
      assert.equal(fs.readFileSync(made, "utf8"), '{"token":"s3cret"}');
      assert.equal(mode(made), 0o600);
    },
  );

  test("narrows every earlier regular <target>.bak.* file to 0600", { skip: !posix }, () => {
    const file = path.join(tempDir(), "c.json");
    fs.writeFileSync(file, "{}");
    const old = `${file}.bak.20200101-000000`;
    fs.writeFileSync(old, "{}");
    fs.chmodSync(old, 0o644);
    backupFile(file, quiet);
    assert.equal(mode(old), 0o600);
  });

  test("narrows earlier backups even when the target itself is gone", { skip: !posix }, () => {
    const file = path.join(tempDir(), "c.json");
    const old = `${file}.bak.20200101-000000`;
    fs.writeFileSync(old, "{}");
    fs.chmodSync(old, 0o644);
    assert.deepEqual(backupFile(file, quiet), { status: "absent" });
    assert.equal(mode(old), 0o600);
  });

  test("never chmods or follows a symlinked earlier backup", { skip: !posix }, () => {
    const dir = tempDir();
    const file = path.join(dir, "c.json");
    fs.writeFileSync(file, "{}");
    const victim = path.join(dir, "victim.txt");
    fs.writeFileSync(victim, "x");
    fs.chmodSync(victim, 0o644);
    fs.symlinkSync(victim, `${file}.bak.20200101-000000`);
    backupFile(file, quiet);
    assert.equal(mode(victim), 0o644);
  });

  test("a symlinked target is backed up as a symlink, never dereferenced", { skip: !posix }, () => {
    const dir = tempDir();
    const real = path.join(dir, "real.json");
    fs.writeFileSync(real, '{"real":1}');
    fs.chmodSync(real, 0o644);
    const link = path.join(dir, "c.json");
    fs.symlinkSync(real, link);
    const made = backupPath(backupFile(link, quiet));
    assert.ok(fs.lstatSync(made).isSymbolicLink());
    assert.equal(fs.readlinkSync(made), real);
    assert.equal(mode(real), 0o644);
  });

  test("a same-second collision probes .01, .02 … and never overwrites", { skip: !posix }, () => {
    const file = path.join(tempDir(), "c.json");
    fs.writeFileSync(file, "second");
    fs.writeFileSync(`${file}.bak.${STAMP}`, "first");
    assert.equal(backupPath(backupFile(file, quiet)), `${file}.bak.${STAMP}.01`);
    assert.equal(backupPath(backupFile(file, quiet)), `${file}.bak.${STAMP}.02`);
    assert.equal(fs.readFileSync(`${file}.bak.${STAMP}`, "utf8"), "first");
  });

  test("a dangling symlink occupying the name counts as taken", { skip: !posix }, () => {
    const file = path.join(tempDir(), "c.json");
    fs.writeFileSync(file, "{}");
    fs.symlinkSync("/nonexistent/target", `${file}.bak.${STAMP}`);
    assert.equal(backupPath(backupFile(file, quiet)), `${file}.bak.${STAMP}.01`);
  });

  test("after 99 collisions it warns and reports failed, not absent", { skip: !posix }, () => {
    const file = path.join(tempDir(), "c.json");
    fs.writeFileSync(file, "{}");
    fs.writeFileSync(`${file}.bak.${STAMP}`, "x");
    for (let n = 1; n <= 99; n++)
      fs.writeFileSync(`${file}.bak.${STAMP}.${String(n).padStart(2, "0")}`, "x");
    const warnings: string[] = [];
    assert.deepEqual(backupFile(file, { now: NOW, warn: (m) => warnings.push(m) }), {
      status: "failed",
    });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]?.includes("99 same-second collisions"));
  });
});

// spec 0245 R8, R12, R14 (PLAN v2 step 4; plan review v1-F4, v2-F1, v2-F4): the
// opt-in reader. Without options it is `readJsonObject`; `jsonc` reads the
// Gemini CLI dialect; `lossless` refuses input a rewrite would not reproduce.
describe("readJsonConfig", () => {
  function file(text: string): string {
    const f = path.join(tempDir(), "c.json");
    fs.writeFileSync(f, text);
    return f;
  }

  test("absent file → null, and readJsonObject still returns exactly null (v2-F1)", () => {
    const none = path.join(tempDir(), "none.json");
    assert.strictEqual(readJsonConfig(none), null);
    assert.strictEqual(readJsonConfig(none, { jsonc: true, lossless: true }), null);
    assert.strictEqual(readJsonObject(none), null);
  });

  test("plain JSON → { doc, comments: false }", () => {
    assert.deepEqual(readJsonConfig(file('{"a":{"b":[1,2]}}')), {
      doc: { a: { b: [1, 2] } },
      comments: false,
    });
  });

  test("without jsonc, a commented file is refused (the default stays plain JSON)", () => {
    const f = file('{"a":1} // c');
    assert.throws(() => readJsonConfig(f), NotAJsonObjectError);
    assert.throws(() => readJsonObject(f), NotAJsonObjectError);
  });

  test("jsonc: a commented file is read, comments: true", () => {
    const f = file('{\n  // theme\n  "ui": {"theme": "x"}, /* n */ "n": 1\n}\n');
    assert.deepEqual(readJsonConfig(f, { jsonc: true }), {
      doc: { ui: { theme: "x" }, n: 1 },
      comments: true,
    });
  });

  test("jsonc: // and /* inside strings are not comments (no spurious R12 warning)", () => {
    const f = file('{"url":"http://x/*y*/"}');
    assert.deepEqual(readJsonConfig(f, { jsonc: true }), {
      doc: { url: "http://x/*y*/" },
      comments: false,
    });
  });

  // v2-F4: `comments` is true only when a comment was actually removed.
  for (const [label, text, comments] of [
    ["zero-byte", "", false],
    ["whitespace-only", " \n\t\r\n ", false],
    ["comment-only", "// only a comment\n", true],
    ["whitespace and block comment", "\n /* a\n b */ \n", true],
  ] as const) {
    test(`jsonc: ${label} file → { doc: {}, comments: ${comments} }`, () => {
      assert.deepEqual(readJsonConfig(file(text), { jsonc: true }), { doc: {}, comments });
    });
  }

  for (const [label, text] of [
    ["a BOM", '\uFEFF{"a":1}'],
    ["1/**/2", "1/**/2"],
    ["invalid text after a comment", "// c\n{oops"],
    ["a non-object", "[] // c"],
  ] as const) {
    test(`jsonc: ${label} → NotAJsonObjectError`, () => {
      assert.throws(() => readJsonConfig(file(text), { jsonc: true }), NotAJsonObjectError);
    });
  }

  test("lossless: an ordinary configuration is accepted", () => {
    const text =
      '{"mcpServers":{"a":{"command":"x","args":["-y"],"n":[0,1,-3,2.5]}},"t":true,"z":null}';
    assert.deepEqual(readJsonConfig(file(text), { lossless: true })?.doc, JSON.parse(text));
  });

  for (const [label, text] of [
    ["a duplicate key", '{"mcpServers":{"playwright":{},"playwright":{"x":1}}}'],
    ["a duplicate key behind a comment (jsonc)", '{"a":1, // c\n "a":2}'],
    ["a number that loses precision", '{"n":12345678901234567890}'],
    ["a number that overflows", '{"n":1e400}'],
    ["an integer-like key JS would reorder", '{"b":1,"10":2}'],
  ] as const) {
    test(`lossless: ${label} → LossyJsonError naming the file`, () => {
      const f = file(text);
      assert.throws(
        () => readJsonConfig(f, { jsonc: true, lossless: true }),
        (error: unknown) => error instanceof LossyJsonError && error.message.includes(f),
      );
    });
  }

  test("lossless: array positions and non-canonical numeric keys are not integer-like keys", () => {
    const text = '{"a":[1,2,3],"01":1,"-1":2}';
    assert.deepEqual(readJsonConfig(file(text), { lossless: true })?.doc, JSON.parse(text));
  });

  test("without lossless, lossy input keeps readJsonObject's behaviour (opt-in guard)", () => {
    assert.deepEqual(readJsonObject(file('{"a":1,"a":2}')), { a: 2 });
    assert.deepEqual(readJsonConfig(file('{"a":1,"a":2}'))?.doc, { a: 2 });
    assert.deepEqual(readJsonConfig(file('{"b":1,"10":2,"n":1e400}'))?.doc, {
      b: 1,
      10: 2,
      n: Infinity,
    });
    assert.deepEqual(readJsonObject(file('{"10":2}')), { 10: 2 });
  });
});
