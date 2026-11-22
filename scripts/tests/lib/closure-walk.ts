// closure-walk.ts — the static closure of the framework archive (spec 0315 R10, R12; spec 0243 delta-05 R41(c)).
//
// The walk starts at entry files and follows what a file can load at run time, not only its import specifiers:
//   - `import ... from "x"`, `export ... from "x"`, `import "x"`, `import("x")`, `require("x")` with a relative
//     specifier;
//   - MODULE-PATH STRINGS: a relative string literal that names a code file (`"./mcp-claude-step.ts"` in a table of
//     strategy files, which steps-mcp.ts loads with a variable `import()`), and the spawned scripts of the form
//     `path.join(<root>, "scripts", "tls-exec.ts")` or the literal `"scripts/tls-exec.ts"`.
// A file is resolved against the archive (a map of path to bytes). A reference that names a file the checkout
// tracks but the archive lacks is reported as missing, which is how a manifest that forgets a file fails.
//
// The walk is deliberately lexical: it needs no parser, so it can run on the archive's own bytes. Its limits are
// the tests' own: a test shows the walk is not vacuous (known files are reached) and that removing any reached
// file makes it report a hole.

import path from "node:path";
import { classifyEnvName } from "./env-classes.ts";

export type Files = ReadonlyMap<string, Buffer>;

