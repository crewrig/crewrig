// reference.ts — the effective path set, cache files and cache env of one capability, read from
// ci/ci-capabilities.yml through the ci-parity reader (spec 0283 R3/R6, spec 0049 delta-02 R25).
//
// Usage: readEffective(refText, id). Throws Error for an unknown id.

import { readCapabilities } from "../ci-parity/reference-read.ts";
import { get, parse, render, resolve, YqSeq } from "../yq-accessors/index.ts";

export interface Effective {
  /** Effective paths per trigger kind (`pull-request`, `push`); empty when none declared. */
  paths: Record<string, string[]>;
  /** Effective `cache.files`, else the capability-level `paths`. */
  cacheFiles: string[];
  cacheEnv: string[];
}

export function readEffective(refText: string, id: string): Effective {
  const doc = parse(refText);
  const caps = readCapabilities(doc);
  const idx = caps.findIndex((c) => c.id === id);
  const cap = caps[idx];
  if (cap === undefined) throw new Error(`unknown capability '${id}'`);
  const paths: Record<string, string[]> = {};
  for (const t of cap.triggers) if (t.paths.length > 0) paths[t.kind] = t.paths;
  const raw = resolve(get(doc, ["capabilities", String(idx), "cache", "env"]));
  const cacheEnv = raw instanceof YqSeq ? raw.items.map((i) => render(resolve(i))) : [];
  const cacheFiles = cap.cacheFiles.length > 0 ? cap.cacheFiles : cap.capPaths;
  return { paths, cacheFiles, cacheEnv };
}
