// skill-scripts-gitlab-ci-legacy-flags.test.ts — the flags spec 0301 adds to the two legacy scripts
// (R8, R9, R10): `--help` and `--json` of check-pinned-images.ts and `--help` of
// check-secrets-exposure.ts, compared with golden files, from a copy of the built skill outside the
// repository. The unchanged behaviour is pinned by skill-scripts-gitlab-ci-baseline.test.ts.
// Regenerate the goldens deliberately with `UPDATE_GOLDEN=1`, then review the diff.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  envelope,
  run,
  copySkill,
  tempDir,
  type Run,
  type ScriptName,
} from "./lib/skill-scripts-gitlab-ci-cli.ts";

const GOLDEN = path.resolve(
  import.meta.dirname,
  "fixtures",
  "skill-scripts",
  "gitlab-ci-0301",
  "flags",
);
const root = tempDir("gitlab-ci-flags-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const skill = copySkill(root);
const work = path.join(root, "work");
const DIGEST = `@sha256:${"0123456789abcdef".repeat(4)}`;
const put = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
  fs.writeFileSync(path.join(work, rel), text);
};
put("ok.yml", `build:\n  image: node${DIGEST}\n`);
put("bad.yml", "build:\n  image: node:22\n  services:\n    - redis:7\n");
put("dir/.gitlab-ci.yml", `build:\n  image: node${DIGEST}\n`);
put("dir/.gitlab/a.yml", `build:\n  image: node${DIGEST}\n`);
put("dir/.gitlab/sub/b.yaml", `build:\n  image: node${DIGEST}\n`);
fs.mkdirSync(path.join(work, "empty"));

/** Replace the temporary directory so a golden is stable across runs. */
const norm = (text: string): string => text.split(work).join("{WORK}");

function golden(name: string, r: Run): void {
  const dir = path.join(GOLDEN, name);
  const got = new Map([
    ["status.golden", `${r.status}\n`],
    ["stdout.golden", norm(r.stdout)],
    ["stderr.golden", norm(r.stderr)],
  ]);
  if (process.env["UPDATE_GOLDEN"] === "1") {
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, c] of got) fs.writeFileSync(path.join(dir, f), c);
  }
  for (const [f, c] of got) {
    const file = path.join(dir, f);
    assert.ok(fs.existsSync(file), `${name}/${f}: no golden stored (UPDATE_GOLDEN=1 to create it)`);
    assert.equal(c, fs.readFileSync(file, "utf8"), `${name}/${f}`);
  }
}
const go = (script: ScriptName, args: string[]): Run => run(skill, script, args, { cwd: work });
const PINNED = "check-pinned-images" as const;

describe("check-pinned-images --help (R8)", () => {
  test("sole argument: usage on stdout, nothing on stderr, exit 0, golden", () => {
    const r = go(PINNED, ["--help"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.notEqual(r.stdout, "");
    golden("pinned-help", r);
  });
  test("it says the legacy exit codes are kept and that exit 3 is not used", () => {
    const r = go(PINNED, ["--help"]);
    assert.match(r.stdout, /legacy/i);
    assert.match(r.stdout, /exit 3|3/);
  });
});

describe("check-pinned-images --json (R8)", () => {
  test("all pinned: ok true, exit 0, no finding, files-scanned count 1, human text on stderr, golden", () => {
    const r = go(PINNED, ["ok.yml", "--json"]);
    assert.equal(r.status, 0);
    const env = envelope(r);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    assert.equal(env.data?.["files"], 1);
    golden("pinned-json-all-pinned", r);
  });
  test("unpinned references: exit 1, ok false, a finding per reference, golden", () => {
    const r = go(PINNED, ["bad.yml", "--json"]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.findings.length, 2);
    assert.equal(env.data?.["files"], 1);
    assert.match(r.stderr, /node:22/);
    golden("pinned-json-unpinned", r);
  });
  test("the flag may precede the target, same output", () => {
    const a = go(PINNED, ["bad.yml", "--json"]);
    const b = go(PINNED, ["--json", "bad.yml"]);
    assert.deepEqual(b, a);
  });
  test("directory: the files-scanned count is the number of files read, golden", () => {
    const r = go(PINNED, ["dir", "--json"]);
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.["files"], 3);
    golden("pinned-json-directory", r);
  });
  test("empty directory: exit 0 and files 0, so the empty scan is visible, golden", () => {
    const r = go(PINNED, ["empty", "--json"]);
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.["files"], 0);
    golden("pinned-json-empty-dir", r);
  });
  test("missing target: legacy exit 1 (not 3), precondition finding, ok false, golden", () => {
    const r = go(PINNED, ["missing.yml", "--json"]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.findings[0]?.rule, "precondition");
    assert.match(env.findings[0]?.message ?? "", /missing\.yml/);
    golden("pinned-json-missing-target", r);
  });
  test("missing target without --json: unchanged exit 1 and message", () => {
    const r = go(PINNED, ["missing.yml"]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr + r.stdout, "[FAIL] not a file or directory: missing.yml\n");
  });
  for (const [title, args, name] of [
    ["--json alone", ["--json"], "pinned-json-usage-alone"],
    ["two targets", ["ok.yml", "bad.yml", "--json"], "pinned-json-usage-two-targets"],
    ["repeated flag", ["--json", "--json"], "pinned-json-usage-repeated"],
  ] as [string, string[], string][])
    test(`usage error (${title}) under --json: exit 2, rule usage, ok false, golden`, () => {
      const r = go(PINNED, args);
      assert.equal(r.status, 2);
      const env = envelope(r);
      assert.equal(env.ok, false);
      assert.equal(env.findings[0]?.rule, "usage");
      golden(name, r);
    });
});

describe("check-secrets-exposure --help (R9)", () => {
  test("sole argument: usage on stdout, nothing on stderr, exit 0, golden", () => {
    const r = go("check-secrets-exposure", ["--help"]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.notEqual(r.stdout, "");
    golden("secrets-help", r);
  });
  test("it does not gain --json: the flag next to a target stays a usage error (legacy)", () => {
    const r = go("check-secrets-exposure", ["--json", "ok.yml"]);
    assert.equal(r.status, 2);
    assert.doesNotMatch(r.stdout, /"ok"/);
  });
  test("its help does not advertise --json", () => {
    assert.doesNotMatch(go("check-secrets-exposure", ["--help"]).stdout, /--json/);
  });
});
