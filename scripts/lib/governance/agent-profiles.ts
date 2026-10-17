// agent-profiles.ts — hermetic checker for an agent source's `metadata.model:`
// capability profile (spec 0195 R23-R25, spec 0198 R36-R39); twin of
// scripts/check-agent-profiles.sh (spec 0262 requirements 1-4, 7, 24).
//
// Pure of process state: `runCheck` returns the streams and the exit code, the entry
// writes them. Every `yq` read of the shell goes through scripts/lib/yq-accessors/.
// Where the shell silenced a `yq` failure (`2>/dev/null || echo false`) the read
// yields "absent"; a runtime failure of the shell itself (an unreadable source, a
// `[` integer overflow) is an `AgentProfilesError`, printed as one `Error:` line
// (spec 0262 requirement 24 (c)).

import fs from "node:fs";
import path from "node:path";

import {
  get,
  keys,
  loadYq,
  tag,
  YqAlias,
  YqMap,
  YqParseError,
  YqSeq,
  type YqNode,
} from "../yq-accessors/index.ts";
import { firstLine } from "../first-line.ts";
import { checkTuningKnobs } from "./agent-profiles-tuning.ts";
import { AgentProfilesError, type Fail, valueOf } from "./agent-profiles-yq.ts";

const INTELLIGENCE_RUNGS = "minimal low medium high xhigh xxhigh max";
const REASONING_RUNGS = "none low medium high xhigh max";
const SPEED_DOMAIN = "standard fast";
const LOCALITY_DOMAIN = "any local-only";
const MODALITY_DOMAIN = "text vision image-out";
const PROFILE_KEYS =
  "intelligence reasoning specialization context speed modalities locality tuning";
const TUNING_KEYS = "temperature top-p top-k max-output-tokens max-turns";

/** `case " $LIST " in *" $v "*)`: a substring test, so a value holding spaces can match. */
const inDomain = (list: string, v: string): boolean => ` ${list} `.includes(` ${v} `);

export interface Outcome {
  stdout: string;
  stderr: string;
  code: number;
}

/** `extract_frontmatter` (awk) then `$(...)`: lines after a line-1 `---`, up to the next `---`. */
export function extractFrontmatter(text: string): string {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const out: string[] = [];
  if (lines[0] === "---") {
    for (const line of lines.slice(1)) {
      if (line === "---") break;
      out.push(line);
    }
  }
  return out.join("\n").replace(/\n+$/, "");
}

function hasKey(node: YqNode, key: string): boolean {
  let cur = node;
  while (cur instanceof YqAlias) cur = cur.target;
  return cur instanceof YqMap && cur.entries.some(([k]) => k === key);
}

const tagWord = (node: YqNode): string => tag(node) || "unknown";

function loadDoc(file: string, text: string): YqNode | undefined {
  try {
    return loadYq(`${extractFrontmatter(text)}\n`);
  } catch (e) {
    // The shell swallowed a yq parse error as "no model"; the deliberate rejections
    // of requirement 24 (d) and (f) stop the entry instead.
    if (e instanceof YqParseError && e.kind !== "syntax") {
      throw new AgentProfilesError(`${file}: ${e.message.split("\n")[0] ?? ""}`);
    }
    return undefined;
  }
}

/** The `metadata.model` node when `.metadata // {} | has("model")` is true, else undefined. */
function modelNode(doc: YqNode): YqNode | undefined {
  try {
    const meta = get(doc, ["metadata"]);
    if (!hasKey(meta, "model")) return undefined;
    return get(doc, ["metadata", "model"]);
  } catch {
    return undefined;
  }
}

