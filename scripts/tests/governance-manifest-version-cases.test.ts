// governance-manifest-version-cases.test.ts — Replaces scripts/tests/test-check-extension-manifest-version.sh
// (cases 1, 2b; cases 2, 3, 4 stay in governance-check-extension-manifest-version.test.ts).
// Spec 0265 (row J2): black-box on scripts/check-extension-manifest-version.ts in a temp tree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-extension-manifest-version.ts");

/** extensions/core/hello with a package.json and the given sibling versions. */
function build(pkg: string, ext: string, gemini: string): string {
  const root = makeSandbox("manifest-version-");
  const dir = path.join(root, "extensions", "core", "hello");
  fs.mkdirSync(dir, { recursive: true });
  const write = (file: string, version: string): void =>
    fs.writeFileSync(path.join(dir, file), `{"name":"hello","version":"${version}"}\n`);
  write("package.json", pkg);
  write("extension.json", ext);
  write("gemini-extension.json", gemini);
  return root;
}

describe("check-extension-manifest-version.ts cases", () => {
  test("Case 1 — package.json and extension.json agree", () => {
    const r = runEntry(ENTRY, { cwd: build("0.1.0", "0.1.0", "0.1.0") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  // Pins a full-string compare: the first character (0) is shared, so a prefix-only comparison
  // would pass this divergence (Bash Case 2).
  test("Case 2 — divergent extension.json (0.1.0 vs 0.2.0) fails and names the extension", () => {
    const r = runEntry(ENTRY, { cwd: build("0.1.0", "0.2.0", "0.1.0") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /extension\.json/);
  });

  // The arm is gone (0044 delta-01 R8): a divergent gemini-extension.json is no longer this
  // guard's concern. The catching check is scripts/tests/extension-check.test.ts (VERSION-DRIFT
  // on the same fixture), which is what makes this exit-0 safe rather than silent.
  test("Case 2b — divergent gemini-extension.json no longer fails this guard", () => {
    const r = runEntry(ENTRY, { cwd: build("0.1.0", "0.1.0", "0.2.0") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

// Spec 0312 R5 (issue #2075): every skill/agent carrier of an extension agrees with the
// extension directory name (`extension`) and the package.json version (`version`).
const CAR = (fields: string): string =>
  `---\nname: x\n---\n<!-- crewrig-provenance: ${fields} canonical="https://github.com/crewrig/crewrig" feedback="https://github.com/crewrig/crewrig" -->\n\n# x\n`;

/** extensions/core/hello, package.json 1.2.3, one skill and one agent carrying `fields`. */
function withCarriers(fields: string, opts: { pkg?: boolean } = {}): string {
  const root = makeSandbox("manifest-carrier-");
  const dir = path.join(root, "extensions", "core", "hello");
  fs.mkdirSync(path.join(dir, "skills", "s"), { recursive: true });
  fs.mkdirSync(path.join(dir, "agents", "a"), { recursive: true });
  if (opts.pkg !== false)
    fs.writeFileSync(
      path.join(dir, "package.json"),
      '{"name":"hello-extension","version":"1.2.3"}\n',
    );
  fs.writeFileSync(path.join(dir, "skills", "s", "SKILL.md"), CAR(fields));
  fs.writeFileSync(path.join(dir, "agents", "a", "AGENT.md"), CAR(fields));
  return root;
}
const out = (r: { stdout: string; stderr: string }): string => r.stdout + r.stderr;

describe("check-extension-manifest-version.ts carrier lockstep (spec 0312 R5)", () => {
  test("agreeing carriers pass", () => {
    const r = runEntry(ENTRY, {
      cwd: withCarriers('extension="hello" version="1.2.3"'),
    });
    assert.equal(r.status, 0, out(r));
  });

  test("a divergent carrier version fails and names the file, field and both values", () => {
    const r = runEntry(ENTRY, {
      cwd: withCarriers('extension="hello" version="1.0.0"'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(
      out(r),
      /extensions\/core\/hello\/skills\/s\/SKILL\.md — version '1\.0\.0' != '1\.2\.3'/,
    );
    assert.match(
      out(r),
      /extensions\/core\/hello\/agents\/a\/AGENT\.md — version '1\.0\.0' != '1\.2\.3'/,
    );
  });

  test("a divergent carrier extension fails against the directory name, not package.json name", () => {
    const r = runEntry(ENTRY, {
      cwd: withCarriers('extension="other" version="1.2.3"'),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /SKILL\.md — extension 'other' != 'hello'/);
    // the package.json name (hello-extension) must not be the expected value
    const ok = runEntry(ENTRY, {
      cwd: withCarriers('extension="hello-extension" version="1.2.3"'),
    });
    assert.equal(ok.status, 1, out(ok));
  });

  test("a carrier with no version field fails and names the file", () => {
    const r = runEntry(ENTRY, { cwd: withCarriers('extension="hello"') });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /extensions\/core\/hello\/skills\/s\/SKILL\.md/);
    assert.match(out(r), /version/);
  });

  test("a carrier with no extension field fails and names the file", () => {
    const r = runEntry(ENTRY, { cwd: withCarriers('version="1.2.3"') });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /extensions\/core\/hello\/skills\/s\/SKILL\.md/);
    assert.match(out(r), /extension/);
  });

  test("a carrier in an extension directory with no package.json fails and names the file", () => {
    const r = runEntry(ENTRY, {
      cwd: withCarriers('extension="hello" version="1.2.3"', { pkg: false }),
    });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /extensions\/core\/hello\/skills\/s\/SKILL\.md/);
  });

  test("a file with no carrier is skipped here (R7 owns it)", () => {
    const root = withCarriers('extension="hello" version="1.2.3"');
    fs.writeFileSync(
      path.join(root, "extensions", "core", "hello", "skills", "s", "SKILL.md"),
      "---\nname: x\n---\n\n# no carrier\n",
    );
    const r = runEntry(ENTRY, { cwd: root });
    assert.equal(r.status, 0, out(r));
  });
});
