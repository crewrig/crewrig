// check-gemini-overlay-enrollment.test.ts — black-box edge cases of the TypeScript twin that
// the retired Bash suite for the overlay-enrollment guard did not cover (spec 0259).
//
// Each case writes a stand-in declaration printer and a settings.json under a throwaway
// repository and runs scripts/check-gemini-overlay-enrollment.ts with CREWRIG_REPO_DIR.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-gemini-overlay-enrollment.ts",
);
const roots: string[] = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function fixture(printerBody: string, settings: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-enroll-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "scripts", "tests", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "gemini"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "tests", "lib", "print-setup-declarations.ts"),
    printerBody,
  );
  fs.writeFileSync(
    path.join(root, "config", "gemini", "settings.json"),
    typeof settings === "string" ? settings : JSON.stringify(settings),
  );
  return root;
}

const printing = (doc: unknown): string =>
  `process.stdout.write(${JSON.stringify(JSON.stringify(doc))} + "\\n");\n`;

function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK], {
    env: { ...process.env, CREWRIG_REPO_DIR: root },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const FACTS = {
  facts: {
    "rules.shared.1": "a.md -> <HOME>/.gemini/00_SOUL.md",
    "rules.shared.2": "b.md -> <HOME>/.gemini/66_ORG_RULES.md (optional)",
  },
};

describe("check-gemini-overlay-enrollment.ts", () => {
  test("warnings are printed before failures, both on stderr, exit 1", () => {
    const r = run(
      fixture(printing(FACTS), {
        context: { fileName: ["00_SOUL.md", "AGENTS.md", "99_GHOST.md"] },
      }),
    );
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.indexOf("WARNING:") < r.stderr.indexOf("FAILED:"));
    assert.match(r.stderr, /WARNING: 1 overlay\(s\) enrolled .*\n {2}- 99_GHOST\.md\n/);
    assert.match(r.stderr, /FAILED: 1 deployed Gemini overlay\(s\).*\n {2}- 66_ORG_RULES\.md\n/);
  });

  test("the optional suffix is stripped and the OK line counts overlays", () => {
    const r = run(
      fixture(printing(FACTS), { context: { fileName: ["00_SOUL.md", "66_ORG_RULES.md"] } }),
    );
    assert.deepEqual(
      [r.status, r.stdout, r.stderr],
      [0, "OK: all 2 deployed Gemini overlays are enrolled in context.fileName.\n", ""],
    );
  });

  test("a declaration without a facts object exits 2 after naming the cause", () => {
    const r = run(fixture(printing({ cli: "gemini" }), { context: { fileName: [] } }));
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /^the declaration carries no facts object\nError: no deployed overlays found/,
    );
  });

  test("a declaration that is not JSON exits 2", () => {
    const r = run(fixture('process.stdout.write("not json\\n");\n', { context: { fileName: [] } }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no deployed overlays found/);
  });

  test("a non-string fileName entry is malformed settings, exit 2", () => {
    const r = run(fixture(printing(FACTS), { context: { fileName: ["00_SOUL.md", 3] } }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /could not read a well-formed context\.fileName list/);
  });

  test("the printer's own stderr passes through before the diagnostic", () => {
    const r = run(
      fixture('process.stderr.write("boom\\n"); process.exit(1);\n', { context: { fileName: [] } }),
    );
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /^boom\nError: the declaration printer produced no declaration for gemini \(/,
    );
  });

  test("a missing printer is reported as a missing source, exit 2", () => {
    const root = fixture("", { context: { fileName: [] } });
    fs.rmSync(path.join(root, "scripts", "tests", "lib", "print-setup-declarations.ts"));
    const r = run(root);
    assert.equal(r.status, 2);
    assert.equal(
      r.stderr,
      `Error: source not found: ${root}/scripts/tests/lib/print-setup-declarations.ts\n`,
    );
  });
});
