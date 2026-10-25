// Replaces groups (f) and (g) of scripts/tests/test-monorepo-release.sh (spec 0265, row J2): the GitLab
// publishing doc never recommends `extensions install` as a runnable step (ruling 1, "unmeasured"), and
// the release and build workflows keep the permissions and jobs the release dispatch relies on (#1379).
// Each pin is also run against a mutated temp copy, so a pin that always passes is caught.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  BUILD_WORKFLOW,
  buildWorkflowPinned,
  GITLAB_DOC,
  installLinesInFences,
  installMentionUnhedged,
  RELEASE_WORKFLOW,
  releaseWorkflowPinned,
} from "./lib/release-docs-checks.ts";
import { realTmp, REPO } from "./lib/worktree-fixtures.ts";

/** A temp root holding `rel` (copied from the repo) with `edit` applied; the edit must change it. */
function mutant(rel: string, edit: (text: string) => string): string {
  const root = realTmp("release-docs-");
  const text = fs.readFileSync(path.join(REPO, rel), "utf8");
  // Staged workflows (spec 0287): keep the sibling workflow files so union readers see every job.
  const wf = path.join(".github", "workflows");
  if (rel.startsWith(wf)) {
    fs.mkdirSync(path.join(root, wf), { recursive: true });
    for (const f of fs.readdirSync(path.join(REPO, wf))) {
      if (f === "build.yml" || f.startsWith("_ci-"))
        fs.copyFileSync(path.join(REPO, wf, f), path.join(root, wf, f));
    }
  }
  const out = edit(text);
  assert.notEqual(out, text, "the mutation changes the file");
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), out);
  return root;
}

describe("(f) Ruling 1 — the GitLab doc never recommends `extensions install`", () => {
  test("(f) 'extensions install' never appears inside a runnable code fence", () => {
    assert.ok(fs.existsSync(path.join(REPO, GITLAB_DOC)), `cannot find ${GITLAB_DOC}`);
    assert.equal(installLinesInFences(REPO), 0);
  });

  test("(f) every mention of 'extensions install' coexists with the required 'unmeasured' hedge", () => {
    assert.equal(installMentionUnhedged(REPO), false);
  });

  test("(f) mutants: a fenced mention and a removed hedge are both caught", () => {
    const fenced = mutant(
      GITLAB_DOC,
      (t) => `${t}\n\`\`\`sh\ngemini extensions install <url>\n\`\`\`\n`,
    );
    assert.equal(installLinesInFences(fenced), 1);
    const unhedged = mutant(GITLAB_DOC, (t) => t.replaceAll("unmeasured", "measured"));
    assert.equal(installMentionUnhedged(unhedged), true);
  });
});

describe("(g) #1379 — release workflow permissions and build.yml dispatch", () => {
  test("(g) the release workflow may dispatch the checks (actions: write) and never cancels a running release", () => {
    assert.ok(releaseWorkflowPinned(REPO));
  });

  test("(g) build.yml accepts workflow_dispatch and defines the required ratchet and lint-typescript jobs", () => {
    assert.ok(buildWorkflowPinned(REPO));
  });

  test("(g) mutants: each pinned line, removed or indented differently, is caught", () => {
    assert.equal(
      releaseWorkflowPinned(
        mutant(RELEASE_WORKFLOW, (t) => t.replace(/^ {2}actions: write$/m, "  actions: read")),
      ),
      false,
    );
    assert.equal(
      releaseWorkflowPinned(
        mutant(RELEASE_WORKFLOW, (t) =>
          t.replace(/^ {2}cancel-in-progress: false$/m, "  cancel-in-progress: true"),
        ),
      ),
      false,
    );
    for (const [file, job] of [
      [BUILD_WORKFLOW, "ratchet:"],
      [BUILD_WORKFLOW, "lint-typescript:"],
      [BUILD_WORKFLOW, "workflow_dispatch:"],
    ] as const) {
      const edited = mutant(file, (t) => t.replace(new RegExp(`^ {2}${job}`, "m"), `  x-${job}`));
      assert.equal(buildWorkflowPinned(edited), false, job);
    }
  });
});
