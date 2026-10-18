// spec-linter-lifecycle.ts — fixtures and assertions of the spec-linter attribution,
// implementation-branch and delta-lifecycle suites (spec 0265, row J2, P6). Replaces
// new_fixture / put_spec / commit_base / touch_unrelated / run_lint_case / run_base_case's
// assertion half of scripts/tests/test-spec-linter.sh.
//
//   putLifecycleSpec(fx, fname, status, related, extra?)  conformant spec or delta-spec
//   lifecycleFixture(specs)       repo on `main` holding the specs plus docs/unrelated.md
//   touchUnrelated(fx)            make the change under test non-empty, touching no spec
//   lintBranch(fx, branch, cwd?)  run on `specs` with BASE_REF=main, BRANCH_NAME=<branch>
//   expectLint(r, status, ...a)   exit status, then "+text" must appear, "-text" must not
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  commitAll,
  gitFixture,
  renderSpec,
  runLinter,
  type Fixture,
  type LintResult,
} from "./spec-linter-fixtures.ts";

export type SpecEntry = readonly [fname: string, status: string, related: number, extra?: string];

/** Any status past `draft` carries `interaction-mode: AUTO`, so only the checked rule can fail. */
export function lifecycleSpecText(
  fname: string,
  status: string,
  related: number | string,
  extra = "",
): string {
  const stem = fname.replace(/\.md$/, "").replace(/\.delta-.*$/, "");
  const id = stem.split("-")[0];
  const slug = stem.slice(id.length + 1);
  const extraFm = [status === "draft" ? "" : "interaction-mode: AUTO", extra]
    .filter((l) => l !== "")
    .join("\n");
  return renderSpec({
    id,
    slug,
    status,
    extraFm,
    relatedIssue: related,
    headings: fname.includes(".delta-") ? "## ADDED\n\n## MODIFIED\n\n## REMOVED" : "",
  });
}

export function putLifecycleSpec(
  fx: Fixture,
  fname: string,
  status: string,
  related: number | string,
  extra = "",
): void {
  fx.put(`specs/${fname}`, lifecycleSpecText(fname, status, related, extra));
}

export function lifecycleFixture(specs: readonly SpecEntry[]): Fixture {
  const files: Record<string, string> = { "docs/unrelated.md": "# Unrelated\n\nBody.\n" };
  for (const [fname, status, related, extra] of specs) {
    files[`specs/${fname}`] = lifecycleSpecText(fname, status, related, extra);
  }
  const fx = gitFixture({ remote: false, files });
  commitAll(fx.root, "base branch content docs", ["docs"]);
  return fx;
}

export function touchUnrelated(fx: Fixture): void {
  fs.appendFileSync(
    path.join(fx.root, "docs/unrelated.md"),
    "\nEdited by the change under test.\n",
  );
}

export function lintBranch(fx: Fixture, branch: string, cwd?: string): LintResult {
  return runLinter(fx.root, ["specs"], { cwd, env: { BASE_REF: "main", BRANCH_NAME: branch } });
}

export function expectLint(r: LintResult, status: number, ...assertions: string[]): void {
  assert.equal(r.status, status, r.output);
  for (const a of assertions) {
    const text = a.slice(1);
    if (a.startsWith("+")) assert.ok(r.output.includes(text), `missing: ${text}\n${r.output}`);
    else assert.ok(!r.output.includes(text), `unexpected: ${text}\n${r.output}`);
  }
}
