// reference.ts — reads ci/ci-capabilities.yml through the shared yq-accessor reader
// (document order kept). Each accessor returns what the shell's `$(yq -r EXPR)` at that
// point captured: text with trailing line feeds stripped, lists joined by LF.

import {
  get,
  keys,
  length,
  parse,
  render,
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
function listText(node: YqNode): string {
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
      return get(this.node, path);
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
  get runtimes(): string {
    const n = this.at(["requires", "runtime"]);
    return n instanceof YqSeq ? listText(n) : stripTrailingLf(text(n));
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
  get cacheFiles(): string {
    return listText(this.at(["cache", "files"]));
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
  triggerPaths(i: number): string {
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
