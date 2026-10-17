// glob.ts — the pathname expansion `for x in $f` performs under `shopt -s globstar nullglob`
// (bash 5, LC_ALL=C): `*`, `?`, `[...]`, `**` as a whole segment, hidden names only matched by a
// pattern that spells the dot, no descent into symbolic links through `**`, and the final list
// sorted byte-wise. A word with no magic character is returned as written.
//
// Usage: expand(word, cwd). Exit codes: not applicable. Finding-line format: not applicable.

import fs from "node:fs";
import path from "node:path";

const MAGIC = /[*?[]/;
const CLASSES: Record<string, string> = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  space: " \\t\\n\\r\\f\\v",
  punct: "!-\\/:-@\\[-`{-~",
  xdigit: "0-9a-fA-F",
};

function literalChar(c: string): string {
  return c.replace(/[\\^$.|?*+()[\]{}/-]/g, "\\$&");
}

/** One bracket expression starting at `i` (the `[`); null when it is never closed. */
function bracket(seg: string, i: number): { re: string; next: number } | null {
  let j = i + 1;
  let neg = false;
  if (seg[j] === "!" || seg[j] === "^") {
    neg = true;
    j++;
  }
  let body = "";
  let first = true;
  while (j < seg.length) {
    const c = seg[j] as string;
    if (c === "]" && !first) return { re: `[${neg ? "^" : ""}${body}]`, next: j + 1 };
    first = false;
    if (c === "[" && seg[j + 1] === ":") {
      const end = seg.indexOf(":]", j + 2);
      const cls = end < 0 ? undefined : CLASSES[seg.slice(j + 2, end)];
      if (cls !== undefined) {
        body += cls;
        j = end + 2;
        continue;
      }
    }
    if (c === "\\" && j + 1 < seg.length) {
      body += literalChar(seg[j + 1] as string);
      j += 2;
      continue;
    }
    body += c === "-" ? "-" : literalChar(c);
    j++;
  }
  return null;
}

function segmentRegExp(seg: string): RegExp {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i] as string;
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "\\" && i + 1 < seg.length) re += literalChar(seg[++i] as string);
    else if (c === "[") {
      const b = bracket(seg, i);
      if (b === null) re += "\\[";
      else {
        re += b.re;
        i = b.next - 1;
      }
    } else re += literalChar(c);
  }
  return new RegExp(`^${re}$`, "s");
}

function unescape(seg: string): string {
  return seg.replace(/\\(.)/gs, "$1");
}

function join(base: string, name: string): string {
  if (base === "") return name;
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

function isDir(p: string): boolean {
  return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
}

function children(dir: string): string[] {
  try {
    return fs.readdirSync(dir === "" ? "." : dir);
  } catch {
    return [];
  }
}

function walk(base: string, segs: readonly string[], root: string, out: Set<string>): void {
  const [seg, ...rest] = segs;
  const at = (p: string): string => path.resolve(root, p === "" ? "." : p);
  if (seg === undefined) {
    out.add(base);
    return;
  }
  if (seg === "**") {
    if (rest.length > 0) walk(base, rest, root, out);
    for (const name of children(at(base))) {
      if (name.startsWith(".")) continue;
      const p = join(base, name);
      if (rest.length === 0) out.add(p);
      if (fs.lstatSync(at(p), { throwIfNoEntry: false })?.isDirectory()) walk(p, segs, root, out);
    }
    return;
  }
  if (!MAGIC.test(seg)) {
    const p = join(base, unescape(seg));
    const there =
      rest.length === 0
        ? fs.lstatSync(at(p), { throwIfNoEntry: false }) !== undefined
        : isDir(at(p));
    if (there) walk(p, rest, root, out);
    return;
  }
  const re = segmentRegExp(seg);
  const dotOk = seg.startsWith(".") || seg.startsWith("\\.");
  for (const name of children(at(base))) {
    if (name.startsWith(".") && !dotOk) continue;
    if (!re.test(name)) continue;
    const p = join(base, name);
    if (rest.length === 0 || isDir(at(p))) walk(p, rest, root, out);
  }
}

/** Expand one word; a word with a magic character and no match expands to nothing. */
export function expand(word: string, cwd: string): string[] {
  if (!MAGIC.test(word)) return [word];
  const abs = word.startsWith("/");
  const segs = word.split("/").filter((s) => s !== "");
  const found = new Set<string>();
  walk(abs ? "/" : "", segs, cwd, found);
  return [...found].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}
