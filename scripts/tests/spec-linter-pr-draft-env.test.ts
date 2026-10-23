// Spec 0279 R7: the spec-linter suites stay hermetic when the developer's shell (for example the
// pre-push wrapper, which exports CREWRIG_PR_DRAFT=true to `ci:lint-specs`) carries the Draft-PR
// signal. lintEnv scrubs it, so an ambient CREWRIG_PR_DRAFT=true must not change any outcome.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  commitAll,
  git,
  gitFixture,
  lintEnv,
  renderSpec,
  runLinter,
} from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 60_000 };
const R1_FAIL =
  "[FAIL] Specs or delta-specs added or modified by this change carry 'status: draft'";
let saved: string | undefined;

before(() => {
  saved = process.env["CREWRIG_PR_DRAFT"];
  process.env["CREWRIG_PR_DRAFT"] = "true";
});

after(() => {
  if (saved === undefined) delete process.env["CREWRIG_PR_DRAFT"];
  else process.env["CREWRIG_PR_DRAFT"] = saved;
});

describe("spec-linter ignores an ambient CREWRIG_PR_DRAFT=true", () => {
  test("lintEnv drops the variable unless a test passes it explicitly", () => {
    assert.equal(process.env["CREWRIG_PR_DRAFT"], "true");
    assert.equal(lintEnv()["CREWRIG_PR_DRAFT"], undefined);
    assert.equal(lintEnv({ CREWRIG_PR_DRAFT: "true" })["CREWRIG_PR_DRAFT"], "true");
  });

  test("a new draft spec still fails R1 under the ambient signal", T, () => {
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
    git(fx.root, "checkout", "-q", "-b", "spec/0300-new-draft");
    fx.putSpec("specs/0300-new-draft.md", { id: "0300", slug: "new-draft" });
    commitAll(fx.root, "change under test");
    const r = runLinter(fx.root, ["specs"], {
      env: { BASE_REF: "main", BRANCH_NAME: "spec/0300-new-draft" },
    });
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes(R1_FAIL), r.output);
  });

  test(
    "an unrelated rule outcome is unchanged: a conformant spec passes, a broken one fails",
    T,
    () => {
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
      const ok = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });
      assert.equal(ok.status, 0, ok.output);
      fx.put(
        "specs/0201-bad.md",
        renderSpec({ id: "0201", slug: "bad" }).replace(/^slug: .*\n/m, ""),
      );
      const bad = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });
      assert.equal(bad.status, 1, bad.output);
    },
  );
});
