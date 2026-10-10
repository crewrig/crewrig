// setup-source-scan.ts — the small static-analysis helpers the setup guard tests share (spec 0256
// requirements 3, 20, 39): a comment stripper that keeps string literals and line numbers, a recursive
// TypeScript lister, an import-specifier extractor, and the static import closure of a set of modules.
// Plain text scanning, no parser and no third-party package.

import fs from "node:fs";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const REGEX_PREV = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_WORDS = /(?:^|[^\w$])(?:return|typeof|case|void|in|of|delete|throw|yield|await)$/;

/** Source text with every comment replaced by spaces (newlines kept, so line numbers stay true). */
export function stripComments(text: string): string {
  const out: string[] = [];
  // Brace depth of each open `${ ... }` substitution of a template literal, innermost last.
  const subst: number[] = [];
  let mode: "code" | "line" | "block" | "'" | '"' | "`" | "regex" = "code";
  let inClass = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (mode === "line") {
      if (ch === "\n") {
        mode = "code";
        out.push(ch);
      } else out.push(" ");
    } else if (mode === "block") {
      if (ch === "*" && next === "/") {
        out.push("  ");
        i++;
        mode = "code";
      } else out.push(ch === "\n" ? "\n" : " ");
    } else if (mode === "'" || mode === '"') {
      out.push(ch);
      if (ch === "\\" && next !== undefined) {
        out.push(next);
        i++;
      } else if (ch === mode || ch === "\n") mode = "code";
    } else if (mode === "`") {
      out.push(ch);
      if (ch === "\\" && next !== undefined) {
        out.push(next);
        i++;
      } else if (ch === "`") mode = "code";
      else if (ch === "$" && next === "{") {
        out.push("{");
        i++;
        subst.push(0);
        mode = "code";
      }
    } else if (mode === "regex") {
      out.push(ch);
      if (ch === "\\" && next !== undefined) {
        out.push(next);
        i++;
      } else if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if ((ch === "/" && !inClass) || ch === "\n") mode = "code";
    } else if (ch === "/" && next === "/") {
      out.push("  ");
      i++;
      mode = "line";
    } else if (ch === "/" && next === "*") {
      out.push("  ");
      i++;
      mode = "block";
    } else if (ch === "/" && startsRegex(out)) {
      out.push(ch);
      mode = "regex";
      inClass = false;
    } else {
      out.push(ch);
      if (ch === "'" || ch === '"' || ch === "`") mode = ch;
      else if (ch === "{" && subst.length > 0) subst[subst.length - 1] += 1;
      else if (ch === "}" && subst.length > 0) {
        if (subst[subst.length - 1] === 0) {
          subst.pop();
          mode = "`";
        } else subst[subst.length - 1] -= 1;
      }
    }
  }
  return out.join("");
}

function startsRegex(out: readonly string[]): boolean {
  let k = out.length - 1;
  while (k >= 0 && /\s/.test(out[k] as string)) k--;
  if (k < 0) return true;
  if (REGEX_PREV.has(out[k] as string)) return true;
  return REGEX_WORDS.test(out.slice(Math.max(0, k - 12), k + 1).join(""));
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

/** Every `.ts` file under `dir` (absolute or repo-relative), as sorted repo-relative POSIX paths; empty when absent. */
export function listTsFiles(dir: string, root: string = REPO): string[] {
  const start = path.resolve(root, dir);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts"))
        found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(start)) walk(start);
  return found.sort();
}

/** Repo-relative files directly inside `dir` whose name matches `re` (empty when `dir` is absent). */
export function listMatching(dir: string, re: RegExp, root: string = REPO): string[] {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((name) => re.test(name))
    .sort()
    .map((name) => `${dir}/${name}`);
}

const FROM_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?(["'])([^"'\n]+)\1/g;
const CALL_RE = /\b(?:import|require)\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/** The `import ... from`, `export ... from`, `import()` and `require()` specifiers of a module, with their line. */
export function importSpecifiers(source: string): { specifier: string; line: number }[] {
  const code = stripComments(source);
  const found: { specifier: string; line: number }[] = [];
  for (const re of [FROM_RE, CALL_RE]) {
    for (const m of code.matchAll(re)) {
      found.push({ specifier: m[2] as string, line: lineOf(code, m.index ?? 0) });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

const EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

export interface Closure {
  /** Repo-relative POSIX paths of every module reached, entries included. */
  readonly files: Set<string>;
  /** Specifiers that are neither `node:`-prefixed nor repo-relative. */
  readonly bare: Finding[];
  /** Relative specifiers that resolve to no file. */
  readonly unresolved: Finding[];
}

/** The static import closure of `entries` (paths relative to `root`), following repo-relative specifiers. */
export function importClosure(entries: readonly string[], root: string = REPO): Closure {
  const rel = (abs: string): string => path.relative(root, abs).split(path.sep).join("/");
  const closure: Closure = { files: new Set(), bare: [], unresolved: [] };
  const queue = entries.map((e) => path.resolve(root, e));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (closure.files.has(rel(file))) continue;
    closure.files.add(rel(file));
    if (!/\.(ts|js|mjs|cjs)$/.test(file)) continue;
    for (const { specifier, line } of importSpecifiers(fs.readFileSync(file, "utf8"))) {
      if (specifier.startsWith("node:")) continue;
      if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (target === undefined)
          closure.unresolved.push({ file: rel(file), line, text: specifier });
        else if (/\.(ts|js|mjs|cjs)$/.test(target)) queue.push(target);
      } else closure.bare.push({ file: rel(file), line, text: specifier });
    }
  }
  return closure;
}
