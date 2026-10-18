// monorepo-release-engine-templates.test.ts — case 11f of the real-engine release suite: the
// vendored GitLab templates, with their documented substitutions mapped BACK, equal the installed
// gitmoji originals. Replaces scripts/tests/test-monorepo-release-engine.sh (11f; spec 0265 row J2).
// An engine upgrade that changes either template fails here, not silently at runtime. Substitutions
// are plain-string replacements (the hbs syntax itself contains `#`, `{{` and `.`), never a regex.
// Runs on every platform: it only reads files.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const ORIGINALS = path.join(
  REPO,
  "node_modules",
  "semantic-release-gitmoji",
  "lib",
  "assets",
  "templates",
);
const VENDORED = path.join(REPO, "scripts", "lib", "release-notes");

/** Read a template; a missing file is a failure, never a skip. */
function read(dir: string, name: string): string {
  const file = path.join(dir, name);
  assert.ok(fs.existsSync(file), `cannot find ${file} to compare against`);
  return fs.readFileSync(file, "utf8").replace(/\n+$/, "");
}

describe("11f vendored GitLab templates have not drifted from the installed gitmoji", () => {
  it("11f: gitlab-commit-template.hbs, substitution reversed, equals the installed commit-template.hbs", () => {
    const reversed = read(VENDORED, "gitlab-commit-template.hbs").replaceAll(
      "@@PROJECT_URL@@/-/commit/",
      "https://github.com/{{owner}}/{{repo}}/commit/",
    );
    assert.equal(reversed, read(ORIGINALS, "commit-template.hbs"));
  });

  it("11f: gitlab-template.hbs, both substitutions reversed, equals the installed default-template.hbs", () => {
    // Per line, first occurrence only: the two substitutions of the original `sed -e ... -e ...`.
    const reversed = read(VENDORED, "gitlab-template.hbs")
      .split("\n")
      .map((line) =>
        line
          .replace("{{#if lastRelease.gitTag}}", "{{#if compareUrl}}")
          .replace(
            "(@@PROJECT_URL@@/-/compare/{{lastRelease.gitTag}}...{{nextRelease.gitTag}})",
            "({{compareUrl}})",
          ),
      )
      .join("\n");
    assert.equal(reversed, read(ORIGINALS, "default-template.hbs"));
  });

  it("11f: a missing installed original is a failure, not a skip", () => {
    assert.throws(() => read(ORIGINALS, "no-such-template.hbs"), /cannot find/);
  });
});
