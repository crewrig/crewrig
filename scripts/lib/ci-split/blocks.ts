// blocks.ts — cuts a capability reference text into per-capability blocks (spec 0309 R2, R13).
//
// A block is one list entry of `capabilities:` together with the comment and blank lines
// that lead it, so a section comment travels with the entry it introduces. Text only: the
// lines are never re-serialised, so a moved block is byte-identical to its source.

import { get, parse, render, resolve, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";

export interface Block {
  id: string;
  /** The entry's `group` field; "" when it has none. */
  group: string;
  /** The lines of the block, each with its line feed. */
  text: string;
}

const scalar = (n: YqNode): string =>
  n === null || n instanceof YqMap || n instanceof YqSeq ? "" : render(n);

const isLead = (l: string): boolean => l.trim() === "" || l.startsWith("  #");

/**
 * The blocks of `text` (a whole reference file, header included) in file order. Lines before
 * the first block's lead are the file header and are not returned.
 */
export function splitBlocks(text: string): Block[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const top = lines.findIndex((l) => /^capabilities:[ \t]*(#.*)?$/.test(l));
  if (top < 0) throw new Error("`capabilities:` must stand alone on its line");
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (i > top && /^ {2}- /.test(l)) starts.push(i);
  });
  const caps = resolve(get(resolve(parse(text)), ["capabilities"]));
  if (!(caps instanceof YqSeq) || caps.items.length !== starts.length)
    throw new Error("the entry lines do not match the parsed entries");
  const leads = starts.map((s) => {
    let a = s;
    while (a - 1 > top && isLead(lines[a - 1] as string)) a--;
    return a;
  });
  return starts.map((_, k) => {
    const end = k + 1 < starts.length ? (leads[k + 1] as number) : lines.length;
    const e = resolve(caps.items[k] as YqNode);
    const entry = e instanceof YqMap ? e : null;
    return {
      id: entry ? scalar(resolve(get(entry, ["id"]))) : "",
      group: entry ? scalar(resolve(get(entry, ["group"]))) : "",
      text: `${lines.slice(leads[k] as number, end).join("\n")}\n`,
    };
  });
}
