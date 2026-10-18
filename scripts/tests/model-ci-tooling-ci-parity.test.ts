// model-ci-tooling-ci-parity.test.ts — TS-only assertions of scripts/check-ci-parity.ts (spec 0262
// req 9, 24): exit statuses and diagnostics on scratch fixtures. The shell-versus-TypeScript
// comparison was retired with the switch; scripts/tests/ci-parity-*.test.ts cover the entry.
// Fixtures are copies in mkdtemp directories; the test deletes only those.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { PENDING_SECTIONS } from "../lib/ci-parity/entry.ts";
import { applyNormalDiff } from "./lib/normal-diff-apply.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const TS = path.join(REPO, "scripts", "check-ci-parity.ts");
const roots: string[] = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** A scratch repository tree (reference, workflows, gitlab file) inside its own mkdtemp dir. */
function fixture(edit?: (root: string) => void): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-parity-")));
  roots.push(root);
  fs.cpSync(path.join(REPO, "ci"), path.join(root, "ci"), { recursive: true });
  fs.cpSync(path.join(REPO, ".github", "workflows"), path.join(root, ".github", "workflows"), {
    recursive: true,
  });
  fs.copyFileSync(path.join(REPO, ".gitlab-ci.yml"), path.join(root, ".gitlab-ci.yml"));
  edit?.(root);
  return root;
}

function exec(_entry: "ts", root: string): { out: string; err: string; code: number | null } {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: root },
  });
  const norm = (s: string): string => s.replaceAll(root, "<ROOT>");
  return { out: norm(r.stdout), err: norm(r.stderr), code: r.status };
}

/** The twin ends with this exit status, and (when given) its stderr or stdout carries `mark`. */
function expectExit(root: string, code: number, mark?: RegExp): void {
  const r = exec("ts", root);
  assert.equal(r.code, code, `${r.out}${r.err}`);
  if (mark) assert.match(r.out + r.err, mark);
}

const sub =
  (file: string, from: string, to: string) =>
  (root: string): void => {
    const p = path.join(root, file);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(from, to));
  };

describe("check-ci-parity twin", () => {
  test("the real repository agrees (pending: " + PENDING_SECTIONS.join(", ") + ")", () =>
    expectExit(fixture(), 0),
  );
  test("a missing reference exits 2", () =>
    expectExit(
      fixture((r) => fs.rmSync(path.join(r, "ci", "ci-capabilities.yml"))),
      2,
    ));
  test("an unknown trigger kind fails validity", () =>
    expectExit(fixture(sub("ci/ci-capabilities.yml", "on: pull-request", "on: pull-requests")), 1));
  test("a duplicate id fails validity", () => {
    const rec =
      "  - id: build\n    portability: specific\n    trigger: [{on: push}]\n    exception: {engine: x, evidence: y}\n";
    expectExit(fixture(sub("ci/ci-capabilities.yml", "  - id: ", rec + rec + "  - id: ")), 1);
  });
  test("an untraceable gitlab job is reported", () =>
    expectExit(
      fixture((r) =>
        fs.appendFileSync(path.join(r, ".gitlab-ci.yml"), "\nmystery-job:\n  script: [true]\n"),
      ),
      1,
      /mystery-job/,
    ));
  test("an unknown annotation is reported", () =>
    expectExit(
      fixture((r) =>
        fs.appendFileSync(
          path.join(r, ".gitlab-ci.yml"),
          "\nmystery-job: # ci-capability: nope\n  script: [true]\n",
        ),
      ),
      1,
      /nope/,
    ));
  test("a changed portable command fails arm 1", () =>
    expectExit(
      fixture(sub("ci/ci-capabilities.yml", "command:", "command:\n      - echo extra")),
      1,
    ));
  test("a path filter divergence fails", () =>
    expectExit(
      fixture(
        sub("ci/ci-capabilities.yml", "        paths:\n", "        paths:\n          - zz/**\n"),
      ),
      1,
    ));
  test("a drifted workflow job fails arm 1", () =>
    expectExit(fixture(sub(".github/workflows/build.yml", "run:", "run: echo drift #")), 1));
  // Spec delta-02 (h): the printed hunks must turn the committed file into the generated one.
  test("a stale gitlab file fails arm 2 and the printed diff repairs it", () => {
    const drifted = '    - "npm install"\n    - "echo drift"\n';
    const root = fixture(sub(".gitlab-ci.yml", '    - "npm install"\n', drifted));
    const committed = fs.readFileSync(path.join(root, ".gitlab-ci.yml"), "utf8");
    const generated = fs.readFileSync(path.join(REPO, ".gitlab-ci.yml"), "utf8");
    const rows = exec("ts", root).err.split("\n");
    const start = rows.findIndex((l) => /^ {4}DRIFT: .*differs from a fresh derivation/.test(l));
    const open = rows.indexOf("    ", start);
    const close = rows.indexOf("    ", open + 1);
    assert.ok(start >= 0 && open > start && close > open, rows.join("\n"));
    const body = rows.slice(open + 1, close).map((l) => l.slice(4));
    assert.equal(applyNormalDiff(committed, body.join("\n") + "\n"), generated);
  });
  test("no gitlab file checks only the present arms", () =>
    expectExit(
      fixture((r) => fs.rmSync(path.join(r, ".gitlab-ci.yml"))),
      0,
    ));
  test("no workflows directory checks only the present arms", () =>
    expectExit(
      fixture((r) => fs.rmSync(path.join(r, ".github"), { recursive: true })),
      0,
    ));
});

