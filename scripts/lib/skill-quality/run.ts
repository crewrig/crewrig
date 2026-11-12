// run.ts — discover skills, run every rule, attach severity (spec 0293 R17, R18).
//
// Severity: a skill that ships evals/evals.json is protected and every finding on it is an
// error; on any other skill a finding is a warning. Two rules are fixed: the description cap
// and an invalid evals file are always errors, and a missing evals file is always a warning.
// `strict` turns every warning into an error.
//
// Usage: const result = lintSkills(repo, yaml, names, strict).
// Exit codes: not applicable (library). Finding-line format: see `formatFinding`.

import fs from "node:fs";
import path from "node:path";

import { parseSkill } from "./frontmatter.ts";
import { citationRules, evalsRules, referenceFiles, scriptHelpRules } from "./file-rules.ts";
import { frontRules, promptRules, referenceShape } from "./text-rules.ts";
import { ALWAYS_ERROR, ALWAYS_WARNING } from "./types.ts";
import type { Finding, Raw, SkillDir, YamlNamespace } from "./types.ts";

export interface SkillResult {
  readonly name: string;
  readonly protected: boolean;
}

/** Every skill source under `artifacts/<tier>/skills/<name>/` that holds a SKILL.md, sorted by name. */
export function discover(repo: string): SkillDir[] {
  const dirs = fs
    .globSync("artifacts/*/skills/*/SKILL.md", { cwd: repo })
    .map((rel) => rel.split(path.sep).join("/").replace(/\/SKILL\.md$/, ""));
  return dirs.sort().map((rel) => ({ name: rel.split("/").pop() as string, dir: path.join(repo, rel), rel }));
}

function rawFindings(skill: SkillDir, repo: string, yaml: YamlNamespace): Raw[] {
  const skillFile = `${skill.rel}/SKILL.md`;
  const text = fs.readFileSync(path.join(skill.dir, "SKILL.md"), "utf8");
  const out: Raw[] = [
    ...frontRules(parseSkill(text, yaml), skill.name, skillFile),
    ...promptRules(text, skillFile, true),
    ...citationRules(skill, repo, text, skillFile, false),
  ];
  for (const abs of referenceFiles(skill.dir)) {
    const rel = `${skill.rel}/${path.relative(skill.dir, abs).split(path.sep).join("/")}`;
    const ref = fs.readFileSync(abs, "utf8");
    out.push(...referenceShape(ref, rel), ...promptRules(ref, rel, false), ...citationRules(skill, repo, ref, rel, true));
  }
  out.push(...evalsRules(skill, repo), ...scriptHelpRules(skill));
  return out;
}

export function lintSkills(
  repo: string,
  yaml: YamlNamespace,
  skills: readonly SkillDir[],
  strict: boolean,
): { findings: Finding[]; skills: SkillResult[] } {
  const findings: Finding[] = [];
  const results: SkillResult[] = [];
  for (const skill of skills) {
    const isProtected = fs.existsSync(path.join(skill.dir, "evals", "evals.json"));
    results.push({ name: skill.name, protected: isProtected });
    for (const raw of rawFindings(skill, repo, yaml)) {
      const error =
        strict || ALWAYS_ERROR.has(raw.rule) || (isProtected && !ALWAYS_WARNING.has(raw.rule));
      findings.push({ ...raw, skill: skill.name, severity: error ? "error" : "warning" });
    }
  }
  return { findings, skills: results };
}

export function formatFinding(f: Finding): string {
  const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
  return `${f.severity === "error" ? "ERROR" : "WARN "} ${where} [${f.rule}] ${f.message}`;
}
