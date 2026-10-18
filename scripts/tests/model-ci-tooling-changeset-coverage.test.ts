// model-ci-tooling-changeset-coverage.test.ts — TS assertions of
// ci-changeset-coverage (spec 0262 req 11, 23) on a scratch reference per sandbox; the
// shell-versus-TypeScript comparison was retired with the switch. POSIX only. Every path written or linked is inside the sandbox root the helper created.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  createDifferential,
  type Differential,
  type DiffCase,
  type SideCtx,
} from "./lib/bash-suite-differential.ts";

const posix = process.platform === "win32" ? { skip: "shell legs need bash" } : {};
const CASE: DiffCase = { script: "scripts/ci-changeset-coverage.sh" };

const REFERENCE = `capabilities:
  - id: alpha
    changeset-gated: true
    command:
      - echo alpha-1 >> ran.log
      - echo alpha-2 >> ran.log
  - id: ungated
    command:
      - echo ungated >> ran.log
  - id: quoted
    changeset-gated: "true"
    command:
      - echo quoted >> ran.log
      - |
        echo block-1 >> ran.log
        echo block-2 >> ran.log
  - id: off
    changeset-gated: false
    command:
      - echo off >> ran.log
`;
const FAILING = REFERENCE.replace(
  "  - id: ungated",
  "  - id: broken\n    changeset-gated: true\n    command:\n      - exit 3\n      - echo after-fail >> ran.log\n      - bogus_cmd_q\n      - echo $UNSET_VAR_Q >> ran.log\n  - id: ungated",
);

function put(ctx: SideCtx, rel: string, body: string): void {
  const file = path.join(ctx.root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

// ONE pair of sandboxes for the file (building them is the cost); each case writes its own
// reference into both sandboxes, inside the roots the helper created.
let shared: Differential | undefined;
after(() => shared?.cleanup());

function agree(
  reference: string | null,
  c: Partial<DiffCase> = {},
  extra?: (ctx: SideCtx) => void,
) {
  shared ??= createDifferential(CASE);
  for (const ctx of Object.values(shared.ctx)) {
    if (reference !== null) put(ctx, "ci/ci-capabilities.yml", reference);
    extra?.(ctx);
  }
  const r = shared.run({ ...CASE, ...c });
  return r;
}

describe("ci-changeset-coverage twin: TS-only (spec 0262 delta-02 (g))", () => {
  test("an unparseable reference prints one Error line and exits 1", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-ci-tooling-cov-"));
    try {
      fs.mkdirSync(path.join(root, "ci"));
      fs.writeFileSync(
        path.join(root, "ci", "ci-capabilities.yml"),
        "capabilities: [unclosed\n  - x: : :\n",
      );
      const r = spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          path.join(import.meta.dirname, "..", "ci-changeset-coverage.ts"),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, REPO_DIR: root },
        },
      );
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^Error: .*ci-capabilities\.yml: [^\n]+\n$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ci-changeset-coverage twin", posix, () => {
  test("runs only the gated capabilities, in reference order, and passes", () => {
    const r = agree(REFERENCE);
    assert.equal(r.ts.status, 0);
    assert.match(
      r.ts.stdout,
      /running \[alpha\] echo alpha-1[\s\S]*running \[quoted\] echo block-2[\s\S]*exhaustive run passed\.\n$/,
    );
    assert.doesNotMatch(r.ts.stdout, /ungated|\[off\]/);
  });

  test("continues after failures and exits 1", () => {
    const r = agree(FAILING);
    assert.equal(r.ts.status, 1);
    assert.match(r.ts.stderr, /FAILED \[broken\] exit 3/);
    assert.match(r.ts.stderr, /command not found/);
    assert.match(r.ts.stderr, /3 command\(s\) failed in the exhaustive run\.\n$/);
  });

  test("a missing reference exits 2", () => {
    const r = agree(null, { env: { REPO_DIR: "{ROOT}/empty" } }, (ctx) =>
      fs.mkdirSync(path.join(ctx.root, "empty"), { recursive: true }),
    );
    assert.equal(r.ts.status, 2);
    assert.match(r.ts.stderr, /^Error: CI reference not found: /);
  });

  test("a missing yq exits 2", () => {
    const which = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
    const dirnameBin = spawnSync("sh", ["-c", "command -v dirname"], {
      encoding: "utf8",
    }).stdout.trim();
    const r = agree(REFERENCE, { env: { PATH: "{ROOT}/nobin" } }, (ctx) => {
      fs.mkdirSync(path.join(ctx.root, "nobin"), { recursive: true });
      for (const [name, target] of [
        ["bash", which],
        ["node", process.execPath],
        ["dirname", dirnameBin],
      ] as const) {
        const link = path.join(ctx.root, "nobin", name);
        if (!fs.existsSync(link)) fs.symlinkSync(target, link);
      }
    });
    assert.equal(r.ts.status, 2);
    assert.equal(r.ts.stderr, "Error: yq is required. Install with: brew install yq\n");
  });

  test("the registered stray-scan form fails a gated command on a stray", () => {
    const ref = `capabilities:
  - id: scanned
    changeset-gated: true
    command:
      - bash scripts/ci-cache-guard.sh --stray-scan -- bash -c 'bogus_cmd_q || true'
`;
    const r = agree(ref);
    assert.equal(r.ts.status, 1);
    assert.match(r.ts.stderr, /STRAY in: bash -c bogus_cmd_q \|\| true/);
  });
});
