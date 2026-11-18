// framework-release-workflows-kit.ts — the readers, defect finders and mutant runner shared by the suites that
// pin the two framework release workflows (spec 0310 R6, R7, R9).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { load } from "js-yaml";

export const REPO = path.join(import.meta.dirname, "..", "..", "..");
export const WF = path.join(REPO, ".github", "workflows");
export const PRE = fs.readFileSync(path.join(WF, "release-framework-prerelease.yml"), "utf8");
export const STABLE = fs.readFileSync(path.join(WF, "release-framework-stable.yml"), "utf8");

type Step = { name?: string; run?: string; uses?: string };
type Job = {
  needs?: string;
  environment?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
};
type Doc = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
};

const READ_ONLY = JSON.stringify({ contents: "read" });
const SHA_PIN = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

const secretNames = (text: string): string[] =>
  [...text.matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1] ?? "").sort();

/** Pin: every `uses:` of the file is a full commit SHA with the tag in a trailing comment. */
export function pinDefects(text: string): string[] {
  const lines = text.split("\n").filter((l) => /^\s*(-\s+)?uses:/.test(l));
  const bad = lines.filter((l) => {
    const m = /uses:\s*(\S+)\s+#\s*v\d+\.\d+\.\d+\s*$/.exec(l);
    return m === null || !SHA_PIN.test(m[1] ?? "");
  });
  return [
    ...(lines.length === 0 ? ["no uses: line"] : []),
    ...bad.map((l) => `unpinned: ${l.trim()}`),
  ];
}

/** Pins shared by both workflows, for the jobs `build` and `publish`. */
export function splitDefects(doc: Doc, build: string, publish: string): string[] {
  const out: string[] = [];
  const jobs = doc.jobs ?? {};
  if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify([build, publish])) return ["job ids"];
  const b = jobs[build];
  const p = jobs[publish];
  if (JSON.stringify(b?.permissions) !== READ_ONLY) out.push("build job is not read-only");
  if (b?.environment !== undefined) out.push("build job declares an environment");
  if (p?.needs !== build) out.push("publish does not need build");
  for (const [id, job] of Object.entries(jobs)) {
    const perms = job.permissions ?? {};
    const privileged =
      job.environment !== undefined || Object.values(perms).some((v) => v === "write");
    const runs = (job.steps ?? []).map((s) => s.run ?? "").join("\n");
    if (privileged && /npm (ci|install)|build-components/.test(runs)) {
      out.push(`${id}: installs or compiles in a privileged job`);
    }
  }
  const buildRuns = (b?.steps ?? []).map((s) => s.run ?? "").join("\n");
  if (
    !/npm ci --omit=dev --ignore-scripts/.test(buildRuns) ||
    !/build-components\.ts/.test(buildRuns)
  ) {
    out.push("build job does not compile");
  }
  const pubRuns = (p?.steps ?? []).map((s) => s.run ?? "").join("\n");
  if (!/sha256sum/.test(pubRuns) || !/EXPECTED_SHA256/.test(pubRuns))
    out.push("publish job does not re-check the digest");
  const guards = (id: string): number =>
    (
      (jobs[id]?.steps ?? [])
        .map((s) => s.run ?? "")
        .join("\n")
        .match(/framework-release-guard\.ts/g) ?? []
    ).length;
  if (guards(build) !== 1 || guards(publish) !== 1) out.push("the guard does not run in both jobs");
  if (!(p?.steps ?? []).some((s) => /download-artifact/.test(s.uses ?? "")))
    out.push("publish downloads no artifact");
  if (!(b?.steps ?? []).some((s) => /upload-artifact/.test(s.uses ?? "")))
    out.push("build uploads no artifact");
  return out;
}

export function prereleaseDefects(text: string): string[] {
  const doc = load(text) as Doc;
  const out = splitDefects(
    doc,
    "release-framework-prerelease-build",
    "release-framework-prerelease",
  );
  const on = doc.on ?? {};
  if (JSON.stringify(Object.keys(on)) !== '["push"]') out.push("triggers other than push");
  if (JSON.stringify(on["push"]) !== '{"tags":["crewrig-v*-next.*"]}')
    out.push("push is not the single tag filter");
  const pub = doc.jobs?.["release-framework-prerelease"];
  if (
    JSON.stringify(pub?.permissions) !==
    JSON.stringify({ contents: "write", "id-token": "write", attestations: "write" })
  )
    out.push("permissions");
  if (JSON.stringify(doc.permissions) !== READ_ONLY) out.push("workflow default is not read-only");
  if (Object.values(doc.jobs ?? {}).some((j) => j.environment !== undefined))
    out.push("declares an environment");
  if (secretNames(text).length > 0) out.push("reads a secret");
  if (/create-github-app-token|--kind stable/.test(text)) out.push("stable credential or path");
  return out;
}

