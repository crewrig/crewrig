// reference.ts — concern 1, reference validity (spec 0049 R2, validity rules 2-7).
// Message texts and their order follow the shell loop exactly.

import { parse, YqParseError } from "../yq-accessors/index.ts";
import { inListPrefix, normalizeCmd, selfInstallsTool } from "./probe-tokens.ts";
import { firstLine } from "../first-line.ts";
import { readCapabilities } from "./reference-read.ts";
import { ParityGap, type CapRecord, type ParityState } from "./state.ts";

const TRIGGER_KINDS = ["push", "pull-request", "tag", "scheduled", "manual"];
const FILTER_KEYS = ["on", "branches", "paths", "tag-pattern"];

const hasWord = (norm: string, w: string): boolean => ` ${norm} `.includes(` ${w} `);

function checkCommands(c: CapRecord, label: string, verr: (m: string) => void): void {
  if (c.ncmd === 0) {
    verr(`${label}: portable capability declares no command (validity rule 5)`);
    return;
  }
  const cmds = c.cmds.join("\n").replace(/\n+$/, "");
  const norm = normalizeCmd(cmds);
  const display = c.runtime.join(",") || "unset";
  const needs = (words: string[]): boolean => words.some((w) => hasWord(norm, w));
  if (needs(["npm", "npx", "node"]) && !inListPrefix("node@", c.runtime))
    verr(
      `${label}: command needs the node runtime but requires.runtime is '${display}' (validity rule 6)`,
    );
  if (needs(["python", "python3", "pip", "pip3"]) && !inListPrefix("python@", c.runtime))
    verr(
      `${label}: command needs the python runtime but requires.runtime is '${display}' (validity rule 6)`,
    );
  for (const probe of ["yq", "jq", "task", "markdownlint"]) {
    if (!hasWord(norm, probe)) continue;
    const mapped = probe === "markdownlint" ? "markdownlint-cli" : probe;
    if (c.tools.includes(mapped) || selfInstallsTool(cmds, mapped)) continue;
    verr(
      `${label}: command invokes '${probe}' but does not declare '${mapped}' under requires.tools (validity rule 6)`,
    );
  }
}

function checkCapability(c: CapRecord, i: number, seen: string[], verr: (m: string) => void): void {
  const named = c.id !== "" && c.id !== "null";
  const label = named ? `capability '${c.id}'` : `capability index ${i}`;
  if (!named) verr(`${label}: missing traceability id (validity rule 4)`);
  else {
    if (seen.includes(c.id))
      verr(`capability '${c.id}': duplicate traceability id (validity rule 4)`);
    seen.push(c.id);
  }
  if (c.ntrig === 0) verr(`${label}: declares no trigger (a trigger is mandatory)`);
  for (let t = 0; t < c.ntrig; t++) {
    const tr = c.triggers[t];
    const kind = tr?.kind ?? "";
    if (!TRIGGER_KINDS.includes(kind))
      verr(`${label}: trigger kind '${kind}' is outside the neutral vocabulary (validity rule 2)`);
    for (const fk of tr?.keys ?? []) {
      if (fk !== "" && !FILTER_KEYS.includes(fk))
        verr(
          `${label}: trigger filter '${fk}' is outside {branches, paths, tag-pattern} (validity rule 2)`,
        );
    }
  }
  if (c.port === "specific") {
    if (c.engine === "" || c.engine === "null")
      verr(`${label}: engine-specific capability without exception.engine (validity rule 3)`);
    if (c.evidence.replace(/\s/g, "") === "" || c.evidence === "null")
      verr(`${label}: engine-specific capability with empty exception.evidence (validity rule 3)`);
  }
  if (c.port === "portable") checkCommands(c, label, verr);
  if (c.envTag !== "!!null" && c.envTag !== "" && c.envTag !== "!!map")
    verr(`${label}: env must be a key-value mapping (spec 0131)`);
  if (c.cacheTag !== "!!null" && c.cacheTag !== "") {
    if (c.cacheTag !== "!!map")
      verr(`${label}: cache must be a mapping with files and env (spec 0147)`);
    else {
      if (c.cacheFilesCount === 0) verr(`${label}: cache declares no files (spec 0147)`);
      if (c.cacheEnvTag !== "!!seq") verr(`${label}: cache.env must be a list (spec 0147)`);
    }
  }
}

/**
 * Decode the reference, record the capabilities and run the validity rules. Returns false when
 * the reference cannot be decoded (the message is already on stderr, status 1 as yq's abort).
 */
/**
 * The shell's per-call path for a multi-document reference. When no document declares a
 * capability the loop never runs and the only violation is the stable one; any other shape
 * makes yq join per-document results into bash diagnostics, outside the byte comparison.
 */
function multiDocument(state: ParityState, source: string): boolean {
  const blank = (c: string): boolean => c.split("\n").every((l) => /^\s*(#.*)?$/.test(l));
  const chunks = source.split(/^---(?:[ \t].*)?\r?$/m).filter((c) => !blank(c));
  try {
    for (const c of chunks) {
      const n = readCapabilities(parse(c)).length;
      if (n !== 0)
        throw new ParityGap("capabilities in a multi-document reference are not supported");
    }
  } catch (e) {
    if (e instanceof ParityGap || e instanceof YqParseError) {
      state.stderr += `Error: ${state.reference}: ${firstLine(e.message)}\n`;
      state.code = 1;
      return false;
    }
    throw e;
  }
  state.validityErrors.push("reference holds more than one YAML document");
  return true;
}

export function checkReference(state: ParityState, source: string): boolean {
  let caps: CapRecord[];
  try {
    caps = readCapabilities(parse(source));
  } catch (e) {
    if (e instanceof YqParseError && e.kind === "multi-document")
      return multiDocument(state, source);
    if (e instanceof ParityGap || e instanceof YqParseError) {
      state.stderr += `Error: ${state.reference}: ${firstLine(e.message)}\n`;
      state.code = 1;
      return false;
    }
    throw e;
  }
  state.caps = caps;
  const seen: string[] = [];
  caps.forEach((c, i) => checkCapability(c, i, seen, (m) => state.validityErrors.push(m)));
  return true;
}

/** `ALL_IDS` / `PORTABLE_IDS`: validity already rejected missing and duplicate ids. */
export function collectIds(state: ParityState): void {
  state.allIds = state.caps.map((c) => c.id);
  state.portableIds = state.caps.filter((c) => c.port === "portable").map((c) => c.id);
}
