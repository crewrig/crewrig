// reference-read.ts — loads the capability reference (`readReference`) and decodes it into
// CapRecord[] (the shell's REF_PROG).
// Every accessor mirrors the yq expression at the same place; a shape whose yq failure text
// the reader cannot reproduce throws ParityGap.

import fs from "node:fs";
import path from "node:path";

import {
  parse,
  YqParseError,
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
    group: orEmpty(at(c, ["group"]), "group"),
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

// ---------------------------------------------------------------------------------------------
// The shared reader of the capability reference (spec 0309 R3, R13(0)).
//
// One logical reference: the directory `ci/capabilities/` when present, else the legacy single
// file `ci/ci-capabilities.yml`. Order: files in byte order of their names, entries in file order.
// Every consumer looks capabilities up by id, so the order decides nothing for them; the
// generator alone emits jobs in it.

export const REFERENCE_DIR = "ci/capabilities";
export const LEGACY_REFERENCE = "ci/ci-capabilities.yml";

const GROUPS = ["gate", "modules", "governance", "extensions", "integration", "windows"];
/** `<group>.yml` or `<group>-<part>.yml`; `standalone[-<part>].yml` holds the ungrouped ones. */
const NAME_RE = new RegExp(
  `^(${[...GROUPS, "standalone"].join("|")})(-[a-z0-9][a-z0-9-]*)?\\.yml$`,
);

export interface Reference {
  /** One YAML document holding every capability, in reader order. */
  text: string;
  /** `text` parsed; null only for a legacy file that does not parse (callers report that error). */
  doc: YqNode | null;
  /** Repo-relative paths of the files read, in reader order. */
  files: string[];
  /** Capability id to the repo-relative file that holds it. */
  fileOf: Map<string, string>;
}

/** Neither the directory nor the legacy file exists. */
export class ReferenceNotFoundError extends Error {
  readonly path: string;
  constructor(p: string) {
    super(`CI reference not found: ${p}`);
    this.path = p;
  }
}

export interface ReferenceViolation {
  file: string;
  message: string;
}

/** The directory (or the legacy file beside it) breaks one of the R3 rules. */
export class ReferenceReadError extends Error {
  readonly violations: ReferenceViolation[];
  readonly repo: string;
  constructor(repo: string, violations: ReferenceViolation[]) {
    super(violations.map((v) => `${v.file}: ${v.message}`).join("; "));
    this.repo = repo;
    this.violations = violations;
  }
  /** The block the parity guard prints, which `classify-ci-drift.ts` routes to reference-drift. */
  format(): string {
    let out = `FAILED: ${this.violations.length} reference-validity violation(s) in ${this.repo}/${REFERENCE_DIR}/:\n`;
    for (const v of this.violations) out += `  - ${v.file}: ${v.message}\n`;
    out += "\nThe reference is the source of truth; refusing to check the engines against\n";
    out += "a malformed reference (spec 0309 R3).\n";
    return out;
  }
}

/** The parsed reference; a legacy file that does not parse rethrows its own parse error here. */
export const docOf = (ref: Reference): YqNode => ref.doc ?? parse(ref.text);

/** What messages call the source read: the legacy file, else the directory. */
export const sourceOf = (ref: Reference): string =>
  ref.files.length === 1 && ref.files[0] === LEGACY_REFERENCE
    ? LEGACY_REFERENCE
    : `${REFERENCE_DIR}/`;

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

const asText = (n: YqNode): string => (n === null || isColl(n) ? "" : render(n));

/** Capabilities of one directory file, or a message when the file is not valid reference content. */
function readDirFile(
  text: string,
): { body: string; ids: { id: string; group: string }[] } | string {
  let doc: YqNode;
  try {
    doc = parse(text);
  } catch (e) {
    if (e instanceof YqParseError || e instanceof ParityGap)
      return `not valid reference content: ${firstLineOf(e.message)}`;
    throw e;
  }
  const top = resolve(doc);
  if (!(top instanceof YqMap) || keys(top).join() !== "capabilities")
    return "not valid reference content: the only top-level key must be `capabilities`";
  const caps = resolve(get(top, ["capabilities"]));
  if (!(caps instanceof YqSeq) || caps.items.length === 0)
    return "not valid reference content: `capabilities` must be a non-empty list";
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^capabilities:[ \t]*(#.*)?$/.test(l));
  if (at < 0) return "not valid reference content: `capabilities:` must stand alone on its line";
  const body = lines.slice(at + 1).join("\n");
  const ids = caps.items.map((raw) => {
    const e = resolve(raw);
    return e instanceof YqMap
      ? { id: asText(resolve(get(e, ["id"]))), group: asText(resolve(get(e, ["group"]))) }
      : { id: "", group: "" };
  });
  return { body: body.endsWith("\n") ? body : `${body}\n`, ids };
}

const firstLineOf = (s: string): string => s.split("\n")[0] ?? s;

/**
 * Reads the reference of `repo`: the directory when it exists, else the legacy file. Throws
 * `ReferenceNotFoundError` when neither exists and `ReferenceReadError` for the R3 failures:
 * invalid file content, an id in two files, a capability whose group is not its file's, a file
 * name outside the six groups and `standalone`, an empty directory, or the legacy file left
 * beside the directory. A legacy file is returned as read, parse errors left to the caller.
 */
export function readReference(repo: string): Reference {
  const dir = path.join(repo, REFERENCE_DIR);
  const legacy = path.join(repo, LEGACY_REFERENCE);
  const hasDir = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  const hasLegacy = fs.existsSync(legacy) && fs.statSync(legacy).isFile();
  if (!hasDir) {
    if (!hasLegacy) throw new ReferenceNotFoundError(legacy);
    const text = fs.readFileSync(legacy, "utf8");
    let doc: YqNode | null = null;
    const fileOf = new Map<string, string>();
    try {
      doc = parse(text);
      for (const c of readCapabilities(doc)) fileOf.set(c.id, LEGACY_REFERENCE);
    } catch (e) {
      if (!(e instanceof YqParseError || e instanceof ParityGap)) throw e;
    }
    return { text, doc, files: [LEGACY_REFERENCE], fileOf };
  }

  const bad: ReferenceViolation[] = [];
  if (hasLegacy)
    bad.push({
      file: LEGACY_REFERENCE,
      message: `still exists beside ${REFERENCE_DIR}/; delete it (the directory is the reference)`,
    });
  const names = fs.readdirSync(dir).sort(byteOrder);
  if (names.length === 0) bad.push({ file: `${REFERENCE_DIR}/`, message: "holds no file" });
  const fileOf = new Map<string, string>();
  const bodies: string[] = [];
  const files: string[] = [];
  for (const name of names) {
    const rel = `${REFERENCE_DIR}/${name}`;
    const m = NAME_RE.exec(name);
    if (!m || !fs.statSync(path.join(dir, name)).isFile()) {
      bad.push({
        file: rel,
        message: `name is not <group>[-<part>].yml of ${GROUPS.join(", ")} or standalone[-<part>].yml`,
      });
      continue;
    }
    const read = readDirFile(fs.readFileSync(path.join(dir, name), "utf8"));
    if (typeof read === "string") {
      bad.push({ file: rel, message: read });
      continue;
    }
    const want = m[1] === "standalone" ? "" : (m[1] as string);
    for (const { id, group } of read.ids) {
      if (group !== want)
        bad.push({
          file: rel,
          message:
            `capability '${id}' has ${group === "" ? "no group" : `group '${group}'`}, ` +
            `but this file holds ${want === "" ? "ungrouped capabilities" : `group '${want}'`}`,
        });
      const prior = fileOf.get(id);
      if (id !== "" && prior !== undefined && prior !== rel)
        bad.push({ file: rel, message: `capability '${id}' is also defined in ${prior}` });
      else if (id !== "") fileOf.set(id, rel);
    }
    files.push(rel);
    bodies.push(read.body);
  }
  if (bad.length > 0) throw new ReferenceReadError(repo, bad);
  const text = `capabilities:\n${bodies.join("")}`;
  try {
    return { text, doc: parse(text), files, fileOf };
  } catch (e) {
    if (!(e instanceof YqParseError)) throw e;
    // Files that parse alone but not together (a different list indent, for instance).
    throw new ReferenceReadError(repo, [
      {
        file: `${REFERENCE_DIR}/`,
        message: `the files do not form one reference: ${firstLineOf(e.message)}`,
      },
    ]);
  }
}
