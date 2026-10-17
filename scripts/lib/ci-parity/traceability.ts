// traceability.ts — concern 2 (R7 per-job attribution on both engines) and Arm 3 (R6).
// A job is traceable iff its key is a capability id or its `# ci-capability:` key-comment
// names one. Key comments come from the line scanner (yq-accessors/comments.ts).

import fs from "node:fs";
import path from "node:path";

import { isYqFalsy, parse, tag, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";
import { fail } from "./findings.ts";
import { CommentScanGap, keyComments } from "../yq-accessors/comments.ts";
import { YqParseError } from "../yq-accessors/index.ts";
import { inputGap, type ParityState } from "./state.ts";

const RESERVED =
  "stages workflow default include variables image before_script after_script cache services pages".split(
    " ",
  );
const PREFIX = "ci-capability: ";

/** The workflow files in the shell's glob order: every `*.yml`, then every `*.yaml`. */
export function workflowFiles(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const pick = (ext: string): string[] =>
    names
      .filter((n) => n.endsWith(ext) && fs.statSync(path.join(dir, n)).isFile())
      .sort(byBytes)
      .map((n) => path.join(dir, n));
  return [...pick(".yml"), ...pick(".yaml")];
}

function attribute(state: ParityState, key: string, comment: string): string {
  if (state.allIds.includes(key)) return key;
  if (comment.startsWith(PREFIX)) {
    const cand = comment.slice(PREFIX.length);
    if (state.allIds.includes(cand)) return cand;
  }
  return "";
}

/** `[key, key-comment]` pairs of a mapping node (sequence jobs read as indices, no comment). */
function pairs(
  node: YqNode,
  text: string,
  parent: string | null,
  file: string,
): [string, string][] {
  if (node instanceof YqSeq) return node.items.map((_, i) => [String(i), ""]);
  if (!(node instanceof YqMap)) return [];
  let found: ReturnType<typeof keyComments>;
  try {
    found = keyComments(text, parent);
  } catch (e) {
    if (e instanceof CommentScanGap)
      inputGap(file, `${e.message} is not supported by the key-comment scanner`);
    throw e;
  }
  if (found.length !== node.entries.length)
    inputGap(file, "the key-comment scan does not align with the loaded mapping");
  return node.entries.map(([k], i) => [k, found[i]?.comment ?? ""]);
}

function harvestGha(state: ParityState): void {
  for (const wf of workflowFiles(state.workflowsDir)) {
    let text: string;
    let jobs: YqNode;
    try {
      text = fs.readFileSync(wf, "utf8");
      const doc = parse(text);
      jobs =
        doc instanceof YqMap ? (doc.entries.findLast(([k]) => k === "jobs")?.[1] ?? null) : null;
    } catch (e) {
      if (e instanceof YqParseError && e.kind === "multi-document")
        inputGap(wf, "more than one YAML document is not supported");
      // delta-05 item (j): the shell skips an unparseable workflow silently; the twin stops.
      return inputGap(wf, "not valid YAML");
    }
    if (isYqFalsy(jobs)) continue;
    if (tag(jobs) !== "!!map" && tag(jobs) !== "!!seq")
      inputGap(wf, "`jobs` is a scalar, not a mapping");
    for (const [jk, lc] of pairs(jobs, text, "jobs", wf)) {
      if (jk === "") continue;
      const id = attribute(state, jk, lc);
      if (id === "") {
        fail(
          state,
          `untraceable job '${jk}' in ${path.basename(wf)} (github-actions) — not a capability id and no valid '# ci-capability:' annotation (R7)`,
        );
      } else {
        state.ghaJobs.push({ id, workflow: wf, jobKey: jk });
        state.ghaExhibited.push(id);
      }
    }
  }
}

function noteGitlab(state: ParityState, jk: string, lc: string): void {
  if (RESERVED.includes(jk)) {
    if (!lc.startsWith(PREFIX)) return;
    const cand = lc.slice(PREFIX.length);
    if (state.allIds.includes(cand)) state.gitlabExhibited.push(cand);
    else
      fail(
        state,
        `untraceable job '${jk}' in .gitlab-ci.yml (gitlab) — annotation '${cand}' is not a capability id (R7)`,
      );
    return;
  }
  const id = attribute(state, jk, lc);
  if (id === "") {
    fail(
      state,
      `untraceable job '${jk}' in .gitlab-ci.yml (gitlab) — not a capability id and no valid '# ci-capability:' annotation (R7)`,
    );
  } else state.gitlabExhibited.push(id);
}

function harvestGitlab(state: ParityState): void {
  let text: string;
  let doc: YqNode;
  try {
    text = fs.readFileSync(state.gitlabCi, "utf8");
    doc = parse(text);
  } catch (e) {
    const multi = e instanceof YqParseError && e.kind === "multi-document";
    return inputGap(
      state.gitlabCi,
      multi ? "more than one YAML document is not supported" : "not valid YAML",
    );
  }
  if (tag(doc) !== "!!map" && tag(doc) !== "!!seq" && !isYqFalsy(doc))
    inputGap(state.gitlabCi, "the top level is a scalar, not a mapping");
  for (const [jk, lc] of pairs(doc, text, null, state.gitlabCi)) {
    if (jk !== "") noteGitlab(state, jk, lc);
  }
}

/** Engine presence (R11) and the harvest of both engines. */
export function traceability(state: ParityState): void {
  state.ghaPresent = workflowFiles(state.workflowsDir).length > 0;
  state.gitlabPresent = fs.existsSync(state.gitlabCi) && fs.statSync(state.gitlabCi).isFile();
  if (state.ghaPresent) harvestGha(state);
  if (state.gitlabPresent) harvestGitlab(state);
}

/** Arm 3 (R6): both engines' exhibited portable sets must cover the reference's. */
export function arm3(state: ParityState): void {
  const compare = (platform: string, exhibited: string[]): void => {
    for (const pid of state.portableIds) {
      if (pid !== "" && !exhibited.includes(pid))
        fail(
          state,
          `capability '${pid}' is in the reference portable set but absent from ${platform} (R6)`,
        );
    }
  };
  if (state.ghaPresent) compare("github-actions", state.ghaExhibited);
  if (state.gitlabPresent) compare("gitlab", state.gitlabExhibited);
}
