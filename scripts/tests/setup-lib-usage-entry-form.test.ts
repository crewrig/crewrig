// setup-lib-usage-entry-form.test.ts — the entry form of scripts/usage-capture-optin.ts, its silence on this
// Node.js, its refusals, and a run below the Node.js floor that leaves the file system unchanged (spec 0256
// requirement 33; spec 0255 R3). The per-subcommand differential runs are in setup-lib-usage-entry.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { fakeNodeFirst } from "./lib/shim-env.ts";
import { ENTRY, node } from "./lib/usage-entry-rig.ts";
import { checkout } from "./lib/usage-capture-rig.ts";
import { cleanupAll, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);
const SOURCE = fs.readFileSync(ENTRY, "utf8");

describe("entry form", () => {
  test("no module syntax at column 0, warning listeners removed first, import() inside", () => {
    const lines = SOURCE.split("\n");
    assert.deepEqual(
      lines.filter((l) =>
        /^(import|export|const|let|var|function|class|type|interface|async)\b/.test(l),
      ),
      [],
    );
    assert.equal(
      lines.find((l) => l.trim() !== "" && !l.startsWith("//")),
      'process.removeAllListeners("warning");',
    );
    const body = lines.filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(body.search(/\bimport\(/) > body.indexOf("removeAllListeners"));
    assert.doesNotMatch(body, /uncaughtException|process\.exit\(/);
    assert.match(body, /process\.exitCode\s*=/);
    assert.ok(lines.length - 1 <= 60, "a thin dispatcher");
    assert.match(
      lines.filter((l) => l.startsWith("//")).join("\n"),
      /node scripts\/lib\/node-floor-guard\.js/,
    );
  });

  test("no argument: nothing on standard error but the usage, status 2, no warning", () => {
    const res = node([]);
    assert.equal(res.status, 2);
    assert.doesNotMatch(res.stderr, /\(node:\d+\)|Warning/);
    assert.match(res.stderr, /^Usage: usage-capture-optin\.ts <subcommand>/);
    assert.equal(res.stdout, "");
  });

  test("an unknown subcommand and an unknown option are refused with status 2", () => {
    assert.equal(node(["nope"]).status, 2);
    const res = node(["state", "--bogus", "claude", "x"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /^Error: unknown option --bogus/);
  });

  test("an uncaught error is one `Error:` line and status 1", () => {
    const res = node([
      "render-session-recording-manifest",
      "claude",
      "/nonexistent",
      "/nonexistent",
      "/nonexistent/out",
    ]);
    assert.equal(res.status, 1);
    assert.match(res.stderr.trimEnd().split("\n").at(-1) ?? "", /^Error: /);
  });
});

describe("below the Node.js floor", { skip: SKIP_POSIX }, () => {
  for (const sub of ["enable", "fragment"] as const) {
    test(`${sub}: the guard's diagnostic, status 1, nothing written or created`, () => {
      const co = checkout();
      const cfg = path.join(realTmp("uc-floor-"), "settings.json");
      const before = fs.readdirSync(path.dirname(cfg));
      const args = sub === "enable" ? [sub, "claude", cfg, co] : [sub, "claude", co];
      const res = node(args, fakeNodeFirst());
      assert.equal(res.status, 1, res.stderr);
      assert.match(res.stderr, /Node\.js/);
      assert.equal(res.stdout, "");
      assert.deepEqual(fs.readdirSync(path.dirname(cfg)), before);
    });
  }
});