describe("check-ci-parity twin: inputs outside the byte comparison (delta-05 item (j))", () => {
  const gap = (edit: (r: string) => void, file: string): void => {
    const root = fixture(edit);
    const r = exec("ts", root);
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    const lines = r.err.split("\n").filter((l) => l !== "");
    assert.equal(lines.length, 1, r.err);
    assert.match(lines[0] as string, new RegExp(`^Error: <ROOT>/${file}: .+`));
  };
  const write =
    (file: string, text: string) =>
    (root: string): void =>
      fs.writeFileSync(path.join(root, file), text);
  test("a multi-document workflow", () =>
    gap(
      write(".github/workflows/zz.yml", "jobs:\n  a:\n    x: 1\n---\njobs:\n  b:\n    x: 1\n"),
      ".github/workflows/zz.yml",
    ));
  test("a multi-document .gitlab-ci.yml", () =>
    gap(write(".gitlab-ci.yml", "a:\n  x: 1\n---\nb:\n  x: 1\n"), ".gitlab-ci.yml"));
  test("an unparseable .gitlab-ci.yml", () =>
    gap(write(".gitlab-ci.yml", "a: [1\nb: }\n"), ".gitlab-ci.yml"));
  test("an unparseable workflow", () =>
    gap(write(".github/workflows/zz.yml", "jobs: [1\nx: }\n"), ".github/workflows/zz.yml"));
  test("an unparseable reference", () =>
    gap(write("ci/ci-capabilities.yml", "capabilities: [1\nb: }\n"), "ci/ci-capabilities.yml"));
  test("an explicit key among the job keys of a workflow", () =>
    gap(write(".github/workflows/zz.yml", "jobs:\n  ? a\n  : x: 1\n"), ".github/workflows/zz.yml"));
  test("a scalar jobs value", () =>
    gap(write(".github/workflows/zz.yml", "jobs: nope\n"), ".github/workflows/zz.yml"));
  test("an explicit key in the scanned mapping", () =>
    gap(write(".gitlab-ci.yml", "? a\n: x: 1\n"), ".gitlab-ci.yml"));
  test("a multi-document reference with no capability keeps the stable line", () =>
    expectExit(
      fixture(write("ci/ci-capabilities.yml", "capabilities: []\n---\ncapabilities: []\n")),
      1,
    ));
});
