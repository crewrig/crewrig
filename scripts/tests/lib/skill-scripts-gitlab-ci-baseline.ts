// skill-scripts-gitlab-ci-baseline.ts — golden files of the UNMODIFIED check-pinned-images.ts and
// check-secrets-exposure.ts (spec 0301 R8, R9, R14). They were captured with `--regen` from the
// scripts as they stood before ticket #1940 edited them, and committed alone, so that the
// additive `--help` / `--json` edits are proven against a baseline the edit could not influence.
// The inputs are the case tables of the spec 0258 oracle (every argument form the scripts accept);
// the stored form is the one of skill-scripts-golden.ts, under a root of its own.
//
// Regenerating is a deliberate act that REPLACES the proof: only do it from a script that is
// known to be unmodified (`node scripts/tests/lib/skill-scripts-gitlab-ci-baseline.ts --regen`).

import fs from "node:fs";
import path from "node:path";

import { CHECK_PINNED_IMAGES } from "./skill-scripts-cases-gitlab-images.ts";
import { CHECK_SECRETS_EXPOSURE } from "./skill-scripts-cases-gitlab-secrets.ts";
import { goldenFiles, type GoldenFiles } from "./skill-scripts-golden.ts";
import { observe, type SkillCase } from "./skill-scripts-observe.ts";

export const BASELINE_ROOT = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "skill-scripts-baseline-0301",
);

/**
 * Argument forms that sit next to the flags 0301 adds and must keep their legacy behaviour: a flag
 * that is not the sole argument, a short form, and (secrets only) `--json`, which is never added.
 */
const CI_OK = "build:\n  image: node@sha256:" + "0123456789abcdef".repeat(4) + "\n";
const extra = (script: string, name: string, args: string[]): SkillCase => ({
  name: `arg-form-${name}`,
  script,
  args,
  files: { "ci.yml": CI_OK },
});
const EXTRA_FORMS = (script: string): SkillCase[] => [
  extra(script, "help-then-file", ["--help", "ci.yml"]),
  extra(script, "file-then-help", ["ci.yml", "--help"]),
  extra(script, "short-help", ["-h"]),
];

export const BASELINE_SCRIPTS: readonly { script: string; cases: readonly SkillCase[] }[] = [
  {
    script: "gitlab-ci/check-pinned-images",
    cases: [...CHECK_PINNED_IMAGES, ...EXTRA_FORMS("gitlab-ci/check-pinned-images")],
  },
  {
    script: "gitlab-ci/check-secrets-exposure",
    cases: [
      ...CHECK_SECRETS_EXPOSURE,
      ...EXTRA_FORMS("gitlab-ci/check-secrets-exposure"),
      extra("gitlab-ci/check-secrets-exposure", "json-then-file", ["--json", "ci.yml"]),
      extra("gitlab-ci/check-secrets-exposure", "json-alone", ["--json"]),
    ],
  },
];

export const baselineDir = (c: Pick<SkillCase, "script" | "name">): string =>
  path.join(BASELINE_ROOT, ...c.script.split("/"), c.name);

export function readBaseline(c: Pick<SkillCase, "script" | "name">): GoldenFiles {
  const out: GoldenFiles = new Map();
  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), at);
      else out.set(at, fs.readFileSync(path.join(dir, e.name)).toString("latin1"));
    }
  };
  walk(baselineDir(c), "");
  return out;
}

export function observeLegacy(c: SkillCase): GoldenFiles {
  return goldenFiles(observe(c, "entry"));
}

if (process.argv[2] === "--regen") {
  const only = process.argv[3] === "--only" ? process.argv[4] : undefined;
  if (only === undefined) fs.rmSync(BASELINE_ROOT, { recursive: true, force: true });
  for (const { cases } of BASELINE_SCRIPTS)
    for (const c of cases.filter((k) => only === undefined || k.name.startsWith(only)))
      for (const [rel, content] of observeLegacy(c)) {
        const file = path.join(baselineDir(c), ...rel.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(content, "latin1"));
      }
  console.log(`baseline written under ${BASELINE_ROOT}`);
}
