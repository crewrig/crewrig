// skill-scripts-security-dep-audit-spawn.test.ts — dep-audit.ts when the tool cannot be started and
// when --timeout is out of range (spec 0303 R10, review finding i1-F1 and i1-F2). A failed spawn has
// no pid, and signalling process group 0 would kill the caller's own group: the script must degrade to
// exit 3 with cause tool-missing instead of dying. No network, from a copy of the skill outside the repo.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { copySkill, envelope, run, tempDir, toolStubs } from "./lib/skill-scripts-security-cli.ts";

const root = tempDir("security-dep-audit-spawn-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const skill = copySkill(root);
const tools = toolStubs(root);

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(root, "project-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
function binWith(name: string, text: string, mode: number): string {
  const bin = fs.mkdtempSync(path.join(root, "bin-"));
  fs.writeFileSync(path.join(bin, name), text, { mode });
  return bin;
}
const NPM_LOCK = {
  "package-lock.json": '{"lockfileVersion":3,"packages":{}}\n',
  "package.json": "{}",
};
const PIP_FILE = { "requirements.txt": "idna==3.6\n" };

describe("a tool that cannot be started", () => {
  for (const [name, tool, files, text, mode] of [
    ["a non-executable npm", "npm", NPM_LOCK, "#!/bin/sh\nexit 0\n", 0o644],
    [
      "a pip-audit whose interpreter is missing",
      "pip-audit",
      PIP_FILE,
      "#!/nonexistent/python\n",
      0o755,
    ],
  ] as [string, string, Record<string, string>, string, number][])
    test(`${name}: exit 3, cause tool-missing, the script survives`, () => {
      const r = run(skill, "dep-audit", ["--root", project(files), "--json"], {
        cwd: root,
        env: { PATH: binWith(tool, text, mode) },
      });
      assert.equal(r.status, 3, `${r.stdout}${r.stderr}`);
      const e = envelope(r);
      assert.equal(e.ok, false);
      assert.equal(e.findings[0]?.rule, "precondition");
      assert.equal(e.findings[0]?.cause, "tool-missing");
      assert.match(e.findings[0]?.message ?? "", /found but cannot be started/);
      assert.doesNotMatch(e.findings[0]?.message ?? "", /not found on PATH/);
    });
});

describe("--timeout range", () => {
  for (const value of ["2147484", "99999999", "1e12", "Infinity", "0.5", "1.5", "-1"])
    test(`--timeout ${value} is a usage error, not an immediate timeout`, () => {
      const r = run(skill, "dep-audit", ["--root", project({}), "--timeout", value], { cwd: root });
      assert.equal(r.status, 2, r.stdout);
      assert.match(r.stderr, /usage/);
    });
  test("the largest accepted value is 2147483 seconds", () => {
    const r = run(skill, "dep-audit", ["--root", project({}), "--timeout", "2147483"], {
      cwd: root,
    });
    assert.equal(r.status, 0, r.stderr);
  });
});

describe("a skipped pip dependency", () => {
  function replayDir(stdout: string, status: number): Record<string, string> {
    const dir = fs.mkdtempSync(path.join(root, "replay-"));
    fs.writeFileSync(path.join(dir, "stdout"), stdout);
    fs.writeFileSync(path.join(dir, "stderr"), "");
    fs.writeFileSync(path.join(dir, "status"), `${status}\n`);
    return tools.replay({ pip: dir });
  }
  const skipped = (name: string): object => ({ name, skip_reason: "not found on PyPI" });
  const vulnerable = {
    name: "idna",
    version: "3.6",
    vulns: [{ id: "PYSEC-1", fix_versions: ["3.7"], aliases: [], description: "d" }],
  };
  test("two skipped pins are named in a readable sentence and the ecosystem is not-audited", () => {
    const out = JSON.stringify({ dependencies: [skipped("acme-a"), skipped("acme-b")], fixes: [] });
    const r = run(skill, "dep-audit", ["--root", project(PIP_FILE), "--json"], {
      cwd: root,
      env: replayDir(out, 0),
    });
    assert.equal(r.status, 3);
    const message = envelope(r).findings[0]?.message ?? "";
    assert.match(message, /the tool skipped acme-a, acme-b /);
  });
  test("with an advisory in the same run the exit is 1 and the skipped pin is a warning", () => {
    const out = JSON.stringify({ dependencies: [skipped("acme-a"), vulnerable], fixes: [] });
    const r = run(skill, "dep-audit", ["--root", project(PIP_FILE), "--json"], {
      cwd: root,
      env: replayDir(out, 1),
    });
    assert.equal(r.status, 1);
    const found = envelope(r).findings;
    assert.deepEqual(
      found.map((f) => [f.rule, f.severity ?? "error"]),
      [
        ["vulnerable-dependency", "error"],
        ["precondition", "warning"],
      ],
    );
    assert.match(found[1]?.message ?? "", /skipped acme-a/);
  });
});
