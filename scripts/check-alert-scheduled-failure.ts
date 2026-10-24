// check-alert-scheduled-failure.ts — static wiring check of the `alert` job (spec 0284 R6).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-alert-scheduled-failure.ts [workflow] [taskfile]
// Exit: 0 wired, 1 one or more elements missing or extra (each named on stderr).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { get, keys, parse, render, resolve, YqMap, YqSeq } from "./lib/yq-accessors/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowPath = process.argv[2] ?? `${root}.github/workflows/changeset-coverage.yml`;
const taskfilePath = process.argv[3] ?? `${root}taskfiles/ci.yml`;
const TASK = "ci:alert-scheduled-failure";

export function check(workflowText: string, taskfileText: string): string[] {
  const out: string[] = [];
  const doc = parse(workflowText);
  const job = (...p: string[]) => get(doc, ["jobs", "alert", ...p]);
  if (!(resolve(job()) instanceof YqMap)) return ["job 'alert' is missing"];
  if (render(job("needs")) !== "changeset-coverage") out.push("needs must be changeset-coverage");
  if (render(job("if")) !== "failure() && github.event_name == 'schedule'")
    out.push("if must be failure() && github.event_name == 'schedule'");
  const perms = resolve(job("permissions"));
  const granted =
    perms instanceof YqMap
      ? keys(perms)
          .map((k) => `${k}:${render(get(perms, [k]))}`)
          .sort()
          .join(",")
      : "";
  if (granted !== "contents:read,issues:write")
    out.push(`permissions must be contents: read + issues: write only (got '${granted}')`);
  const steps = resolve(job("steps"));
  const items = steps instanceof YqSeq ? steps.items : [];
  const runs = items.map((s) => render(get(s, ["run"]))).map((r) => (r === "null" ? "" : r));
  const node = items.find((s) => render(get(s, ["uses"])).startsWith("actions/setup-node@"));
  if (!node || render(get(node, ["with", "node-version"])) !== "24")
    out.push("setup-node must use node-version 24");
  const idx = (needle: string) => runs.findIndex((r) => r.includes(needle));
  if (idx("npm ci --omit=dev --workspaces=false") < 0)
    out.push("missing npm ci --omit=dev --workspaces=false");
  const guard = idx("node scripts/lib/node-floor-guard.js");
  const call = idx(`task ${TASK}`);
  if (guard < 0) out.push("missing node floor guard");
  if (call < 0) out.push(`missing call to task ${TASK}`);
  else if (guard > call) out.push("floor guard must run before the task call");
  if (workflowText.includes("secrets.")) out.push("workflow must not reference secrets.");
  const taskName = TASK.slice("ci:".length);
  if (!keys(get(parse(taskfileText), ["tasks"])).includes(taskName))
    out.push(`task ${TASK} does not exist in taskfiles/ci.yml`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = check(readFileSync(workflowPath, "utf8"), readFileSync(taskfilePath, "utf8"));
  for (const f of findings) process.stderr.write(`check-alert-scheduled-failure: ${f}\n`);
  if (findings.length === 0) process.stdout.write("OK: the alert job is wired as specified\n");
  process.exitCode = findings.length === 0 ? 0 : 1;
}
