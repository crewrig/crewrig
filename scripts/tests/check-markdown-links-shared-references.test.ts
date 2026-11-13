// check-markdown-links-shared-references.test.ts — regression for #1898: a skill source's
// `references/shared-<topic>.md` link resolves to artifacts/core/shared/references/<topic>.md.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-markdown-links.ts",
);
const SKILL = "artifacts/core/skills/demo/SKILL.md";
let repo = "";

function check(body: string, file = SKILL): { status: number | null; stdout: string } {
  writeFileSync(path.join(repo, file), body);
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, file],
    { cwd: repo, encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout };
}

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "md-links-shared-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  mkdirSync(path.join(repo, "artifacts/core/skills/demo"), { recursive: true });
  mkdirSync(path.join(repo, "artifacts/core/shared/references"), {
    recursive: true,
  });
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  writeFileSync(path.join(repo, "artifacts/core/shared/references/real-topic.md"), "x\n");
});
after(() => rmSync(repo, { recursive: true, force: true }));

describe("shared-reference links in skill sources", () => {
  it("resolves an existing shared topic", () => {
    const r = check("[t](references/shared-real-topic.md)\n");
    assert.equal(r.status, 0, r.stdout);
  });

  it("resolves a shared topic link with a fragment", () => {
    assert.equal(check("[t](references/shared-real-topic.md#sec)\n").status, 0);
  });

  it("still fails a shared topic that does not exist", () => {
    const r = check("[t](references/shared-missing-topic.md)\n");
    assert.equal(r.status, 1);
    assert.match(
      r.stdout,
      /'references\/shared-missing-topic\.md' -> resolved to 'artifacts\/core\/shared\/references\/missing-topic\.md'/,
    );
  });

  it("does not apply outside a skill source", () => {
    assert.equal(check("[t](references/shared-real-topic.md)\n", "docs/x.md").status, 1);
  });
});
