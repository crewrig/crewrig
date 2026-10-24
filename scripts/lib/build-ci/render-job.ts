// render-job.ts — emits one GitLab job (and its `rules:`) for one portable capability,
// twin of `emit_job` / `emit_rules` in the retired scripts/build-ci.sh (spec 0262).

import { Capability } from "./reference.ts";
import { blockItem, dqEntry, dqItem, nonEmptyLines } from "./render-yaml.ts";
import {
  runtimeToImage,
  secondaryRuntimeInstallLines,
  toolInstallLines,
  type TaskPin,
  BuildCiError,
} from "./tools.ts";

/** A command the cache guard wraps: a `bash scripts/` suite or a former forwarding-shim tool. */
const GUARDED_COMMAND =
  /^(?:bash scripts\/|node (?:--disable-warning=\S+ )?scripts\/(?:build-ci|build-components|check-agent-profiles|check-ci-parity|check-model-mappings|check-spec-id-reserved|ci-cache-guard|ci-changeset-coverage|reserve-spec-id)\.ts(?: |$))/;

const CONDITIONS: Readonly<Record<string, string>> = {
  "pull-request": '$CI_PIPELINE_SOURCE == "merge_request_event"',
  push: '$CI_PIPELINE_SOURCE == "push"',
  tag: "$CI_COMMIT_TAG",
  scheduled: '$CI_PIPELINE_SOURCE == "schedule"',
  manual: "",
};

/** A neutral branch glob as a GitLab regex alternative (`/` escaped for the `/…/` form). */
function branchRegex(b: string): string {
  const re = b.includes("**") ? `^${b.endsWith("**") ? b.slice(0, -2) : b}` : `^${b}$`;
  return re.replaceAll("/", "\\/");
}

function emitRules(cap: Capability, id: string, out: string[]): void {
  out.push("  rules:");
  for (let i = 0; i < cap.triggerCount; i++) {
    const kind = cap.triggerKind(i);
    if (!Object.hasOwn(CONDITIONS, kind)) {
      throw new BuildCiError(`Error: capability '${id}' has unknown trigger kind '${kind}'.`);
    }
    let cond = CONDITIONS[kind] as string;
    const regex = nonEmptyLines(cap.triggerBranches(i)).map(branchRegex).join("|");
    if (regex !== "") {
      const branchVar =
        kind === "pull-request" ? "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" : "$CI_COMMIT_BRANCH";
      cond = `${cond} && ${branchVar} =~ /${regex}/`;
    }
    const tagPattern = cap.triggerTagPattern(i);
    if (tagPattern !== "" && tagPattern !== "null")
      cond = `${cond} && $CI_COMMIT_TAG =~ /${tagPattern}/`;
    if (cond.startsWith(" && ")) cond = cond.slice(4);

    if (cond !== "") out.push(`    - if: '${cond}'`);
    else if (kind === "manual") out.push("    - when: manual");

    const paths = nonEmptyLines(cap.triggerPaths(i));
    if (cap.triggerPaths(i) !== "") {
      out.push("      changes:", ...paths.map((p) => `        - "${p}"`));
    }
    if (kind === "manual" && cond !== "") out.push("      when: manual");
  }
}

/** The lines of one job, starting with the blank separator. */
export function emitJob(cap: Capability, pin: TaskPin): string[] {
  const id = cap.id;
  const runtimes = cap.runtimes;
  const nl = runtimes.indexOf("\n");
  const primary = nl < 0 ? runtimes : runtimes.slice(0, nl);
  const secondary = nl < 0 ? "" : runtimes.slice(nl + 1);
  const out = ["", `${id}:`, `  image: ${runtimeToImage(primary)}`];

  const depthFull = cap.historyDepth === "full";
  const envKeys = cap.envKeys;
  if (depthFull || envKeys !== "") {
    out.push("  variables:");
    if (depthFull) out.push('    GIT_DEPTH: "0"');
    for (const ek of nonEmptyLines(envKeys)) out.push(dqEntry(4, ek, cap.envValue(ek)));
  }

  const before: string[] = [];
  for (const sr of nonEmptyLines(secondary)) before.push(...secondaryRuntimeInstallLines(sr));
  for (const t of nonEmptyLines(cap.tools)) before.push(...toolInstallLines(t, pin));
  if (before.length > 0) out.push("  before_script:", ...before.map((l) => `    - ${l}`));

  const cacheFiles = cap.cacheFiles;
  const cacheEnv = cap.cacheEnv;
  let guard = cap.cacheGuard;
  if (guard === "") guard = "true";
  if (cacheFiles !== "") {
    out.push(
      "  cache:",
      "    key:",
      "      files:",
      ...nonEmptyLines(cacheFiles).map((f) => dqItem(8, f)),
    );
    out.push("    paths:", "      - .ci-cache/");
  }

  out.push("  script:");
  for (let j = 0; j < cap.commandCount; j++) {
    const cmd = cap.command(j);
    if (cmd.includes("\n")) {
      out.push(...blockItem(cmd));
      continue;
    }
    let emitted = cmd;
    if (cacheFiles !== "" && guard !== "false" && GUARDED_COMMAND.test(cmd)) {
      const files = cacheFiles.replaceAll("\n", ",");
      const env = cacheEnv.replaceAll("\n", ",");
      emitted = `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --cache-dir .ci-cache --key-files "${files}" --key-env "${env}" -- ${cmd}`;
    }
    out.push(dqItem(4, emitted));
  }

  emitRules(cap, id, out);
  return out;
}
