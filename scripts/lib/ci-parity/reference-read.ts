// reference-read.ts — decodes ci/ci-capabilities.yml into CapRecord[] (the shell's REF_PROG).
// Every accessor mirrors the yq expression at the same place; a shape whose yq failure text
// the reader cannot reproduce throws ParityGap.

import {
  get,
  isYqFalsy,
  keys,
  length,
  render,
  resolve,
  tag,
  YqMap,
  YqSeq,
  type YqNode,
} from "../yq-accessors/index.ts";
import { ParityGap, type CapRecord, type TriggerRecord } from "./state.ts";

const gap = (what: string): ParityGap =>
  new ParityGap(`${what} is not supported by the TypeScript reader`);

const isColl = (n: YqNode): boolean => n instanceof YqMap || n instanceof YqSeq;

/** `yq -r EXPR` on one node: absent prints "", a collection is a reader gap. */
function scalar(n: YqNode, what: string): string {
  if (n === null) return "";
  if (isColl(n)) throw gap(`a collection for ${what}`);
  return render(n);
}

/** `EXPR // ""`. */
function orEmpty(n: YqNode, what: string): string {
  return isYqFalsy(n) ? "" : scalar(n, what);
}

/** `.[]` rendered, for a falsy-or-sequence node (`// []`). */
function items(n: YqNode, what: string): string[] {
  n = resolve(n);
  if (isYqFalsy(n)) return [];
  if (!(n instanceof YqSeq)) throw gap(`iterating ${what}`);
  return n.items.map((i) => scalar(i, what));
}

function at(n: YqNode, path: string[]): YqNode {
  try {
    return resolve(get(n, path));
  } catch {
    throw gap(`indexing a scalar at .${path.join(".")}`);
  }
}

/** A "path list": the entry tag, the string entries, and the shell's TLBAD (non-string, empty or multi-line entry). */
export function plist(node: YqNode): { tag: string; list: string[]; bad: boolean } {
  const n = resolve(node);
  const t = tag(n);
  if (!(n instanceof YqSeq)) return { tag: t, list: [], bad: false };
  const list = n.items.filter((i) => tag(i) === "!!str").map((i) => scalar(i, "a path list"));
  const bad = list.length !== n.items.length || list.some((e) => e === "" || e.includes("\n"));
  return { tag: t, list, bad };
}

/** The trigger kinds that inherit the capability-level `paths` (spec 0283 R3). */
const INHERITING_KINDS = ["pull-request", "push"];

/**
 * The effective path set of a trigger (spec 0049 delta-02 R25): its own `paths` when it declares
 * the key, else the capability-level `paths` for a pull-request or push trigger, else none.
 */
function readTriggers(c: YqNode, cap: ReturnType<typeof plist>, capHas: boolean): TriggerRecord[] {
  const t = at(c, ["trigger"]);
  if (!(t instanceof YqSeq)) return [];
  return t.items.map((raw) => {
    const e = resolve(raw);
    if (!isColl(e)) throw gap("a scalar trigger entry");
    const own = e instanceof YqMap ? plist(at(e, ["paths"])) : { tag: "", list: [], bad: false };
    const kind = orEmpty(at(e, ["on"]), "trigger.on");
    const hasOwn = e instanceof YqMap && keys(e).includes("paths");
    const inherited = !hasOwn && capHas && INHERITING_KINDS.includes(kind);
    const p = inherited ? cap : own;
    return {
      kind,
      tag: tag(e),
      keys: keys(e),
      pathsTag: p.tag,
      paths: p.list,
      pathsBad: p.bad,
      inherited,
    };
  });
}

function runtimeOf(c: YqNode): string[] {
  const rt = at(c, ["requires", "runtime"]);
  if (rt === null) return [];
  if (rt instanceof YqSeq) return rt.items.map((i) => scalar(i, "requires.runtime"));
  return [scalar(rt, "requires.runtime")];
}

/** One capability record; `c` null reads like the shell's default (non-sequence) record. */
export function readCapability(c: YqNode): CapRecord {
  const port = orEmpty(at(c, ["portability"]), "portability");
  const specific = port === "specific";
  const portable = port === "portable";
  const trigger = at(c, ["trigger"]);
  const command = at(c, ["command"]);
  const ncmd = isYqFalsy(command) ? 0 : length(command);
  const withCmd = portable && ncmd !== 0;
  const cache = at(c, ["cache"]);
  const cacheMap = tag(cache) === "!!map";
  const env = at(c, ["env"]);
  const envKeys: string[] = [];
  if (withCmd && !isYqFalsy(env) && isColl(env)) envKeys.push(...keys(env));
  const capPaths = plist(at(c, ["paths"]));
  const capKeys = resolve(c) instanceof YqMap ? keys(resolve(c)) : [];
  // cache.files defaults to the capability-level paths when absent (spec 0283 R3).
  const ownFiles = at(cache, ["files"]);
  const cacheFiles =
    cacheMap && isYqFalsy(ownFiles) && capPaths.tag === "!!seq" ? at(c, ["paths"]) : ownFiles;
  return {
    id: orEmpty(at(c, ["id"]), "id"),
    port,
    ntrig: isYqFalsy(trigger) ? 0 : length(trigger),
    triggers: readTriggers(c, capPaths, capKeys.includes("paths")),
    engine: specific ? orEmpty(at(c, ["exception", "engine"]), "exception.engine") : "",
    evidence: specific ? orEmpty(at(c, ["exception", "evidence"]), "exception.evidence") : "",
    ncmd: portable ? ncmd : 0,
    cmds: portable ? items(command, "command") : [],
    cmdTag: tag(command),
    runtime: withCmd ? runtimeOf(c) : [],
    tools: withCmd ? items(at(c, ["requires", "tools"]), "requires.tools") : [],
    historyDepth: withCmd ? orEmpty(at(c, ["requires", "history-depth"]), "history-depth") : "",
    install: withCmd ? orEmpty(at(c, ["requires", "install"]), "install") : "",
    yq: withCmd ? orEmpty(at(c, ["requires", "yq"]), "yq") : "",
    envTag: tag(env),
    envKeys,
    cacheTag: tag(cache),
    cacheFilesCount: cacheMap && !isYqFalsy(cacheFiles) ? length(cacheFiles) : 0,
    cacheEnvTag: cacheMap ? tag(at(cache, ["env"])) : "",
    cacheLen: isYqFalsy(cache) ? 0 : length(cache),
    cacheFiles: cacheMap && cacheFiles instanceof YqSeq ? items(cacheFiles, "cache.files") : [],
    capPathsTag: capPaths.tag,
    capPaths: capPaths.list,
    capPathsBad: capPaths.bad,
    capPathsIgnore: capKeys.includes("paths-ignore"),
  };
}

/** The capability records of a parsed reference document, as the shell's loop sees them. */
export function readCapabilities(doc: YqNode): CapRecord[] {
  const caps = at(doc, ["capabilities"]);
  const count = isYqFalsy(caps) ? 0 : length(caps);
  const out: CapRecord[] = [];
  for (let i = 0; i < count; i++) {
    out.push(readCapability(caps instanceof YqSeq ? (caps.items[i] ?? null) : null));
  }
  return out;
}