export function stableDefects(text: string): string[] {
  const doc = load(text) as Doc;
  const out = splitDefects(doc, "release-framework-stable-build", "release-framework-stable");
  if (JSON.stringify(Object.keys(doc.on ?? {})) !== '["workflow_dispatch"]')
    out.push("triggers other than workflow_dispatch");
  const pub = doc.jobs?.["release-framework-stable"];
  const withEnv = Object.entries(doc.jobs ?? {}).filter(([, j]) => j.environment !== undefined);
  if (
    JSON.stringify(withEnv.map(([id, j]) => [id, j.environment])) !==
    '[["release-framework-stable","framework-release"]]'
  ) {
    out.push("the environment is not on the publish job alone");
  }
  if (
    JSON.stringify(pub?.permissions) !==
    JSON.stringify({ contents: "read", "id-token": "write", attestations: "write" })
  )
    out.push("job permissions");
  const steps = pub?.steps ?? [];
  const at = (re: RegExp): number => steps.findIndex((s) => re.test(JSON.stringify(s)));
  const guard = at(/framework-release-guard\.ts --kind stable/);
  const mint = at(/create-github-app-token/);
  const publish = at(/framework-release-publish\.ts/);
  if (guard < 0 || mint < 0 || publish < 0 || !(guard < mint && mint < publish))
    out.push("guard, then mint, then publish");
  if (
    JSON.stringify(secretNames(text)) !== '["FRAMEWORK_RELEASE_APP_ID","FRAMEWORK_RELEASE_APP_KEY"]'
  )
    out.push("secrets");
  if (/FRAMEWORK_RELEASE/.test(JSON.stringify(steps.slice(0, mint))))
    out.push("a secret is used before the guard passes");
  if (/create-github-app-token/.test(JSON.stringify(doc.jobs?.["release-framework-stable-build"])))
    out.push("build job mints a token");
  if (!/APPROVER READ DUTY/.test(text)) out.push("header states no approver read duty");
  if (/make_latest|--latest/.test(text)) out.push("latest");
  return out;
}

export const replace = (from: string, to: string) => (t: string) => t.replace(from, to);
export type Mutant = [string, (t: string) => string, string];

export function suite(
  title: string,
  text: string,
  defects: (t: string) => string[],
  mutants: Mutant[],
): void {
  describe(title, () => {
    it("holds every pin", () => assert.deepEqual(defects(text), []));
    for (const [name, edit, defect] of mutants) {
      it(`mutant caught: ${name}`, () => {
        const bad = edit(text);
        assert.notEqual(bad, text);
        assert.ok(
          defects(bad).some((d) => d.includes(defect)),
          defects(bad).join(", "),
        );
      });
    }
  });
}

export const COMMON = (build: string, pub: string): Mutant[] => [
  [
    "build job gains a write permission",
    replace(
      "    permissions:\n      contents: read\n    env:",
      "    permissions:\n      contents: read\n      id-token: write\n    env:",
    ),
    "build job is not read-only",
  ],
  [
    "npm ci in the publish job",
    replace(
      "      - name: Download the archive",
      "      - name: Install\n        run: npm ci --omit=dev\n\n      - name: Download the archive",
    ),
    `${pub}: installs or compiles in a privileged job`,
  ],
  [
    "build-components in the publish job",
    replace(
      "      - name: Download the archive",
      "      - name: Compile\n        run: node scripts/build-components.ts\n\n      - name: Download the archive",
    ),
    `${pub}: installs or compiles in a privileged job`,
  ],
  ["no digest re-check", replace("sha256sum", "true"), "publish job does not re-check the digest"],
  ["no download", replace("download-artifact", "upload-artifact"), "publish downloads no artifact"],
  [
    "publish no longer needs build",
    replace(`    needs: ${build}\n`, ""),
    "publish does not need build",
  ],
];