const CODE = /\.(ts|js|mjs|cjs|py)$/;
const RELATIVE_STRING = /["'`](\.{1,2}\/[\w./@-]+\.(?:ts|js|mjs|cjs|py))["'`]/g;
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const JOIN_CALL = /\bpath\.(?:join|resolve)\(([^()]*)\)/g;
const LITERAL = /["']([^"']*)["']/g;
const ROOTED_STRING =
  /["'`]((?:scripts|hooks|config|artifacts)\/[\w./@-]+\.(?:ts|js|mjs|cjs|py))["'`]/g;
const ROOT_DIRS = new Set(["scripts", "hooks", "config", "artifacts"]);

/** Source text without line comments and block comments (strings that hold `//` are rare enough here). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const posix = path.posix;

/**
 * The archive paths a file refers to, by the four forms above, each as the alternatives that name it (a CommonJS
 * `require('./record')` has no extension: `record.js`, `record.ts`, `record/index.js`). Not yet checked for
 * existence.
 */
export function referencesOf(file: string, text: string): string[][] {
  const code = stripComments(text);
  const out = new Map<string, string[]>();
  const add = (...alternatives: string[]): void =>
    void out.set(alternatives.join("|"), alternatives);
  const here = posix.dirname(file);
  for (const match of code.matchAll(SPECIFIER)) {
    const spec = posix.normalize(posix.join(here, match[1] ?? ""));
    if (CODE.test(spec) || spec.endsWith(".json")) add(spec);
    else add(`${spec}.js`, `${spec}.ts`, `${spec}.json`, `${spec}/index.js`);
  }
  for (const match of code.matchAll(RELATIVE_STRING)) {
    add(posix.normalize(posix.join(here, match[1] ?? "")));
  }
  for (const match of code.matchAll(ROOTED_STRING)) add(match[1] ?? "");
  for (const call of code.matchAll(JOIN_CALL)) {
    const parts = [...(call[1] ?? "").matchAll(LITERAL)].map((m) => m[1] ?? "");
    const first = parts.findIndex((part) => ROOT_DIRS.has(part));
    if (first === -1) continue;
    const joined = posix.join(...parts.slice(first));
    if (CODE.test(joined)) add(joined);
  }
  return [...out.values()];
}

export interface Walk {
  /** Every archive path reached, entries included, in discovery order. */
  readonly reached: string[];
  /** References that the checkout tracks and the archive lacks: `from -> target`. */
  readonly missing: string[];
}

/**
 * Walk from `entries` over `files` (the archive). `tracked` says whether the checkout holds a path, so that a
 * reference to a file nobody ships (a string that is not a path of the repository) is not a hole; `unshipped`
 * names the references a command makes on purpose to a checkout-only file.
 */
export function walkClosure(
  files: Files,
  entries: readonly string[],
  tracked: (rel: string) => boolean,
  unshipped: ReadonlySet<string> = new Set(),
): Walk {
  const reached: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const bytes = files.get(file);
    if (bytes === undefined) {
      missing.push(file);
      continue;
    }
    reached.push(file);
    if (!CODE.test(file) || file.endsWith(".py")) continue;
    for (const alternatives of referencesOf(file, bytes.toString("utf8"))) {
      const present = alternatives.find((ref) => files.has(ref));
      if (present !== undefined) queue.push(present);
      else {
        const named = alternatives.find((ref) => tracked(ref) && !unshipped.has(ref));
        if (named !== undefined) missing.push(`${file} -> ${named}`);
      }
    }
  }
  return { reached, missing };
}

// ---------------------------------------------------------------------------------------- module scopes

export interface ScopeFinding {
  readonly file: string;
  readonly problem: string;
}

/** ESM syntax at the start of a line, or `import.meta`. */
export function hasEsmSyntax(text: string): boolean {
  const code = stripComments(text);
  return /^(?:import\s*[\w{*"']|export\s)/m.test(code) || /\bimport\.meta\b/.test(code);
}

/** CommonJS-only bindings: `require(`, `module.exports`, `exports.x =`, `__dirname`, `__filename`. */
export function hasCommonJsSyntax(text: string): boolean {
  const code = stripComments(text);
  return /(?:^|[^.\w])(?:require\s*\(|module\.exports\b|exports\.\w+\s*=|__dirname\b|__filename\b)/.test(
    code,
  );
}

/** The `type` of the nearest package.json at or above `file` in the archive, and where it was found. */
export function scopeOf(files: Files, file: string): { dir: string; type: string | undefined } {
  let dir = posix.dirname(file);
  for (;;) {
    const pkg = files.get(dir === "." ? "package.json" : `${dir}/package.json`);
    if (pkg !== undefined) {
      const parsed = JSON.parse(pkg.toString("utf8")) as { type?: unknown };
      return { dir, type: typeof parsed.type === "string" ? parsed.type : undefined };
    }
    if (dir === "." || dir === "/") return { dir: ".", type: undefined };
    dir = posix.dirname(dir);
  }
}

/**
 * spec 0243 delta-05 R41(c): every reached `.js` file with CommonJS syntax resolves to a nearest package.json
 * declaring "commonjs", and every reached file with import/export syntax resolves to the archive root ("module").
 */
export function checkScopes(files: Files, reached: readonly string[]): ScopeFinding[] {
  const findings: ScopeFinding[] = [];
  for (const file of reached) {
    if (!/\.(js|ts|mjs)$/.test(file)) continue;
    const text = (files.get(file) as Buffer).toString("utf8");
    const scope = scopeOf(files, file);
    if (hasEsmSyntax(text) && !(scope.dir === "." && scope.type === "module")) {
      findings.push({
        file,
        problem: `has import/export syntax and its scope is ${scope.dir}/package.json (${String(scope.type)}), not the archive root`,
      });
    }
    if (
      file.endsWith(".js") &&
      hasCommonJsSyntax(text) &&
      !hasEsmSyntax(text) &&
      !/typeof\s+module\b/.test(text) && // a guarded `module.exports` runs under either scope
      scope.type !== "commonjs"
    ) {
      findings.push({
        file,
        problem: `has CommonJS syntax and its scope is ${scope.dir}/package.json (${String(scope.type)}), not commonjs`,
      });
    }
  }
  return findings;
}

// ------------------------------------------------------------------------------- environment reads (R12)

/**
 * The `CREWRIG_*`, `MEMPALACE_*` and `MCP_DAEMON_*` names a file uses as an environment key: a string literal that is
 * exactly the name, or a member of an `env` object (`env.NAME`, `env?.NAME`). A constant such as
 * `MCP_DAEMON_PORT_DEFAULT` is neither.
 */
export function envNamesOf(text: string): string[] {
  const code = stripComments(text);
  const name = "(?:CREWRIG_[A-Z0-9_]+|MEMPALACE_[A-Z0-9_]+|MCP_DAEMON_[A-Z0-9_]+)";
  const found = new Set<string>();
  for (const pattern of [
    new RegExp(`["'\`](${name})["'\`]`, "g"),
    new RegExp(`\\benv\\??\\.(${name})\\b`, "g"),
  ]) {
    for (const match of code.matchAll(pattern)) found.add(match[1] ?? "");
  }
  return [...found];
}

/** Names of the R12 neighbourhood that env.ts neither strips nor passes through on purpose. */
export function uncoveredEnvNames(files: Files, reached: readonly string[]): string[] {
  const uncovered = new Set<string>();
  for (const file of reached) {
    if (!CODE.test(file) || file.endsWith(".py")) continue;
    for (const name of envNamesOf((files.get(file) as Buffer).toString("utf8"))) {
      if (classifyEnvName(name) === "uncovered") uncovered.add(`${name} (${file})`);
    }
  }
  return [...uncovered].sort();
}

/**
 * Reads of `process.env` at module scope, which run while the module loads: outside every brace, and not a
 * parameter default (`(env = process.env) =>` runs when the function is called).
 */
export function topLevelEnvReads(file: string, text: string): string[] {
  const code = stripComments(text).replace(/\w+\s*(?::[^=,){]+)?=\s*process\.env(?=\s*[,)])/g, "");
  const found: string[] = [];
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      code.startsWith("process.env", i) &&
      !/[\w$.]/.test(code[i - 1] ?? "")
    ) {
      const from = code.lastIndexOf("\n", i) + 1;
      const line = code.slice(from, code.indexOf("\n", i)).trim();
      if (!/^\w+\??\s*(?::[^=]*)?=\s*process\.env,?$/.test(line)) found.push(`${file}: ${line}`);
    }
  }
  return found;
}
