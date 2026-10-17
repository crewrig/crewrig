// filters-doc.ts — the dorny/paths-filter `filters:` text of an in-job filter, decoded as YAML
// (R14, R17). One value per attributed job: the decoded document or the undeterminable cause.

import { get, parse, tag, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";
import { plist } from "./reference-read.ts";

export interface FilterDoc {
  root: string;
  count: number;
  names: string;
  name: string;
  vtag: string;
  items: string[];
  bad: boolean;
}

/** The decoded text, or the cause string when it cannot be determined. */
export function decodeFilters(txt: string): FilterDoc | string {
  if (/(^|\n)(---|\.\.\.|%)/.test(txt)) return "its filters text holds a YAML document marker";
  if (!/\S/.test(txt)) return "its filters input is empty or not a string";
  let doc: YqNode;
  try {
    doc = parse(`${txt}\n`);
  } catch {
    return "its filters text is not valid YAML";
  }
  const entries = doc instanceof YqMap ? doc.entries : [];
  const first = entries[0];
  const p = first === undefined ? null : plist(first[1]);
  return {
    root: tag(doc),
    count: entries.length,
    names: entries.map(([k]) => k).join(", "),
    name: first?.[0] ?? "",
    vtag: p?.tag ?? "",
    items: p?.list ?? [],
    bad: p?.bad ?? false,
  };
}

export { get, YqSeq };
