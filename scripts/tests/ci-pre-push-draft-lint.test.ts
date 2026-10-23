// Tests the spec 0168 R1 handling of the pre-push run against the REAL spec linter (spec 0279 R12):
// a spec of `status: draft` passes under the environment `ci:lint-specs` receives, and a spec with
// a missing required frontmatter field still fails under it. The spec linter needs markdownlint-cli,
// a development dependency, so this file runs in the ci-pre-push-replay capability (full `npm ci`),
// not in check-taskfile-tree (`npm ci --omit=dev`).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskEnv } from "../lib/ci-pre-push/run.ts";
import { commitAll, git as gitIn } from "./lib/governance-git-fixture.ts";
import { gitFixture, renderSpec, runLinter } from "./lib/spec-linter-fixtures.ts";

describe("pre-push spec lint under the draft signal (R12)", () => {
  const specFixture = (draftFile: string): ReturnType<typeof gitFixture> => {
    const fx = gitFixture({
      remote: false,
      files: {
        "specs/0200-ok.md": renderSpec({
          id: "0200",
          slug: "ok",
          status: "implemented",
          extraFm: "interaction-mode: INTERMEDIATE",
        }),
      },
    });
    gitIn(fx.root, ["checkout", "-q", "-b", "spec/0300-new-draft"]);
    fx.put("specs/0300-new-draft.md", draftFile);
    commitAll(fx.root, "change");
    return fx;
  };

  const lintWith = (fx: ReturnType<typeof gitFixture>): ReturnType<typeof runLinter> =>
    runLinter(fx.root, ["specs"], {
      env: {
        ...taskEnv("lint-specs", { cwd: fx.root, env: {} }),
        BASE_REF: "main",
        BRANCH_NAME: "spec/0300-new-draft",
      },
    });

  it("lets a draft-status spec through the real spec linter under that env", () => {
    const r = lintWith(specFixture(renderSpec({ id: "0300", slug: "new-draft" })));
    assert.equal(r.status, 0, r.output);
  });

  it("still fails a spec with a missing required frontmatter field under that env", () => {
    const broken = renderSpec({ id: "0300", slug: "new-draft" }).replace(/^slug: .*\n/m, "");
    const r = lintWith(specFixture(broken));
    assert.equal(r.status, 1, r.output);
  });
});
