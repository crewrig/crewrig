// Spec 0310 R6, R7, R9: the triggers, permissions, environment and secrets of the two framework release
// workflows. Each pin runs against the real file and against a mutated copy, so a pin that always passes is caught.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { load } from "js-yaml";

const WF = path.join(import.meta.dirname, "..", "..", ".github", "workflows");
const PRE = fs.readFileSync(path.join(WF, "release-framework-prerelease.yml"), "utf8");
const STABLE = fs.readFileSync(path.join(WF, "release-framework-stable.yml"), "utf8");

type Doc = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<
    string,
    {
      environment?: string;
      permissions?: Record<string, string>;
      steps?: Array<Record<string, unknown>>;
    }
  >;
};

/** Defects of the prerelease workflow text; empty when every pin holds. */
function prereleaseDefects(text: string): string[] {
  const out: string[] = [];
  const doc = load(text) as Doc;
  const on = doc.on ?? {};
  if (JSON.stringify(Object.keys(on)) !== '["push"]') out.push("triggers other than push");
  if (
    JSON.stringify(on["push"] as { tags?: string[]; branches?: string[] }) !==
    '{"tags":["crewrig-v*-next.*"]}'
  )
    out.push("push is not the single tag filter");
  const jobs = Object.keys(doc.jobs ?? {});
  if (JSON.stringify(jobs) !== '["release-framework-prerelease"]') out.push("job id");
  const job = doc.jobs?.["release-framework-prerelease"];
  if (
    JSON.stringify(doc.permissions) !==
    JSON.stringify({ contents: "write", "id-token": "write", attestations: "write" })
  )
    out.push("permissions");
  if (job?.environment !== undefined) out.push("declares an environment");
  const secrets = [...text.matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1]);
  if (secrets.some((name) => name !== "GITHUB_TOKEN"))
    out.push("reads a secret other than GITHUB_TOKEN");
  if (
    !/--kind prerelease/.test(text) ||
    !/framework-release-guard\.ts --kind prerelease/.test(text)
  )
    out.push("guard step");
  if (/create-github-app-token|--kind stable/.test(text)) out.push("stable credential or path");
  return out;
}

function stableDefects(text: string): string[] {
  const out: string[] = [];
  const doc = load(text) as Doc;
  const on = doc.on ?? {};
  if (JSON.stringify(Object.keys(on)) !== '["workflow_dispatch"]')
    out.push("triggers other than workflow_dispatch");
  const job = doc.jobs?.["release-framework-stable"];
  if (JSON.stringify(Object.keys(doc.jobs ?? {})) !== '["release-framework-stable"]')
    out.push("job id");
  if (job?.environment !== "framework-release") out.push("environment");
  if (
    JSON.stringify(job?.permissions) !==
    JSON.stringify({ contents: "read", "id-token": "write", attestations: "write" })
  )
    out.push("job permissions");
  const steps = job?.steps ?? [];
  const index = (re: RegExp): number => steps.findIndex((s) => re.test(JSON.stringify(s)));
  const guard = index(/framework-release-guard\.ts --kind stable/);
  const mint = index(/create-github-app-token/);
  const publish = index(/framework-release-publish\.ts/);
  if (guard < 0 || mint < 0 || publish < 0 || !(guard < mint && mint < publish))
    out.push("guard, then mint, then publish");
  const secrets = [...text.matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1]).sort();
  if (JSON.stringify(secrets) !== '["FRAMEWORK_RELEASE_APP_ID","FRAMEWORK_RELEASE_APP_KEY"]')
    out.push("secrets");
  const before = JSON.stringify(steps.slice(0, mint));
  if (/FRAMEWORK_RELEASE/.test(before)) out.push("a secret is used before the guard passes");
  if (!/APPROVER READ DUTY/.test(text)) out.push("header states no approver read duty");
  if (/make_latest|--latest/.test(text)) out.push("latest");
  return out;
}

describe("prerelease workflow", () => {
  it("holds every pin", () => assert.deepEqual(prereleaseDefects(PRE), []));
  const mutants: Array<[string, (t: string) => string, string]> = [
    [
      "a branch trigger",
      (t) => t.replace("on:\n  push:\n", "on:\n  push:\n    branches: [main]\n"),
      "push is not the single tag filter",
    ],
    [
      "a dispatch trigger",
      (t) => t.replace("\npermissions:", "\n  workflow_dispatch:\n\npermissions:"),
      "triggers other than push",
    ],
    [
      "an environment",
      (t) => t.replace("    if: github", "    environment: framework-release\n    if: github"),
      "declares an environment",
    ],
    [
      "an app secret",
      (t) => t.replace("${{ github.token }}", "${{ secrets.FRAMEWORK_RELEASE_APP_KEY }}"),
      "reads a secret other than GITHUB_TOKEN",
    ],
    ["no attestations permission", (t) => t.replace("  attestations: write\n", ""), "permissions"],
    [
      "no guard",
      (t) => t.replace("framework-release-guard.ts --kind prerelease", "true"),
      "guard step",
    ],
  ];
  for (const [name, edit, defect] of mutants) {
    it(`mutant caught: ${name}`, () => {
      const text = edit(PRE);
      assert.notEqual(text, PRE);
      assert.ok(prereleaseDefects(text).includes(defect), prereleaseDefects(text).join(", "));
    });
  }
});

describe("stable workflow", () => {
  it("holds every pin", () => assert.deepEqual(stableDefects(STABLE), []));
  const mutants: Array<[string, (t: string) => string, string]> = [
    [
      "a tag trigger",
      (t) =>
        t.replace(
          "on:\n  workflow_dispatch:",
          "on:\n  push:\n    tags: ['crewrig-v*']\n  workflow_dispatch:",
        ),
      "triggers other than workflow_dispatch",
    ],
    ["no environment", (t) => t.replace("    environment: framework-release\n", ""), "environment"],
    [
      "publish before mint",
      (t) =>
        t
          .replace("Mint the GitHub App token", "Mint the GitHub App token")
          .replace("uses: actions/create-github-app-token@v2", "uses: actions/checkout@v4"),
      "guard, then mint, then publish",
    ],
    [
      "a secret in an early step",
      (t) =>
        t.replace(
          "      - name: Floor guard accepts Node.js 24\n        run: node scripts/lib/node-floor-guard.js",
          "      - name: Floor guard accepts Node.js 24\n        env:\n          K: ${{ secrets.FRAMEWORK_RELEASE_APP_KEY }}\n        run: node scripts/lib/node-floor-guard.js",
        ),
      "a secret is used before the guard passes",
    ],
    [
      "no read duty",
      (t) => t.replace("APPROVER READ DUTY", "NOTE"),
      "header states no approver read duty",
    ],
    [
      "write permission on contents",
      (t) =>
        t.replace(
          "    permissions:\n      contents: read",
          "    permissions:\n      contents: write",
        ),
      "job permissions",
    ],
  ];
  for (const [name, edit, defect] of mutants) {
    it(`mutant caught: ${name}`, () => {
      const text = edit(STABLE);
      assert.notEqual(text, STABLE);
      assert.ok(stableDefects(text).includes(defect), stableDefects(text).join(", "));
    });
  }
});
