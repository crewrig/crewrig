// jsonc.ts — text-level scanners for the JSON-with-comments dialect Gemini CLI
// reads (spec 0214, spec 0245 R8 and R12).
//
// Neither function parses JSON: `stripJsonComments` turns JSONC text into text
// `JSON.parse` can read, and `findDuplicateKey` inspects text `JSON.parse`
// already accepted. Both are single linear passes with no backtracking.
//
// Standard library only (spec 0240 R16).

/**
 * Remove comments the way `gs_strip_jsonc` (scripts/lib/gemini-settings.sh)
 * and strip-json-comments do:
 *   - a string literal is kept whole, so `//`, `/*` and an escaped quote
 *     inside it are never read as a comment; a string never closed runs to
 *     the end of the text — unless the text ends in the lone backslash of an
 *     unfinished escape: there gs_strip_jsonc matches no string, so the quote
 *     is plain text, and this port follows it (strip-json-comments would run
 *     the string to the end; both results are invalid JSON either way);
 *   - a line comment runs to (not including) the end of its line;
 *   - a block comment runs to its closing `*` + `/`, or to the end of the text
 *     when it is never closed;
 *   - each comment becomes ONE space, so `1/**\/2` stays two tokens.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let keptFrom = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      i++;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      if (i < n) {
        i++; // the closing quote
      } else if (i > n) {
        // A lone backslash ends the text: no string literal matches here, as
        // in gs_strip_jsonc, so the quote is plain text and the scan resumes
        // right after it (`"a//b\` becomes `"a `).
        i = start + 1;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      out += `${text.slice(keptFrom, i)} `;
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      keptFrom = i;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      out += `${text.slice(keptFrom, i)} `;
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? n : close + 2;
      keptFrom = i;
      continue;
    }
    i++;
  }
  return out + text.slice(keptFrom);
}

const WS = new Set([" ", "\t", "\n", "\r"]);

/**
 * The first duplicated object key in `text`, as the path of decoded key
 * segments from the root (array positions as decimal strings, the duplicate
 * key last), or `null` when every object's keys are distinct. Keys compare by
 * their decoded value, so `"a"` and `"a"` collide. `text` must be text
 * `JSON.parse` accepted; on anything else the result is unspecified.
 */
export function findDuplicateKey(text: string): readonly string[] | null {
  interface Frame {
    readonly kind: "object" | "array";
    readonly keys: Set<string>;
    index: number;
    pendingKey: string | null;
  }
  const stack: Frame[] = [];
  const route: string[] = [];
  let i = 0;
  const n = text.length;

  const readString = (): string => {
    const start = i;
    i++;
    while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };

  while (i < n) {
    const c = text[i] as string;
    if (WS.has(c) || c === ",") {
      if (c === "," && stack.at(-1)?.kind === "array") (stack.at(-1) as Frame).index++;
      i++;
      continue;
    }
    const top = stack.at(-1);
    if (c === '"') {
      const value = readString();
      // A string is a key when it sits in an object and a `:` follows it.
      let j = i;
      while (j < n && WS.has(text[j] as string)) j++;
      if (top?.kind === "object" && text[j] === ":") {
        if (top.keys.has(value)) return [...route, value];
        top.keys.add(value);
        top.pendingKey = value;
        i = j + 1;
      }
      continue;
    }
    if (c === "{" || c === "[") {
      if (top !== undefined)
        route.push(top.kind === "object" ? (top.pendingKey ?? "") : String(top.index));
      stack.push({
        kind: c === "{" ? "object" : "array",
        keys: new Set(),
        index: 0,
        pendingKey: null,
      });
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length > 0) route.pop();
      i++;
      continue;
    }
    // number, true, false, null: skip the token
    i++;
  }
  return null;
}
