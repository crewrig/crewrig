// model-ci-tooling-spec-id-reserved.test.ts — differential tests of scripts/check-spec-id-reserved.ts
// against scripts/check-spec-id-reserved.sh (spec 0262 reqs 1-4, 22). Both run on two identically
// seeded scratch remotes (never the real one) and must agree on stdout, stderr, exit status and the
// remote refs. The shell leg is skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { git, makeSide, runTool } from "./lib/spec-id-twins.ts";
import type { Side, SideOptions } from "./lib/spec-id-twins.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "check-twins-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const skipShell = process.platform === "win32";
const SAME = { CREWRIG_SPEC_ID_ORIGIN: "same", BASE_REF: "crewrig/main" };
const FORK = { CREWRIG_SPEC_ID_ORIGIN: "fork", BASE_REF: "crewrig/main" };

const spec = (issue: string, extra = ""): string =>
  `---\nid: x\nrelated-issue: ${issue}\n${extra}---\nbody\n`;

/** Apply `change` to each side's clone (an uncommitted or committed change), then compare. */
function differential(
  opts: SideOptions,
  change: (clone: string) => void,
  runs: { args?: string[]; env: Record<string, string> }[],
) {
  counter += 1;
  const sides: Side[] = ["sh", "ts"].map((k) => makeSide(scratch, `${k}-${counter}`, opts));
  for (const side of sides) change(side.clone);
  return runs.map((run) => {
    const a = runTool(sides[0] as Side, "sh", "check-spec-id-reserved", run.args ?? [], run.env);
    const b = runTool(sides[1] as Side, "ts", "check-spec-id-reserved", run.args ?? [], run.env);
    assert.deepEqual(b, a, `divergence on ${JSON.stringify(run)}`);
    return b;
  });
}

const write = (clone: string, rel: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(clone, rel)), { recursive: true });
  fs.writeFileSync(path.join(clone, rel), content);
  git(clone, ["add", "-A"]);
};

describe("check-spec-id-reserved twin", { skip: skipShell }, () => {
  const RES = {
    "refs/spec-ids/0010": "reserve 0010 for issue #10",
    "refs/tags/spec-id/0011": "reserve 0011 for issue #11",
    "refs/spec-ids/0013": "reserve 0013 for issue #13",
    "refs/tags/spec-id/0013": "reserve 0013 for issue #14",
    "refs/spec-ids/0015": "no ticket here",
    "refs/spec-ids-org/0042": "reserve 0042 for issue #42",
  };

  it("checks every added spec against both carriers and the recorded ticket", () => {
    const r = differential(
      { reservations: RES },
      (c) => {
        write(c, "specs/0010-ok.md", spec("10"));
        write(c, "specs/0011-tags.md", spec("11"));
        write(c, "specs/0012-never.md", spec("12", "unsecured-id: true\n"));
        write(c, "specs/0016-never2.md", spec("16"));
        write(c, "specs/0013-both.md", spec("13"));
        write(c, "specs/0014-other.md", spec("99"));
        write(c, "specs/0015-unresolved.md", spec("15"));
        write(c, "specs/abcd-name.md", spec("1"));
        write(c, "specs/0017-noissue.md", "---\nid: x\n---\n");
        write(c, "specs/0042-org-ok.md", spec("42"));
      },
      [{ env: SAME }, { env: FORK }, { env: SAME, args: ["crewrig/main"] }],
    );
    assert.deepEqual(
      r.map((x) => x.status),
      [1, 0, 1],
    );
  });

  it("flags a stale unsecured mark and passes a clean change", () => {
    const r = differential(
      { reservations: RES },
      (c) => write(c, "specs/0010-ok.md", spec("10", "unsecured-id: TRUE\n")),
      [{ env: SAME }],
    );
    assert.equal(r[0]?.status, 1);
    const clean = differential(
      { reservations: RES },
      (c) => write(c, "specs/0010-ok.md", spec("10")),
      [{ env: SAME }],
    );
    assert.equal(clean[0]?.status, 0);
  });

  it("separates added, renamed, delta, org and manifest-excluded specs", () => {
    const files = {
      "specs/0001-old.md": spec("1"),
      ".crewrig/core-paths.txt": "# m\nspecs/acme\texcluded\nspecs/foo\tstrict\nspecs/bar\n",
    };
    const r = differential(
      { files, reservations: RES },
      (c) => {
        git(c, ["mv", "specs/0001-old.md", "specs/0010-ok.md"]);
        write(c, "specs/0010-ok.md", spec("10"));
        write(c, "specs/0010-ok.delta-01.md", spec("10"));
        write(c, "specs/org/0777-x.md", spec("7"));
        write(c, "specs/acme/0888-x.md", spec("8"));
        write(c, "specs/README.md", "x\n");
      },
      [{ env: SAME }],
    );
    assert.equal(r[0]?.status, 0);
    const none = differential(
      { reservations: RES },
      (c) => write(c, "specs/org/1-x.md", spec("7")),
      [{ env: SAME }],
    );
    assert.equal(none[0]?.status, 0);
  });

  it("treats an unreadable namespace as a report, not a finding", () => {
    const r = differential({}, (c) => write(c, "specs/0020-x.md", spec("20")), [
      { env: { CREWRIG_SPEC_ID_ORIGIN: "same", BASE_REF: "crewrig/main" } },
    ]);
    assert.equal(r[0]?.status, 1);
    const gone = differential(
      {},
      (c) => {
        write(c, "specs/0020-x.md", spec("20"));
        git(c, ["remote", "set-url", "crewrig", path.join(c, "..", "missing.git")]);
        fs.mkdirSync(path.join(c, "..", "missing.git"), { recursive: true });
      },
      [{ env: SAME }],
    );
    assert.equal(gone[0]?.status, 0);
  });

  it("reports wiring faults with exit 2", () => {
    const base = (c: string): void => write(c, "specs/0020-x.md", spec("20"));
    const r = differential({}, base, [
      { env: {} },
      { env: { CREWRIG_SPEC_ID_ORIGIN: "bogus" } },
      { env: { CI: "true", BASE_REF: "crewrig/main" } },
      { env: { CI: "true", CREWRIG_SPEC_ID_ORIGIN: "same" } },
      { env: { CI: "true", CREWRIG_PR_HEAD_REPO: "a/b", CREWRIG_PR_BASE_REPO: "a/b" } },
      {
        env: {
          CREWRIG_PR_HEAD_REPO: "a/b",
          CREWRIG_PR_BASE_REPO: "a/c",
          CREWRIG_SPEC_ID_ORIGIN: "same",
          BASE_REF: "crewrig/main",
        },
      },
      {
        env: {
          CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: "a/b",
          CI_PROJECT_PATH: "a/b",
          CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main",
          GITLAB_CI: "1",
        },
      },
      {
        env: {
          CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: "a/b",
          CI_PROJECT_PATH: "a/b",
          GITLAB_CI: "1",
        },
      },
      { env: { CREWRIG_SPEC_ID_ORIGIN: "same", BASE_REF: "crewrig/nosuch" } },
      { env: { CREWRIG_SPEC_ID_ORIGIN: "same", BASE_REF: "crewrig/" } },
      { env: { CREWRIG_SPEC_ID_ORIGIN: "same", CREWRIG_REPO_DIR: scratch } },
    ]);
    assert.deepEqual(r.map((x) => x.status).slice(0, 5), [2, 2, 2, 2, 2]);
    assert.equal(
      differential({ remote: "" }, base, [{ env: { CREWRIG_SPEC_ID_ORIGIN: "same" } }])[0]?.status,
      2,
    );
  });
});
