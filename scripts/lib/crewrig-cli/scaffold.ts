// scaffold.ts — `crewrig init`: the scaffold of the organization config repository (spec 0314 R14-R17,
// R20). Both refusals (exit 1) and the feedback-repository check (exit 2) are decided before anything is
// written. The scaffold is planned from the pinned version, then written with crewrig.config.toml last;
// a failure after the first write removes what this run created and exits 1.

import fs from "node:fs";
import path from "node:path";
import { renderConfig } from "./toml.ts";

const CONFIG_FILE = "crewrig.config.toml";
/** The entries the template and the forge create; any other entry refuses init (spec 0314 R14). */
const TOLERATED = [".git", "crewrig", "crewrig.pin.json", "README.md", ".gitignore", "LICENSE"];
const EMPTY_DIRS = ["artifacts/org/skills", "artifacts/org/agents", "artifacts/community/hooks"];
const COPIED_DIRS = ["config/expertise", "config/teams", "config/level"];

export interface InitRequest {
  /** The working directory, which receives the scaffold and nothing else. */
  cwd: string;
  /** The root of the pinned version, which holds the config/ templates and catalogs. */
  templateRoot: string;
  /** The normalised --feedback-repo value, when one was given. */
  feedbackRepo: string | undefined;
  /** The normalised origin repository; read only when no --feedback-repo was given. */
  originRepo: () => Promise<string | undefined>;
}

type Step =
  | { kind: "dir"; rel: string }
  | { kind: "copy"; rel: string; from: string }
  | { kind: "empty"; rel: string };

function show(name: string): string {
  return JSON.stringify(name);
}

function exists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/** The first entry of `cwd` that the template does not provide, in ascending byte order of names. */
function firstUnexpectedEntry(cwd: string): string | undefined {
  const names = fs.readdirSync(cwd).filter((name) => !TOLERATED.includes(name));
  names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return names[0];
}

/** Collect the directories and regular files beneath `absDir`, which holds catalogs of the pinned version. */
function collect(absDir: string, rel: string, steps: Step[], dirs: Set<string>): void {
  const entries = fs
    .readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  for (const entry of entries) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      addDir(childRel, steps, dirs);
      collect(path.join(absDir, entry.name), childRel, steps, dirs);
    } else if (entry.isFile()) {
      steps.push({ kind: "copy", rel: childRel, from: path.join(absDir, entry.name) });
    } else {
      throw new Error(`${childRel} is not a regular file or directory`);
    }
  }
}

/** Add a directory step, preceded by the steps of its missing parents. */
function addDir(rel: string, steps: Step[], dirs: Set<string>): void {
  const parts = rel.split("/");
  for (let index = 1; index <= parts.length; index += 1) {
    const dir = parts.slice(0, index).join("/");
    if (!dirs.has(dir)) {
      dirs.add(dir);
      steps.push({ kind: "dir", rel: dir });
    }
  }
}

/** The steps of the scaffold of R15, without crewrig.config.toml, which is written last. */
function plan(templateRoot: string): Step[] {
  const steps: Step[] = [];
  const dirs = new Set<string>();
  addDir("config", steps, dirs);
  for (const file of ["ORGANIZATION.md", "TOOLS.md"]) {
    const from = path.join(templateRoot, "config", `${file}.template`);
    if (!exists(from)) throw new Error(`config/${file}.template is absent`);
    steps.push({ kind: "copy", rel: `config/${file}`, from });
  }
  for (const dir of COPIED_DIRS) {
    addDir(dir, steps, dirs);
    collect(path.join(templateRoot, ...dir.split("/")), dir, steps, dirs);
  }
  for (const dir of EMPTY_DIRS) {
    addDir(dir, steps, dirs);
    steps.push({ kind: "empty", rel: `${dir}/.gitkeep` });
  }
  return steps;
}

/** Remove what a failed run created, last first; returns the paths that could not be removed. */
function rollback(created: string[]): string[] {
  const left: string[] = [];
  for (const target of [...created].reverse()) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      left.push(target);
    }
  }
  return left;
}

/** Write the steps, then the configuration; a failure rolls the run back (spec 0314 R20). */
function write(cwd: string, steps: Step[], config: string): number {
  const created: string[] = [];
  try {
    for (const step of steps) {
      const target = path.join(cwd, ...step.rel.split("/"));
      if (exists(target)) throw new Error(`${step.rel} already exists`);
      created.push(target);
      if (step.kind === "dir") fs.mkdirSync(target);
      else if (step.kind === "copy") fs.copyFileSync(step.from, target, fs.constants.COPYFILE_EXCL);
      else fs.writeFileSync(target, "", { flag: "wx" });
    }
    const configTarget = path.join(cwd, CONFIG_FILE);
    created.push(configTarget);
    fs.writeFileSync(configTarget, config, { flag: "wx" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const left = rollback(created);
    if (left.length === 0) {
      console.error(`crewrig init failed: ${reason}. The directory was left as it was.`);
    } else {
      console.error(
        `crewrig init failed: ${reason}. These paths could not be removed: ${left.join(", ")}`,
      );
    }
    return 1;
  }
  console.log(
    "crewrig init: scaffolded the organization config repository. Review the files, then commit them.",
  );
  return 0;
}

/** Run `crewrig init` (spec 0314 R14-R17). Returns the exit code. */
export async function runInit(request: InitRequest): Promise<number> {
  const configPath = path.join(request.cwd, CONFIG_FILE);
  if (exists(configPath)) {
    console.error(
      `crewrig init: ${CONFIG_FILE} already exists here. init runs once, in the repository created from the template; nothing was changed.`,
    );
    return 1;
  }
  const unexpected = firstUnexpectedEntry(request.cwd);
  if (unexpected !== undefined) {
    console.error(
      `crewrig init: ${show(unexpected)} is not part of the template. init runs once, in the repository created from the template; nothing was changed.`,
    );
    return 1;
  }
  const feedback = request.feedbackRepo ?? (await request.originRepo());
  if (feedback === undefined) {
    console.error(
      "crewrig init: no feedback repository. Pass --feedback-repo <url>, the repository that receives feedback on your organization's components; nothing was written.",
    );
    return 2;
  }
  let steps: Step[];
  try {
    steps = plan(request.templateRoot);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `crewrig init: the pinned version is incomplete (${reason}); nothing was written.`,
    );
    return 1;
  }
  return write(request.cwd, steps, renderConfig(feedback));
}
