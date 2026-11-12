// select.ts — skill discovery and changed-skill selection (spec 0290 R16, R17, R34).
//
// Skill roots are `artifacts/*/skills/*/` only: the compiled mirrors (`.claude/skills/`,
// `.gemini/skills/`, `.github/skills/`, `.agents/skills/`) are never roots, so a mirror-only
// change selects nothing. `selectChanged` selects the skills whose content hash differs between
// the working tree and the merge-base of HEAD with the base ref, or that do not exist at the
// merge-base; a change confined to `evals/results.json` or any unhashed file selects nothing. The
// attestation check and `--changed` both use it, so their selected sets are equal for one base.
//
// Usage: selectChanged(repoRoot, "origin/main"). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

import { runGit } from "../governance/git-run.ts";
import { contentHash, readRevision, readWorkingTree } from "./hash.ts";
import type { Snapshot } from "./hash.ts";

export interface SkillRef {
  readonly name: string;
  readonly layer: string;
  /** Repository-relative directory, `/` separators. */
  readonly dirRel: string;
  readonly dirAbs: string;
}

export interface Selection {
  readonly skill: SkillRef;
  readonly head: Snapshot;
  /** True when the skill does not exist at the merge-base (or cannot be read there). */
  readonly isNew: boolean;
  readonly headHash?: string;
  readonly baseHash?: string;
  /** `evals/results.json` as committed at the merge-base, for the regression comparison (R19). */
  readonly baseResultsText?: string;
}

export function listSkills(repoRoot: string): SkillRef[] {
  const out: SkillRef[] = [];
  const artifacts = path.join(repoRoot, "artifacts");
  let layers: string[] = [];
  try {
    layers = fs.readdirSync(artifacts).sort();
  } catch {
    return out;
  }
  for (const layer of layers) {
    const skillsDir = path.join(artifacts, layer, "skills");
    let names: string[] = [];
    try {
      names = fs.readdirSync(skillsDir).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const dirAbs = path.join(skillsDir, name);
      if (fs.existsSync(path.join(dirAbs, "SKILL.md")))
        out.push({ name, layer, dirRel: `artifacts/${layer}/skills/${name}`, dirAbs });
    }
  }
  return out;
}

/** Find one skill by directory name; an error when unknown or present in two layers. */
export function findSkill(repoRoot: string, name: string): { skill: SkillRef } | { error: string } {
  const hits = listSkills(repoRoot).filter((s) => s.name === name);
  if (hits.length === 0) return { error: `unknown skill: ${name}` };
  if (hits.length > 1)
    return { error: `skill name ${name} is ambiguous: ${hits.map((h) => h.dirRel).join(" and ")}` };
  return { skill: hits[0] as SkillRef };
}

export function mergeBase(repoRoot: string, baseRef: string): string | undefined {
  const r = runGit(["merge-base", "HEAD", baseRef], { cwd: repoRoot });
  const sha = r.stdout.toString("utf8").trim();
  return r.status === 0 && sha !== "" ? sha : undefined;
}

/** The skill's `evals/results.json` as committed at `rev` (`git show`); undefined when absent there. */
export function readBaseResults(
  repoRoot: string,
  rev: string,
  skillDirRel: string,
): string | undefined {
  const r = runGit(["show", `${rev}:${skillDirRel}/evals/results.json`], { cwd: repoRoot });
  return r.status === 0 ? r.stdout.toString("utf8") : undefined;
}

/** Load the head snapshot of one skill and the comparison facts the planner needs. */
export function describeSkill(
  repoRoot: string,
  skill: SkillRef,
  base: string | undefined,
): Selection {
  const head = readWorkingTree(repoRoot, skill.dirRel);
  const baseSnap: Snapshot =
    base === undefined ? { kind: "absent" } : readRevision(repoRoot, base, skill.dirRel);
  const isNew = baseSnap.kind !== "ok";
  if (head.kind !== "ok") return { skill, head, isNew };
  const baseHash = baseSnap.kind === "ok" ? contentHash(baseSnap.files) : undefined;
  const baseResultsText =
    base === undefined || isNew ? undefined : readBaseResults(repoRoot, base, skill.dirRel);
  return {
    skill,
    head,
    isNew,
    headHash: contentHash(head.files),
    ...(baseHash !== undefined ? { baseHash } : {}),
    ...(baseResultsText !== undefined ? { baseResultsText } : {}),
  };
}

export function isChanged(sel: Selection): boolean {
  return sel.head.kind !== "ok" || sel.isNew || sel.baseHash !== sel.headHash;
}

export type ChangedResult = { selections: Selection[] } | { error: string };

export function selectChanged(repoRoot: string, baseRef: string): ChangedResult {
  const base = mergeBase(repoRoot, baseRef);
  if (base === undefined) return { error: `cannot compute the merge-base of HEAD with ${baseRef}` };
  const selections: Selection[] = [];
  for (const skill of listSkills(repoRoot)) {
    const sel = describeSkill(repoRoot, skill, base);
    if (isChanged(sel)) selections.push(sel);
  }
  return { selections };
}
