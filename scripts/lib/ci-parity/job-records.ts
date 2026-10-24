// job-records.ts — the per-job step records Arm 1 and the path filters read (the shell's
// JOB_* globals, filled by one yq pass per workflow file). Reads the loaded node directly.

import fs from "node:fs";

import {
  get,
  isYqFalsy,
  keys,
  length,
  parse,
  render,
  tag,
  YqMap,
  YqSeq,
  type YqNode,
} from "../yq-accessors/index.ts";
import { ParityGap } from "./state.ts";

export interface StepRecord {
  uses: string;
  run: string;
  fetchDepth: string;
  nodeVersion: string;
  pythonVersion: string;
  key: string;
  /** `with.id` and `with.task` of a `./.github/actions/ci-job` step (spec 0049 delta-02 R27). */
  withId: string;
  withTask: string;
  withNode: string;
  withCache: string;
  withInstall: string;
  /** `with.yq` of a ci-job step: the pinned yq version, empty when none is installed. */
  withYq: string;
  /** `with.apt` and `with.python` of a ci-job step: explicit apt packages and a Python version. */
  withApt: string;
  withPython: string;
}

export interface JobRecord {
  nsteps: number;
  steps: StepRecord[];
  env: string[];
  stepEnv: string[];
}

const gap = (what: string): ParityGap =>
  new ParityGap(`${what} is not supported by the TypeScript reader`);

/** `$(yq -r 'EXPR // ""')`: falsy -> "", trailing line feeds stripped. */
function text(n: YqNode, what: string): string {
  if (isYqFalsy(n)) return "";
  if (n instanceof YqMap || n instanceof YqSeq) throw gap(`a collection for ${what}`);
  return render(n).replace(/\n+$/, "");
}

/** Like `text`, but a YAML `false` stays "false" (the `// ""` falsy rule would blank it). */
function rawText(n: YqNode, what: string): string {
  if (n === null || n instanceof YqMap || n instanceof YqSeq) return text(n, what);
  return render(n);
}

function at(n: YqNode, path: string[]): YqNode {
  try {
    return get(n, path);
  } catch {
    throw gap(`indexing a scalar at .${path.join(".")}`);
  }
}

function envKeys(env: YqNode): string[] {
  if (isYqFalsy(env)) return [];
  return env instanceof YqMap || env instanceof YqSeq ? keys(env) : [];
}

function readStep(step: YqNode): StepRecord {
  if (step instanceof YqSeq) throw gap("a sequence step");
  const withNode = at(step, ["with"]);
  if (withNode instanceof YqSeq) throw gap("a sequence `with`");
  return {
    uses: text(at(step, ["uses"]), "uses"),
    run: text(at(step, ["run"]), "run"),
    fetchDepth: text(at(withNode, ["fetch-depth"]), "with.fetch-depth"),
    nodeVersion: text(at(withNode, ["node-version"]), "with.node-version"),
    pythonVersion: text(at(withNode, ["python-version"]), "with.python-version"),
    key: text(at(withNode, ["key"]), "with.key"),
    withId: text(at(withNode, ["id"]), "with.id"),
    withTask: rawText(at(withNode, ["task"]), "with.task"),
    withNode: text(at(withNode, ["node"]), "with.node"),
    withCache: text(at(withNode, ["cache"]), "with.cache"),
    withInstall: text(at(withNode, ["install"]), "with.install"),
    withYq: text(at(withNode, ["yq"]), "with.yq"),
    withApt: text(at(withNode, ["apt"]), "with.apt"),
    withPython: text(at(withNode, ["python"]), "with.python"),
  };
}

export function readJob(job: YqNode): JobRecord {
  if (job instanceof YqSeq) throw gap("a sequence job");
  const steps = at(job, ["steps"]);
  const recs = steps instanceof YqSeq ? steps.items.map(readStep) : [];
  const bad =
    steps instanceof YqSeq &&
    steps.items.some((s) => {
      const e = at(s, ["env"]);
      return !isYqFalsy(e) && !(e instanceof YqMap || e instanceof YqSeq);
    });
  const stepEnv: string[] = [];
  if (steps instanceof YqSeq && !bad)
    for (const s of steps.items) stepEnv.push(...envKeys(at(s, ["env"])));
  return {
    nsteps: isYqFalsy(steps) ? 0 : length(steps),
    steps: recs,
    env: envKeys(at(job, ["env"])),
    stepEnv,
  };
}

/** The `jobs` mapping node of a workflow file (null when unreadable or absent). */
export function loadJobs(file: string): YqNode {
  try {
    return get(parse(fs.readFileSync(file, "utf8")), ["jobs"]);
  } catch {
    return null;
  }
}

export function jobNode(jobs: YqNode, key: string): YqNode {
  if (!(jobs instanceof YqMap)) return null;
  return jobs.entries.find(([k]) => k === key)?.[1] ?? null;
}

export { tag };
