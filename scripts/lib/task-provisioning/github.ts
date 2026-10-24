// github.ts — checks (a) and (c) of the Task provisioning guard (spec 0282 R6): every GitHub job
// that needs Task uses the composite action after its checkout and installs it no other way, and
// the action keeps its fail-closed elements.

import fs from "node:fs";

import { get, parse } from "../yq-accessors/index.ts";
import { jobNode, loadJobs, readJob } from "../ci-parity/job-records.ts";
import type { ParityState } from "../ci-parity/state.ts";

export const ACTION_USES = "./.github/actions/setup-task";

const OTHER_ROUTES: readonly RegExp[] = [
  /taskfile\.dev/,
  /go-task/,
  /install\.sh/,
  /sh -c "?\$\(curl/,
  /\b(brew|choco|scoop)\b[^\n]*\btask\b/,
  /\bnpm\b[^\n]*\b(install|i)\b[^\n]*\btask\b/,
];
const TASK_INVOCATION = /(^|\n|[;&|]\s*)task\s+\S/;

/** Checks (a): one finding per offending GitHub job. */
export function checkGithubJobs(state: ParityState): string[] {
  const out: string[] = [];
  const needs = new Set(state.caps.filter((c) => c.tools.includes("task")).map((c) => c.id));
  for (const j of state.ghaJobs) {
    const jobs = loadJobs(j.workflow);
    const node = jobNode(jobs, j.jobKey);
    if (node === null) continue;
    const rec = readJob(node);
    const where = `job '${j.jobKey}' (${j.workflow.replace(`${state.repoDir}/`, "")})`;
    const needsTask = needs.has(j.id) || rec.steps.some((s) => TASK_INVOCATION.test(s.run));
    for (const s of rec.steps)
      if (OTHER_ROUTES.some((re) => re.test(s.run)))
        out.push(`${where}: a step installs Task by a route other than ${ACTION_USES} (R6a)`);
    if (!needsTask) continue;
    const setups = rec.steps.map((s, i) => [s, i] as const).filter(([s]) => s.uses === ACTION_USES);
    const checkout = rec.steps.findIndex((s) => s.uses.includes("/checkout@"));
    if (setups.length !== 1)
      out.push(
        `${where}: needs Task but has ${setups.length} '${ACTION_USES}' steps, want exactly one (R6a)`,
      );
    else if (checkout < 0 || (setups[0] as readonly [unknown, number])[1] < checkout)
      out.push(`${where}: '${ACTION_USES}' must come after the actions/checkout step (R6a)`);
  }
  return out;
}

/** Checks (c): the composite action keeps checksum verification, version check, no fail-open. */
export function checkAction(repoDir: string): string[] {
  const file = `${repoDir}/.github/actions/setup-task/action.yml`;
  const where = ".github/actions/setup-task/action.yml";
  let text: string;
  let runs: ReturnType<typeof readJob>;
  try {
    text = fs.readFileSync(file, "utf8");
    runs = readJob(get(parse(text), ["runs"]));
  } catch {
    return [`${where}: missing or unreadable composite action (R6c)`];
  }
  const body = runs.steps.map((s) => s.run).join("\n");
  const out: string[] = [];
  if (!/sha256sum|shasum -a 256/.test(body)) out.push(`${where}: no SHA-256 verification (R6c)`);
  if (!/--version/.test(body)) out.push(`${where}: no 'task --version' check (R6c)`);
  if (!/set -euo pipefail/.test(body)) out.push(`${where}: missing 'set -euo pipefail' (R6c)`);
  if (/\|\|\s*true/.test(body)) out.push(`${where}: contains '|| true' (R6c)`);
  if (/continue-on-error/.test(text)) out.push(`${where}: contains 'continue-on-error' (R6c)`);
  return out;
}
