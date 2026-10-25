// render-job.ts — emits one GitLab job (and its `rules:`) for one portable capability,
// twin of `emit_job` / `emit_rules` in the retired scripts/build-ci.sh (spec 0262).

import { Capability } from "./reference.ts";
import { blockItem, dqEntry, dqItem, nonEmptyLines } from "./render-yaml.ts";
import {
  runtimeToImage,
  installLines,
  secondaryRuntimeInstallLines,
  taskRecipe,
  toolInstallLines,
  repoYqPins,
  type YqPin,
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

/**
 * One job's repeated lists: a list that appears twice (the cache key files and a `changes:`, or
 * the `changes:` of two rules) is emitted once under a YAML anchor and then aliased (spec 0283
 * R4). Anchor names are unique per job, built only from `[A-Za-z0-9_-]`.
 */
class ListAnchors {
  private readonly counts = new Map<string, number>();
  private readonly names = new Map<string, string>();
  private readonly prefix: string;
  constructor(id: string) {
    this.prefix = id.replace(/[^A-Za-z0-9_-]/g, "_");
  }
  count(list: string): void {
    if (list !== "") this.counts.set(list, (this.counts.get(list) ?? 0) + 1);
  }
  /** The header suffix after `key:` (an anchor, an alias or nothing) and whether items follow. */
  header(list: string, role: string): { suffix: string; items: boolean } {
    if ((this.counts.get(list) ?? 0) < 2) return { suffix: "", items: true };
    const known = this.names.get(list);
    if (known !== undefined) return { suffix: ` *${known}`, items: false };
    const name = `${this.prefix}-${role}-${this.names.size + 1}`;
    this.names.set(list, name);
    return { suffix: ` &${name}`, items: true };
  }
}

function emitRules(cap: Capability, id: string, out: string[], anchors: ListAnchors): void {
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
      const h = anchors.header(cap.triggerPaths(i), "changes");
      out.push(`      changes:${h.suffix}`);
      if (h.items) out.push(...paths.map((p) => `        - "${p}"`));
    }
    if (kind === "manual" && cond !== "") out.push("      when: manual");
  }
}

/** The hidden job holding the pinned Task install once; every `task` job references it. */
export const TASK_INSTALL_JOB = ".task-install";
const TASK_REFERENCE = `!reference [${TASK_INSTALL_JOB}, script]`;

/** The hidden job emitting the pinned Task install once (spec 0282), with its blank separator. */
export function emitTaskInstallJob(pin: TaskPin): string[] {
  return ["", `${TASK_INSTALL_JOB}:`, "  script:", ...taskRecipe(pin).map((l) => `    - ${l}`)];
}

/** The lines of one job, starting with the blank separator. */
export function emitJob(cap: Capability, pin: TaskPin, yqPins: YqPin = repoYqPins()): string[] {
  const id = cap.id;
  const runtimes = cap.runtimes;
  const nl = runtimes.indexOf("\n");
  const primary = nl < 0 ? runtimes : runtimes.slice(0, nl);
  const secondary = nl < 0 ? "" : runtimes.slice(nl + 1);
  const out = ["", `${id}:`];
  if (cap.group !== "") out.push(`  stage: ${cap.group}`);
  if (cap.group === "windows") out.push("  needs: []");
  out.push(`  image: ${runtimeToImage(primary)}`);

  const depthFull = cap.historyDepth === "full";
  const envKeys = cap.envKeys;
  if (depthFull || envKeys !== "") {
    out.push("  variables:");
    if (depthFull) out.push('    GIT_DEPTH: "0"');
    for (const ek of nonEmptyLines(envKeys)) out.push(dqEntry(4, ek, cap.envValue(ek)));
  }

  const before: string[] = [];
  for (const sr of nonEmptyLines(secondary)) before.push(...secondaryRuntimeInstallLines(sr));
  const toolList = nonEmptyLines(cap.tools);
  if (cap.yq !== "" && !toolList.includes("yq"))
    throw new BuildCiError(
      `Error: capability '${id}': requires.yq is set but requires.tools lacks yq.`,
    );
  for (const t of toolList)
    before.push(
      ...(t === "task"
        ? [TASK_REFERENCE]
        : toolInstallLines(t, pin, { version: cap.yq, pins: yqPins })),
    );
  before.push(...installLines(cap.install));
  if (before.length > 0) out.push("  before_script:", ...before.map((l) => `    - ${l}`));

  const cacheFiles = cap.cacheFiles;
  const cacheEnv = cap.cacheEnv;
  let guard = cap.cacheGuard;
  if (guard === "") guard = "true";
  const anchors = new ListAnchors(id);
  anchors.count(cacheFiles);
  for (let i = 0; i < cap.triggerCount; i++) anchors.count(cap.triggerPaths(i));
  if (cacheFiles !== "") {
    const h = anchors.header(cacheFiles, "files");
    out.push("  cache:", "    key:", `      files:${h.suffix}`);
    if (h.items) out.push(...nonEmptyLines(cacheFiles).map((f) => dqItem(8, f)));
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

  emitRules(cap, id, out, anchors);
  return out;
}