function checkModel(model: YqNode, fail: Fail): void {
  const modelTag = tag(model);
  if (modelTag !== "!!map") {
    fail("P1", `metadata.model is present but is not a mapping (tag: ${modelTag || "unknown"})`);
    return;
  }
  const kv = (key: string): string => valueOf(get(model, [key]));
  for (const k of keys(model).join("\n").split("\n")) {
    if (k === "") continue;
    if (!inDomain(PROFILE_KEYS, k)) {
      fail("P2", `metadata.model carries key '${k}', outside the eight spec 0195 R19 admits`);
    }
  }
  if (hasKey(model, "intelligence")) {
    const v = kv("intelligence");
    if (!inDomain(INTELLIGENCE_RUNGS, v)) {
      fail("P4", `intelligence '${v}' is outside the seven spec 0195 rungs`);
    }
  }
  if (hasKey(model, "reasoning")) {
    const v = kv("reasoning");
    if (!inDomain(REASONING_RUNGS, v)) {
      fail("P5", `reasoning '${v}' is outside the six spec 0195 rungs`);
    }
  }
  if (hasKey(model, "speed")) {
    const v = kv("speed");
    if (!inDomain(SPEED_DOMAIN, v)) fail("P6", `speed '${v}' is outside standard|fast`);
  }
  if (hasKey(model, "locality")) {
    const v = kv("locality");
    if (!inDomain(LOCALITY_DOMAIN, v)) fail("P6", `locality '${v}' is outside any|local-only`);
  }
  if (hasKey(model, "modalities")) {
    const modalities = get(model, ["modalities"]);
    if (tag(modalities) !== "!!seq") {
      fail("P11", `modalities is present but is not a list (tag: ${tagWord(modalities)})`);
    } else if (modalities instanceof YqSeq) {
      const members = modalities.items.map((item) => valueOf(item)).join("\n");
      for (const mv of members.split("\n")) {
        if (mv === "") continue;
        if (!inDomain(MODALITY_DOMAIN, mv)) {
          fail("P6", `modalities member '${mv}' is outside text|vision|image-out`);
        }
      }
    }
  }
  if (hasKey(model, "context")) {
    const v = kv("context");
    if (v === "" || /[^0-9]/.test(v) || v === "0") {
      fail("P7", `context '${v}' is not a positive integer`);
    }
  }
  if (hasKey(model, "specialization")) {
    const v = kv("specialization");
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(v)) {
      fail("P9", `specialization '${v}' is not a kebab-case token`);
    }
  }
  if (hasKey(model, "tuning")) checkTuning(get(model, ["tuning"]), fail);
}

function checkTuning(tuning: YqNode, fail: Fail): void {
  if (tag(tuning) !== "!!map" || !(tuning instanceof YqMap)) {
    fail("P10", `tuning is present but is not a mapping (tag: ${tagWord(tuning)})`);
    return;
  }
  for (const tk of keys(tuning).join("\n").split("\n")) {
    if (tk === "") continue;
    if (!inDomain(TUNING_KEYS, tk)) {
      fail("P3", `tuning carries key '${tk}', outside the five spec 0195 R17 knobs`);
    }
  }
  checkTuningKnobs(tuning, fail);
}

/** Resolve the files to check: named arguments, else `artifacts/*\/agents/*\/AGENT.md`. */
function resolveFiles(args: readonly string[], repoDir: string): string[] | Outcome {
  const err = (message: string): Outcome => ({ stdout: "", stderr: `${message}\n`, code: 2 });
  const isFile = (p: string): boolean =>
    fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;
  if (args.length > 0) {
    for (const a of args) {
      if (!isFile(a)) return err(`Error: named argument does not exist: ${a}`);
    }
    return [...args];
  }
  const artifacts = path.join(repoDir, "artifacts");
  if (fs.statSync(artifacts, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return err(`Error: artifacts/ not found: ${artifacts}`);
  }
  const children = (dir: string): string[] => {
    try {
      return fs
        .readdirSync(dir)
        .filter((n) => !n.startsWith("."))
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    } catch {
      return [];
    }
  };
  const files: string[] = [];
  for (const layer of children(artifacts)) {
    const agentsDir = path.join(artifacts, layer, "agents");
    for (const agent of children(agentsDir)) {
      const f = path.join(agentsDir, agent, "AGENT.md");
      if (isFile(f)) files.push(f);
    }
  }
  // Bash sorts the expanded paths as whole strings, so `core-x/…` precedes `core/…`.
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (files.length === 0) {
    return err(`Error: no */agents/*/AGENT.md files under ${artifacts}`);
  }
  return files;
}

/** The whole check, as the shell ran it. */
export function runCheck(args: readonly string[], repoDir: string): Outcome {
  const files = resolveFiles(args, repoDir);
  if (!Array.isArray(files)) return files as Outcome;
  const failures: string[] = [];
  let stderr = "";
  let current = "";
  const fail: Fail = (id, message) => {
    const line = `${current}: ${id} ${message}`;
    stderr += `${line}\n`;
    failures.push(line);
  };
  try {
    for (const f of files) {
      current = f;
      let text: string;
      try {
        text = fs.readFileSync(f, "utf8");
      } catch (e) {
        throw new AgentProfilesError(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const doc = loadDoc(f, text);
      if (doc === undefined) continue;
      const model = modelNode(doc);
      if (model !== undefined) checkModel(model, fail);
    }
  } catch (e) {
    if (e instanceof AgentProfilesError) {
      return { stdout: "", stderr: `${stderr}Error: ${firstLine(e.message)}\n`, code: 1 };
    }
    throw e;
  }
  if (failures.length > 0) {
    stderr += `\nFAILED: ${failures.length} rejection(s) across ${files.length} agent source(s) (spec 0195 R23-R25).\n`;
    return { stdout: "", stderr, code: 1 };
  }
  return {
    stdout: `OK: ${files.length} agent source(s) checked; every declared metadata.model: profile conforms.\n`,
    stderr,
    code: 0,
  };
}
