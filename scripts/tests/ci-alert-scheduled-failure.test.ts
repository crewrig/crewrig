// Spec 0284 R5, R6: the alert script against a fake `gh` under mkdtemp, and the wiring checker's
// failing fixtures. The real `gh` is never started.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { check } from "../check-alert-scheduled-failure.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts/ci-alert-scheduled-failure.ts");
const TITLE = "Scheduled run failed: Exhaustive Run";
const MARKER = '<!-- crewrig:scheduled-failure workflow="Exhaustive Run" -->';
let dir = "";

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "alert-test-"));
  writeFileSync(
    path.join(dir, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const d = process.env.FAKE_GH_DIR;
fs.appendFileSync(d + "/calls.log", JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "issue" && process.argv[3] === "list") process.stdout.write(fs.readFileSync(d + "/list.json", "utf8"));
`,
  );
  chmodSync(path.join(dir, "gh"), 0o755);
});
after(() => {
  if (dir.includes("alert-test-")) rmSync(dir, { recursive: true, force: true });
});

function run(
  args: string[],
  list: unknown[] = [],
): { code: number | null; calls: string[][]; out: string } {
  writeFileSync(path.join(dir, "list.json"), JSON.stringify(list));
  const log = path.join(dir, "calls.log");
  if (existsSync(log)) rmSync(log);
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args],
    {
      encoding: "utf8",
      env: {
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        FAKE_GH_DIR: dir,
        GH_TOKEN: "canary-secret",
        GITHUB_WORKFLOW: "Exhaustive Run",
        GITHUB_RUN_ID: "42",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_SHA: "abc123",
        GITHUB_EVENT_NAME: "schedule",
      },
    },
  );
  const calls = existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
    : [];
  return { code: r.status, calls, out: r.stdout };
}

describe("alert script", () => {
  it("creates an issue with the marker when none is open", () => {
    const r = run(["--result", "failure"]);
    assert.equal(r.code, 0);
    assert.deepEqual(
      r.calls.map((c) => c[1]),
      ["list", "create"],
    );
    assert.ok(r.calls[0]!.includes("200"));
    assert.ok(r.calls[1]![r.calls[1]!.indexOf("--body") + 1]!.startsWith(MARKER));
    assert.equal(r.calls[1]![r.calls[1]!.indexOf("--title") + 1], TITLE);
    assert.ok(!JSON.stringify(r.calls).includes("canary-secret"));
  });
  it("comments on an open matching issue and creates nothing", () => {
    const r = run(["--result", "failure"], [{ number: 7, title: TITLE, body: `${MARKER}\nx` }]);
    assert.deepEqual(
      r.calls.map((c) => c[1]),
      ["list", "comment"],
    );
    assert.equal(r.calls[1]![2], "7");
  });
  it("creates when the listed issue has another title or no marker", () => {
    const r = run(
      ["--result", "failure"],
      [
        { number: 1, title: "Other", body: MARKER },
        { number: 2, title: TITLE, body: "no marker" },
      ],
    );
    assert.deepEqual(
      r.calls.map((c) => c[1]),
      ["list", "create"],
    );
  });
  for (const v of ["success", "skipped", "cancelled"]) {
    it(`is silent for ${v}`, () => {
      const r = run(["--result", v]);
      assert.equal(r.code, 0);
      assert.deepEqual(r.calls, []);
    });
  }
  it("rejects an unknown result without calling gh", () => {
    const r = run(["--result", "weird"]);
    assert.notEqual(r.code, 0);
    assert.deepEqual(r.calls, []);
  });
  it("--dry-run prints commands and runs none", () => {
    const r = run(["--result", "failure", "--dry-run"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.calls, []);
    assert.match(r.out, /dry-run: gh "issue" "create"/);
  });
});

describe("wiring checker", () => {
  const wf = readFileSync(path.join(root, ".github/workflows/changeset-coverage.yml"), "utf8");
  const tf = readFileSync(path.join(root, "taskfiles/ci.yml"), "utf8");
  it("accepts the real wiring", () => assert.deepEqual(check(wf, tf), []));
  const mutants: [string, string, string][] = [
    ["needs", "needs: changeset-coverage", "needs: other"],
    ["if", "failure() && github.event_name == 'schedule'", "failure()"],
    ["permissions", "issues: write", "issues: write\n      actions: write"],
    ["node 24", "node-version: 24\n      - run: npm", "node-version: 22\n      - run: npm"],
    [
      "production install",
      "npm ci --omit=dev --workspaces=false\n      - run: node scripts",
      "npm ci\n      - run: node scripts",
    ],
    ["secrets", "GH_TOKEN: ${{ github.token }}", "GH_TOKEN: ${{ secrets.X }}"],
    ["job", "  alert: # ci-capability", "  alarm: # ci-capability"],
  ];
  for (const [name, from, to] of mutants) {
    it(`flags a broken ${name}`, () => {
      assert.ok(wf.includes(from), from);
      assert.notEqual(check(wf.replace(from, to), tf).length, 0);
    });
  }
  it("flags the floor guard after the task call", () => {
    const g = "      - run: node scripts/lib/node-floor-guard.js\n";
    assert.notEqual(check(wf.replace(g, "").concat(g), tf).length, 0);
  });
  it("flags a missing task", () =>
    assert.notEqual(check(wf, tf.replace("  alert-scheduled-failure:", "  other:")).length, 0));
});
