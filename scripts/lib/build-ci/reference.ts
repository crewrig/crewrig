// reference.ts — reads ci/ci-capabilities.yml through the shared yq-accessor reader
// (document order kept). Each accessor returns what the shell's `$(yq -r EXPR)` at that
// point captured: text with trailing line feeds stripped, lists joined by LF.

import {
  get,
  keys,
  length,
  parse,
  render,
  resolve,
  tag,
  YqMap,
  YqSeq,
  YqParseError,
} from "../yq-accessors/index.ts";
import type { YqNode } from "../yq-accessors/index.ts";
import { BuildCiError } from "./tools.ts";
import { stripTrailingLf } from "./render-yaml.ts";

const gap = (what: string): BuildCiError =>
  new BuildCiError(`Error: build-ci: ${what} is not supported by the TypeScript reader`);

/** `yq -r` of one node: absent prints nothing here, a collection is a reader gap. */
function text(node: YqNode): string {
  if (node === null) return "";
  if (node instanceof YqMap || node instanceof YqSeq)
    throw gap("a collection where a scalar is expected");
  return render(node);
}

/** `EXPR | .[]` joined by LF, trailing line feeds stripped; absent or null -> "". */
function listText(input: YqNode): string {
  const node = resolve(input);
  if (node === null || tag(node) === "!!null") return "";
  if (node instanceof YqSeq) return stripTrailingLf(node.items.map(text).join("\n"));
  if (node instanceof YqMap)
    return stripTrailingLf(node.entries.map(([, v]) => text(v)).join("\n"));
  throw new BuildCiError("Error: Cannot iterate over a scalar");
}

/** A capability mapping with the accessors build-ci needs. */
export class Capability {
  readonly node: YqNode;
  constructor(node: YqNode) {
    this.node = node;
  }
  private at(path: readonly string[]): YqNode {
    try {
      return resolve(get(this.node, path));
    } catch (e) {
      throw new BuildCiError(`Error: ${(e as Error).message}`);
    }
  }
  private orEmpty(path: readonly string[]): string {
    const n = this.at(path);
    return n === null || tag(n) === "!!null" ? "" : stripTrailingLf(text(n));
  }
  get id(): string {
    return text(this.at(["id"]));
  }
  /** The `group` field: the stage of the job (spec 0287 R11); "" when omitted. */
  get group(): string {
    return this.orEmpty(["group"]);
  }
  get runtimes(): string {
    const n = this.at(["requires", "runtime"]);
    return n instanceof YqSeq ? listText(n) : stripTrailingLf(text(n));
  }
  /** `requires.install` (ci | install | omit-dev | none); "" when omitted. */
  get install(): string {
    return this.orEmpty(["requires", "install"]);
  }
  /** `requires.yq`: the pinned yq version of the job (ci/yq-pin.json); "" when omitted. */
  get yq(): string {
    return this.orEmpty(["requires", "yq"]);
  }
  get historyDepth(): string {
    return this.orEmpty(["requires", "history-depth"]);
  }
  get envKeys(): string {
    const env = this.at(["env"]);
    if (env === null || tag(env) === "!!null") return "";
    if (!(env instanceof YqMap) && !(env instanceof YqSeq))
      throw new BuildCiError("Error: cannot get keys of a scalar");
    return stripTrailingLf(keys(env).join("\n"));
  }
  envValue(key: string): string {
    return stripTrailingLf(text(this.at(["env", key])));
  }
  get tools(): string {
    return listText(this.at(["requires", "tools"]));
  }
  /** `cache.files`, defaulting to the capability-level `paths` when absent (spec 0283 R3). */
  get cacheFiles(): string {
    const cache = this.at(["cache"]);
    const own = this.at(["cache", "files"]);
    if (cache instanceof YqMap && (own === null || tag(own) === "!!null")) return this.capPaths;
    return listText(own);
  }
  /** The capability-level `paths`; a capability-level `paths-ignore` is rejected. */
  get capPaths(): string {
    const c = this.node;
    if (c instanceof YqMap && c.entries.some(([k]) => k === "paths-ignore"))
      throw new BuildCiError(
        `Error: capability '${this.id}' declares paths-ignore, which is not accepted (spec 0283 R3).`,
      );
    return listText(this.at(["paths"]));
  }
  get cacheEnv(): string {
    return listText(this.at(["cache", "env"]));
  }
  get cacheGuard(): string {
    const c = this.node;
    if (!(c instanceof YqMap) || !c.entries.some(([k]) => k === "cache-guard")) return "";
    return stripTrailingLf(text(this.at(["cache-guard"])));
  }
  get commandCount(): number {
    return length(this.at(["command"]));
  }
  command(j: number): string {
    return stripTrailingLf(text(this.at(["command", String(j)])));
  }
  get triggerCount(): number {
    return length(this.at(["trigger"]));
  }
  triggerKind(i: number): string {
    return stripTrailingLf(text(this.at(["trigger", String(i), "on"])));
  }
  triggerBranches(i: number): string {
    return listText(this.at(["trigger", String(i), "branches"]));
  }
  triggerTagPattern(i: number): string {
    return this.orEmpty(["trigger", String(i), "tag-pattern"]);
  }
  /**
   * The effective path set of trigger `i` (spec 0049 delta-02 R25): its own `paths` when the key
   * is declared, else the capability-level `paths` for a pull-request or push trigger.
   */
  triggerPaths(i: number): string {
    const t = this.at(["trigger", String(i)]);
    if (t instanceof YqMap && t.entries.some(([k]) => k === "paths-ignore"))
      throw new BuildCiError(
        `Error: capability '${this.id}' declares paths-ignore, which is not accepted (spec 0283 R3).`,
      );
    const hasOwn = t instanceof YqMap && t.entries.some(([k]) => k === "paths");
    const kind = this.triggerKind(i);
    if (!hasOwn && (kind === "pull-request" || kind === "push")) return this.capPaths;
    return listText(this.at(["trigger", String(i), "paths"]));
  }
}

/** The portable capabilities (`.portability == "portable"`), in document order. */
/** The parser message minus its multi-line source snippet: one `Error:` line (delta-02 g). */
function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

export function portableCapabilities(source: string): Capability[] {
  let doc: YqNode;
  try {
    doc = parse(source);
  } catch (e) {
    if (e instanceof Error) throw new BuildCiError(`Error: ${firstLine(e.message)}`);
    throw e;
  }
  let caps: YqNode;
  try {
    caps = get(doc, ["capabilities"]);
  } catch (e) {
    // A bare scalar root: the shell exits 0 with a header-only file; delta-02 item (g) makes it
    // one Error line and exit 1.
    if (e instanceof Error) throw new BuildCiError(`Error: ${firstLine(e.message)}`);
    throw e;
  }
  // The shell lists ids through a process substitution, which swallows a yq failure: a
  // missing or non-sequence `capabilities` yields a header-only pipeline and exit 0.
  if (!(caps instanceof YqSeq)) return [];
  const out: Capability[] = [];
  for (const c of caps.items) {
    const p = c instanceof YqMap ? get(c, ["portability"]) : null;
    if (p !== null && !(p instanceof YqMap) && !(p instanceof YqSeq) && render(p) === "portable")
      out.push(new Capability(c));
  }
  return out;
}
