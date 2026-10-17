// comments.ts — `key | line_comment` for block-mapping keys (spec 0262 req 24, v3-F1).
//
// js-yaml discards comments, so this is a line scanner. Rules proven against yq v4.44.3
// (scripts/tests/model-ci-tooling-yq-comments.test.ts):
//   - the comment belongs to the key only when nothing but whitespace sits between the
//     key's colon and the `#` (`a: v # c`, `a: &x # c`, `a: | # c` all yield "");
//   - a leading `# ` is stripped (hash plus one space), anything else is kept whole
//     (`#x` -> `#x`, `#` -> `#`, `## y` -> `## y`), trailing whitespace is kept, CR dropped;
//   - a comment on the following line, or a `#` inside a quoted scalar, never counts.
// Explicit `? key` entries and multi-line keys at the scanned indent are reader gaps.

export class CommentScanGap extends Error {}

export interface KeyComment {
  key: string;
  comment: string;
}

const BLOCK_HEADER = /(?:^|[\s:])(?:&\S+\s+|!\S*\s+)*[|>][-+0-9]*\s*(?:#.*)?$/;

function indentOf(line: string): number {
  let n = 0;
  while (line[n] === " ") n++;
  return n;
}

/** Parse `key:` at the start of `body`; returns the decoded key and the text after the colon. */
function splitKey(body: string): { key: string; rest: string } | null {
  const q = body[0];
  if (q === '"' || q === "'") {
    let key = "";
    let i = 1;
    for (; i < body.length; i++) {
      const c = body[i] as string;
      if (q === "'" && c === "'") {
        if (body[i + 1] === "'") {
          key += "'";
          i++;
          continue;
        }
        break;
      }
      if (q === '"' && c === "\\") {
        key += body[i + 1] ?? "";
        i++;
        continue;
      }
      if (q === '"' && c === '"') break;
      key += c;
    }
    if (i >= body.length) throw new CommentScanGap("multi-line quoted key");
    const after = body.slice(i + 1).replace(/^[ \t]*/, "");
    return after[0] === ":" && (after.length === 1 || /[ \t]/.test(after[1] as string))
      ? { key, rest: after.slice(1) }
      : null;
  }
  const m = /^((?:[^:#]|:(?![ \t]|$))+?)[ \t]*:(?:[ \t]|$)/.exec(body);
  return m === null ? null : { key: (m[1] as string).trimEnd(), rest: body.slice(m[0].length) };
}

function lineComment(rest: string): string {
  const t = rest.replace(/^[ \t]+/, "");
  if (!t.startsWith("#")) return "";
  return t.startsWith("# ") ? t.slice(2) : t;
}

/**
 * The keys of the block mapping under top-level key `parent` (or the top-level mapping when
 * `parent` is null), each with its `key | line_comment`, in document order.
 */
export function keyComments(text: string, parent: string | null): KeyComment[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: KeyComment[] = [];
  let childIndent = parent === null ? 0 : -1;
  let inside = parent === null;
  let blockOwner = -1; // indent of the line owning the current block scalar
  for (const line of lines) {
    const blank = line.trim() === "";
    const ind = indentOf(line);
    if (blockOwner >= 0) {
      if (blank || ind > blockOwner) continue;
      blockOwner = -1;
    }
    if (blank || line.trimStart().startsWith("#")) continue;
    if (ind === 0 && /^(---|\.\.\.)(\s|$)/.test(line)) continue;
    if (ind === 0 && line.startsWith("%")) continue;
    if (parent !== null && ind === 0) {
      const owner = splitKey(line);
      inside = owner !== null && owner.key === parent;
      childIndent = -1;
      if (BLOCK_HEADER.test(line)) blockOwner = 0;
      continue;
    }
    if (!inside) {
      if (BLOCK_HEADER.test(line)) blockOwner = ind;
      continue;
    }
    if (childIndent < 0) childIndent = ind;
    if (ind === childIndent) {
      if (line[ind] === "?") throw new CommentScanGap("explicit key");
      if (line[ind] !== "-") {
        const kv = splitKey(line.slice(ind));
        if (kv !== null) out.push({ key: kv.key, comment: lineComment(kv.rest) });
      }
    }
    if (BLOCK_HEADER.test(line)) blockOwner = ind;
  }
  return out;
}
