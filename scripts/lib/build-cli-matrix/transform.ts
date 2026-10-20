// transform.ts — pure text transforms of the CLI-matrix generator (spec 0272 R2, R11).
//
// Usage: demoteHeadings(text, offset), rewriteLinks(text, prefix, where)
// Exit codes: not applicable (library); failures throw Error.
// Finding-line format: not applicable.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})([ \t].*)?$/;
const ABSOLUTE_TARGET = /^([a-z][a-z0-9+.-]*:|\/|#)/i;

/** Apply `visit` to every line outside fenced code blocks; fenced lines pass through. */
function mapOutsideFences(text: string, visit: (line: string) => string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const m = FENCE.exec(line);
      if (fence === null) {
        if (m) fence = m[1]!;
        else return visit(line);
      } else if (
        m &&
        m[1]![0] === fence[0] &&
        m[1]!.length >= fence.length &&
        /^\s*$/.test(line.slice(m[0].length))
      ) {
        fence = null;
      }
      return line;
    })
    .join("\n");
}

/** Demote every ATX heading outside fenced blocks by `offset` levels (max level 6). */
export function demoteHeadings(text: string, offset: number, where: string): string {
  if (offset === 0) return text;
  return mapOutsideFences(text, (line) => {
    const m = HEADING.exec(line);
    if (!m) return line;
    const level = m[1]!.length + offset;
    if (level > 6) throw new Error(`${where}: heading "${line}" cannot be demoted past level 6`);
    return `${"#".repeat(level)}${m[2] ?? ""}`;
  });
}

/** Rewrite source-relative inline-link targets to the docs-relative form by stripping `prefix`. */
function rewriteLine(line: string, prefix: string, where: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "`") {
      let n = 1;
      while (line[i + n] === "`") n++;
      const run = "`".repeat(n);
      const close = line.indexOf(run, i + n);
      if (close === -1) {
        out += run;
        i += n;
      } else {
        out += line.slice(i, close + n);
        i = close + n;
      }
      continue;
    }
    if (ch === "]" && line[i + 1] === "(") {
      let j = i + 2;
      while (j < line.length && line[j] !== ")" && !/\s/.test(line[j]!)) j++;
      const target = line.slice(i + 2, j);
      if (target === "" || ABSOLUTE_TARGET.test(target)) {
        out += line.slice(i, j);
      } else if (target.startsWith(prefix)) {
        out += `](${target.slice(prefix.length)}`;
      } else {
        throw new Error(`${where}: link target "${target}" lacks the expected prefix "${prefix}"`);
      }
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function rewriteLinks(text: string, prefix: string, where: string): string {
  return mapOutsideFences(text, (line) => rewriteLine(line, prefix, where));
}
