// skill-scripts-secrets-engine.ts — shared pieces of the tests of the secrets-exposure engine (spec
// 0303 R6 to R8, R13): the three byte copies, the drift comparison, and the legacy cases whose goldens
// (fixtures/skill-scripts/security-0303/legacy/) were taken from the unmodified scripts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { goldenFiles, type GoldenFiles } from "./skill-scripts-golden.ts";
import { observe, SKILLS_ROOT, type SkillCase } from "./skill-scripts-observe.ts";

export const COPIES = ["security", "github-actions", "gitlab-ci"].map((skill) => ({
  skill,
  file: path.join(SKILLS_ROOT, skill, "scripts", "check-secrets-exposure.ts"),
}));

/** The one line that may differ between the copies: the default platform of the copy. */
const MARKED =
  /^(\s*const defaultPlatform = \(\): string \| undefined => )(.*)(; \/\/ crewrig:default-platform)$/;

export interface Copy {
  name: string;
  text: string;
}

/** Where the copies first differ outside the marked line, as `<name>:<line>`, or undefined. */
export function firstDrift(copies: readonly Copy[]): string | undefined {
  const rows = copies.map((c) => c.text.split("\n").map((l) => l.replace(MARKED, "$1<default>$3")));
  const [head, ...rest] = rows;
  for (const [i, other] of rest.entries()) {
    const n = Math.max(head?.length ?? 0, other.length);
    for (let line = 0; line < n; line++)
      if (head?.[line] !== other[line]) return `${copies[i + 1]?.name}:${line + 1}`;
  }
  return undefined;
}

/** The value written on the marked line of a copy (`undefined` literal, or a quoted name). */
export function defaultOf(text: string): string | undefined {
  const marked = text.split("\n").filter((l) => MARKED.test(l));
  if (marked.length !== 1) return undefined;
  return MARKED.exec(marked[0] ?? "")?.[2];
}

export const LEGACY_ROOT = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "skill-scripts",
  "security-0303",
  "legacy",
);

const GH =
  "name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n";
const GL = "variables:\n  PASSWORD: hunter2\nbuild:\n  script:\n    - make\n";

/** Written at test time (no committed JS file): makes the file named by UNREADABLE mode 000 for the run. */
export function unreadablePreload(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "unreadable-")), "preload.cjs");
  fs.writeFileSync(
    file,
    'const fs = require("fs");\nconst f = process.env.UNREADABLE;\n' +
      'if (f) { fs.chmodSync(f, 0o000); process.on("exit", () => { try { fs.chmodSync(f, 0o644); } catch {} }); }\n',
  );
  return file;
}

export interface LegacyCase {
  platform: "github" | "gitlab";
  case: SkillCase;
}

export function legacyCases(preload: string): LegacyCase[] {
  const un = { UNREADABLE: "x", NODE_OPTIONS: `--require ${preload}` };
  const mk = (
    platform: "github" | "gitlab",
    name: string,
    args: string[],
    files: Record<string, string>,
    env?: Record<string, string>,
  ): LegacyCase => ({
    platform,
    case: {
      name,
      script: `${platform === "github" ? "github-actions" : "gitlab-ci"}/check-secrets-exposure`,
      args,
      files,
      ...(env === undefined ? {} : { env }),
    },
  });
  return [
    mk("github", "help-alone", ["--help"], {}),
    mk("github", "help-then-file", ["--help", "wf.yml"], { "wf.yml": GH }),
    mk("github", "file-then-help", ["wf.yml", "--help"], { "wf.yml": GH }),
    mk("github", "short-help", ["-h"], {}),
    mk("github", "json-alone", ["--json"], {}),
    mk("github", "json-then-file", ["--json", "wf.yml"], { "wf.yml": GH }),
    mk("github", "unreadable-file", ["x"], { x: GH }, un),
    mk("github", "non-ascii-path", ["dépôt/flux-é.yml"], { "dépôt/flux-é.yml": GH }),
    mk("gitlab", "unreadable-file", ["x"], { x: GL }, un),
    mk("gitlab", "non-ascii-path", ["dépôt/flux-é.yml"], { "dépôt/flux-é.yml": GL }),
  ];
}

export function readLegacy(platform: string, name: string): GoldenFiles {
  const out: GoldenFiles = new Map();
  const dir = path.join(LEGACY_ROOT, platform, name);
  const walk = (d: string, rel: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const at = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(d, e.name), at);
      else out.set(at, fs.readFileSync(path.join(d, e.name)).toString("latin1"));
    }
  };
  walk(dir, "");
  return out;
}

export const observeLegacy = (c: SkillCase): GoldenFiles => goldenFiles(observe(c, "entry"));
