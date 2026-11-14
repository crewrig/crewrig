// file-rules.ts — the rules that look at files around SKILL.md: cited paths, reference depth,
// the evals file and the bundled scripts' `--help` (spec 0293 R7, R9, R10, R12).
//
// Usage: import { citationRules, evalsRules, scriptHelpRules } from "./file-rules.ts".
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validateEvals, formatViolation } from "../skill-evals/schema.ts";
import { citations, sharedTopic } from "../skill-citations/grammar.ts";
import { evalWarnings } from "./eval-rules.ts";
import type { Raw, SkillDir } from "./types.ts";

export const MIN_EVALS = 3;
export const MIN_PROBES = 5;
export const MIN_SHARE = 0.4;
export const HELP_TIMEOUT_MS = 10_000;

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Every `.md` file under `<dir>/references`, absolute paths, sorted. */
export function referenceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(d).sort();
    } catch {
      return;
    }
    for (const n of names) {
      const full = path.join(d, n);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (n.endsWith(".md")) out.push(full);
    }
  };
  walk(path.join(dir, "references"));
  return out;
}

/**
 * Cited paths resolve (R9, R12) and a reference does not cite another reference (R9 depth).
 * `text` is the file's text, `isReference` says whether it is a file under `references/`.
 */
export function citationRules(
  skill: SkillDir,
  repo: string,
  text: string,
  file: string,
  isReference: boolean,
): Raw[] {
  const out: Raw[] = [];
  for (const c of citations(text, !isReference)) {
    const topic = sharedTopic(c.path);
    const resolved =
      topic !== undefined
        ? isFile(path.join(repo, "artifacts", "core", "shared", "references", `${topic}.md`))
        : isFile(path.join(skill.dir, c.path));
    if (!resolved)
      out.push({
        rule: "citation-unresolved",
        message: `cited path ${c.path} does not exist${topic === undefined ? "" : " and no shared source exists for it"}`,
        file,
        line: c.line,
      });
    else if (
      isReference &&
      c.path.startsWith("references/") &&
      path.join(skill.dir, c.path) !== path.join(repo, file)
    )
      out.push({
        rule: "reference-depth",
        message: `reference cites ${c.path}; references stay one level deep, so cite it from SKILL.md instead`,
        file,
        line: c.line,
      });
  }
  return out;
}

/** The evals file: schema through the runner's validator, then the minimums of R7. */
export function evalsRules(skill: SkillDir, repo: string): Raw[] {
  const abs = path.join(skill.dir, "evals", "evals.json");
  const file = `${skill.rel}/evals/evals.json`;
  if (!isFile(abs))
    return [
      {
        rule: "evals-missing",
        message: "the skill ships no evals/evals.json; add at least 3 evals and 5 trigger probes",
        file,
      },
    ];
  const { violations, evals } = validateEvals(fs.readFileSync(abs, "utf8"), {
    file,
    skillDir: skill.dir,
    skillName: skill.name,
  });
  const out: Raw[] = violations.map((v) => ({
    rule: "evals-invalid",
    message: formatViolation(v),
    file,
  }));
  void repo;
  if (evals === undefined) return out;
  out.push(...evalWarnings(skill, evals, file));
  const probes = evals.trigger_probes;
  const positive = probes.filter((p) => p.should_trigger).length;
  const share = probes.length === 0 ? 0 : positive / probes.length;
  const min = (message: string): number => out.push({ rule: "evals-minimum", message, file });
  if (evals.evals.length < MIN_EVALS)
    min(`${evals.evals.length} evals; the minimum is ${MIN_EVALS}`);
  if (probes.length < MIN_PROBES)
    min(`${probes.length} trigger probes; the minimum is ${MIN_PROBES}`);
  else if (share < MIN_SHARE || 1 - share < MIN_SHARE)
    min(
      `${positive} positive and ${probes.length - positive} negative probes; each kind must be at least ${MIN_SHARE * 100} percent`,
    );
  return out;
}

function helpCommand(file: string): { cmd: string; args: string[] } | undefined {
  if (/\.(?:ts|js|mjs)$/.test(file))
    return {
      cmd: process.execPath,
      args: ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", file, "--help"],
    };
  if (file.endsWith(".py")) return { cmd: "python3", args: [file, "--help"] };
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return { cmd: path.resolve(file), args: ["--help"] };
  } catch {
    return undefined;
  }
}

/** Every file directly under scripts/ answers `--help` with a usage on stdout and exit 0 (R10). */
export function scriptHelpRules(skill: SkillDir): Raw[] {
  const out: Raw[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(skill.dir, "scripts")).sort();
  } catch {
    return out;
  }
  for (const n of names) {
    const rel = `scripts/${n}`;
    const file = `${skill.rel}/${rel}`;
    if (!isFile(path.join(skill.dir, rel))) continue;
    const how = helpCommand(rel);
    if (how === undefined) continue;
    const r = spawnSync(how.cmd, how.args, {
      cwd: skill.dir,
      encoding: "utf8",
      timeout: HELP_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const err = r.error as NodeJS.ErrnoException | undefined;
    if (err !== undefined && err.code === "ENOENT")
      out.push({
        rule: "script-help-skipped",
        message: `${rel} was not run: ${how.cmd} is not installed here`,
        file,
      });
    else if (err !== undefined)
      out.push({
        rule: "script-help",
        message: `${rel} --help did not finish within ${HELP_TIMEOUT_MS / 1000} seconds`,
        file,
      });
    else if (r.status !== 0)
      out.push({
        rule: "script-help",
        message: `${rel} --help exited ${r.status}; it must print its usage on stdout and exit 0`,
        file,
      });
    else if (r.stdout.trim() === "")
      out.push({
        rule: "script-help",
        message: `${rel} --help printed nothing on stdout; print the usage there`,
        file,
      });
  }
  return out;
}
