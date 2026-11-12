// check-skill-quality-contract.test.ts — spec 0293 R5, R17, R21, R22: the script contract of the
// skill linter (`--help`, `--json`, exit codes) and the run on this repository.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { ENTRY, REPO, parsed, root, roots, run } from "./lib/skill-quality-fixture.ts";

describe("the script contract (R5, R17)", () => {
  test("--help prints the usage on stdout and exits 0", () => {
    const res = run(root({}), ["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage: check-skill-quality\.ts/);
  });

  test("--json prints one {ok, data, findings} object on stdout and human text on stderr", () => {
    const res = run(root({ "evals/evals.json": "{not json" }), ["--json"]);
    const out = parsed(res.stdout);
    assert.equal(out.ok, false);
    assert.equal(res.status, 1);
    assert.ok((out.data?.errors ?? 0) >= 1);
    assert.ok(out.findings.every((f) => f.rule !== "" && f.message !== ""));
    assert.match(res.stderr, /ERROR/);
  });

  test("an unknown option and an unknown skill exit 2, with ok false and no data under --json", () => {
    for (const args of [["--bogus"], ["nope"]]) {
      const res = run(root({}), [...args, "--json"]);
      assert.equal(res.status, 2, args.join(" "));
      const out = parsed(res.stdout);
      assert.equal(out.ok, false);
      assert.equal(out.data, null);
      assert.equal(out.findings[0]?.rule, "usage");
    }
  });

  test("a repository root without artifacts/ exits 3 with a precondition finding", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "skill-quality-empty-"));
    roots.push(empty);
    const res = run(empty, ["--json"]);
    assert.equal(res.status, 3);
    assert.equal(parsed(res.stdout).findings[0]?.rule, "precondition");
  });

  test("a named skill is the only one checked", () => {
    const dir = root({});
    const res = run(dir, ["x", "--json"]);
    assert.equal(parsed(res.stdout).data?.skills.length, 1);
  });
});

describe("the repository (R21, R22)", () => {
  test("every skill that ships evals produces no error, and no skill produces an error that is not protected", () => {
    const res = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, "--json"],
      { encoding: "utf8", cwd: REPO },
    );
    const out = parsed(res.stdout);
    assert.equal(res.status, 0, res.stderr);
    const prLogbook = out.data?.skills.find((s) => s.name === "pr-logbook");
    assert.equal(prLogbook?.protected, true, "pr-logbook ships evals and is protected");
    assert.deepEqual(
      out.findings.filter((f) => f.severity === "error"),
      [],
    );
  });
});
