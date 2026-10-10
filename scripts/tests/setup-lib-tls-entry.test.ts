// setup-lib-tls-entry.test.ts — scripts/tls-delegation.ts, the node entry the function shims of
// scripts/lib/tls-delegation.sh call (spec 0256 requirement 33 as modified by delta-01): the entry form
// (spec 0255 R3), `detect` and `candidate` (exit codes and output) and the argument errors, each run as
// a child process in a throwaway HOME. `offer` is in setup-lib-tls-entry-offer.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { ENTRY, box, hostAnchors, hostBundle, run } from "./lib/tls-entry-run.ts";

/** A file's code, without its full-line comments (which may name `import()`). */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

describe("entry form", () => {
  const text = fs.readFileSync(ENTRY, "utf8");
  const lines = text.split("\n");

  test("no module syntax or global declaration at column 0", () => {
    const offending = lines.filter((line) =>
      /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
        line,
      ),
    );
    assert.deepEqual(offending, []);
  });

  test("the first statement removes the warning listeners, before the first import()", () => {
    const first = lines.find((line) => line.trim() !== "" && !line.startsWith("//"));
    assert.equal(first, 'process.removeAllListeners("warning");');
    const body = code(text);
    assert.ok(body.search(/\bimport\(/) > body.indexOf('process.removeAllListeners("warning")'));
    assert.doesNotMatch(body, /uncaughtException/);
    assert.doesNotMatch(body, /process\.exit\(/);
    assert.match(body, /process\.exitCode\s*=/);
    assert.match(
      lines.filter((line) => line.startsWith("//")).join("\n"),
      /node scripts\/lib\/node-floor-guard\.js/,
    );
  });

  test("detect loads no more than the detection module", () => {
    const body = code(text);
    const detect = body.slice(
      body.indexOf('command === "detect"'),
      body.indexOf('command !== "offer"'),
    );
    assert.deepEqual(detect.match(/import\("[^"]+"\)/g), ['import("./lib/setup/tls-detect.ts")']);
  });
});

describe("detect", () => {
  test("is silent and exits 1 when nothing signals a custom context", { skip: hostAnchors }, () => {
    const res = run(box(), ["detect"]);
    assert.deepEqual(res, { status: 1, stdout: "", stderr: "" });
  });

  for (const name of [
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "HTTPS_PROXY",
    "UV_NATIVE_TLS",
    "TLS_DELEGATION_CA",
  ]) {
    test(`exits 0 and prints nothing when ${name} is set`, () => {
      const res = run(box(), ["detect"], { [name]: "x" });
      assert.deepEqual(res, { status: 0, stdout: "", stderr: "" });
    });
  }

  test("an empty variable is not a signal", { skip: hostAnchors }, () => {
    assert.equal(run(box(), ["detect"], { HTTPS_PROXY: "" }).status, 1);
  });

  test("takes no argument", () => {
    const res = run(box(), ["detect", "extra"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /^Error: detect takes no argument; usage: /);
  });
});

describe("candidate", () => {
  test("prints the bundle a variable names and exits 0", () => {
    const b = box();
    const res = run(b, ["candidate"], { CREWRIG_TLS_CA: b.ca });
    assert.deepEqual(res, { status: 0, stdout: `${b.ca}\n`, stderr: "" });
  });

  test("the shell's order: the user's own variable wins over the override", () => {
    const b = box();
    const other = path.join(b.root, "own.pem");
    fs.writeFileSync(other, "x");
    const res = run(b, ["candidate"], { CREWRIG_TLS_CA: b.ca, SSL_CERT_FILE: other });
    assert.equal(res.stdout, `${other}\n`);
  });

  test("a variable naming no file is skipped: the OS bundle, or nothing with exit 1", () => {
    const b = box();
    const res = run(b, ["candidate"], { SSL_CERT_FILE: path.join(b.root, "absent.pem") });
    assert.equal(res.stderr, "");
    if (hostBundle) {
      assert.equal(res.status, 0);
      assert.match(res.stdout, /^\/etc\/(ssl|pki)\/\S+\n$/);
    } else {
      assert.deepEqual([res.status, res.stdout], [1, ""]);
    }
  });
});

describe("argument errors", () => {
  const cases: ReadonlyArray<[string, readonly string[], RegExp]> = [
    ["no subcommand", [], /^Error: usage: tls-delegation\.ts detect \| candidate \| offer/],
    ["an unknown subcommand", ["bogus"], /^Error: usage: tls-delegation\.ts /],
    ["candidate with an argument", ["candidate", "x"], /^Error: candidate takes no argument/],
    ["an unknown flag", ["offer", "--bad"], /^Error: unknown argument '--bad'$/m],
    ["--result without a value", ["offer", "--result"], /^Error: --result expects a value$/m],
    [
      "--result given twice",
      ["offer", "--result", "a", "--result", "b"],
      /^Error: --result given twice$/m,
    ],
    ["an unknown answer id", ["offer", "--answer", "nope=yes"], /unknown question id 'nope'/],
    [
      "a malformed answer",
      ["offer", "--answer", "tls-delegation"],
      /--answer expects <id>=<value>/,
    ],
    [
      "an invalid answer value",
      ["offer", "--answer", "tls-delegation=maybe"],
      /'maybe' is not one of: no, yes/,
    ],
    [
      "another question's answer",
      ["offer", "--answer", "rules-action=keep"],
      /only asks 'tls-delegation'/,
    ],
  ];
  for (const [name, args, pattern] of cases) {
    test(`${name}: one Error line on standard error, status 2, nothing written`, () => {
      const b = box();
      const res = run(b, args, { TLS_DELEGATION: "on", CREWRIG_TLS_CA: b.ca });
      assert.equal(res.status, 2);
      assert.equal(res.stdout, "");
      assert.match(res.stderr, pattern);
      assert.equal(res.stderr.trimEnd().split("\n").length, 1);
      assert.equal(fs.existsSync(path.join(b.home, ".crewrig")), false);
    });
  }

  test("a control character of an argument is shown as \\xNN", () => {
    const res = run(box(), ["offer", "--bad\u0007"]);
    assert.equal(res.stderr, "Error: unknown argument '--bad\\x07'\n");
  });
});
