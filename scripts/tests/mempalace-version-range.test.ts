// mempalace-version-range.test.ts — guard the single MemPalace supported-range
// pin across every literal-text copy in the repository (spec 0263, replaces
// test-mempalace-version-range.sh; spec 0082 R5 delta-01). The pin is read from
// scripts/lib/common.sh, never redeclared; the divergent fixture stays a literal
// and is asserted different from the pin. The superseded literal is assembled
// at runtime so a plain `git grep` never counts this file as an offender.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { installSpec, readMempalacePin } from "../lib/mempalace-pin.ts";
import {
  commitAll,
  makeCommit,
  newRepo,
  scanRepo,
  supersededRe,
  writeFile,
} from "./lib/mempalace-range-scan.ts";

const REPO =
  process.env["CREWRIG_REPO_DIR"] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const OLD_MIN = "3.3.3";
const OLD_MAX = "3.4";
const DIVERGENT = ["mempalace>", "=3.5.0,<3.6"].join("");
const PIN = readMempalacePin(REPO);
const EXPECTED = installSpec(PIN);
const OPTS = { expectedSpec: EXPECTED, oldLiteralRe: supersededRe(OLD_MIN, OLD_MAX) };

let scratch = "";
before(() => {
  assert.notEqual(DIVERGENT, EXPECTED, "the divergent fixture must differ from the current pin");
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-range-")));
});
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe("mempalace range sweep", () => {
  test("superseded literal is flagged", () => {
    const repo = newRepo(scratch);
    makeCommit(repo, "README.md", `pipx install 'mempalace>=${OLD_MIN},<${OLD_MAX}'`);
    const { violations } = scanRepo(repo, OPTS);
    assert.ok(
      violations.some((v) => v.startsWith("STALE RANGE: README.md:1:")),
      violations.join("\n"),
    );
  });

  test("divergent numeric range is flagged", () => {
    const repo = newRepo(scratch);
    makeCommit(repo, "docs/x.md", `run pipx install '${DIVERGENT}' now`);
    assert.deepEqual(scanRepo(repo, OPTS).violations, [
      `DIVERGENT RANGE: docs/x.md:1: '${DIVERGENT}' (want '${EXPECTED}')`,
    ]);
  });

  test("current pin passes", () => {
    const repo = newRepo(scratch);
    makeCommit(repo, "docs/x.md", `run pipx install '${EXPECTED}' now`);
    assert.deepEqual(scanRepo(repo, OPTS).violations, []);
  });

  test("interpolated single-source form is not flagged", () => {
    const repo = newRepo(scratch);
    const interp =
      'pipx install "mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}"';
    makeCommit(repo, "scripts/x.sh", interp);
    assert.deepEqual(scanRepo(repo, OPTS).violations, []);
  });

  test("superseded literal in docs/adr and specs is exempt", () => {
    const repo = newRepo(scratch);
    writeFile(
      repo,
      "docs/adr/0001-x.md",
      `installed via pipx install 'mempalace>=${OLD_MIN},<${OLD_MAX}'`,
    );
    writeFile(repo, "specs/0082.md", `cite 'mempalace>=${OLD_MIN},<${OLD_MAX}' as removed`);
    commitAll(repo);
    assert.deepEqual(scanRepo(repo, OPTS).violations, []);
  });

  test("an uncommitted, untracked file is not scanned", () => {
    const repo = newRepo(scratch);
    makeCommit(repo, "docs/ok.md", "nothing here");
    writeFile(repo, "docs/loose.md", `pipx install '${DIVERGENT}'`);
    assert.deepEqual(scanRepo(repo, OPTS).violations, []);
  });

  test("real repository carries no stale or divergent range literal", () => {
    const { violations } = scanRepo(REPO, OPTS);
    assert.deepEqual(violations, []);
  });
});
