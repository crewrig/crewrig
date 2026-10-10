// setup-golden-tree.ts — placeholders and the file-tree capture of the setup golden harness
// (spec 0256 requirement 7, plan v2 step A5). `normalize` replaces what varies between runs;
// `snapshot` + `treeOf` record what a run wrote under the sandbox home and repository as the
// DIFFERENCE of two snapshots, so the checkout copied in by the fixture never shows up.
// API: normalize(text, roots) -> string; snapshot(roots) -> Snapshot;
//      treeOf(roots, before?) -> TreeEntry[]; bakCountOf(tree) -> Record<target, count>.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface Roots {
  readonly root: string;
  readonly repo: string;
  readonly home: string;
  /** Secret strings (the bearer the setup generated) replaced by `<TOKEN>` in every text. */
  readonly secrets?: readonly string[];
  /** Run-specific literals (a free TCP port) as [value, placeholder]; matched on token boundaries only. */
  readonly literals?: ReadonlyArray<readonly [string, string]>;
}

export interface TreeEntry {
  /** Relative path behind `<HOME>` or `<REPO>`, placeholdered, `/`-separated. */
  readonly path: string;
  readonly kind: "file" | "symlink" | "dir" | "removed";
  /** Files only: `0600`, `0644`, `0755`... (the permission bits, octal). */
  readonly mode?: string;
  /** Text files: sha256 of the placeholdered, LF-normalised content; binary files: of the bytes. */
  readonly sha256?: string;
  /** Symlinks only: `link -> <target placeholdered>`. */
  readonly target?: string;
}

export type Snapshot = ReadonlyMap<string, TreeEntry>;

/** Names never walked: version-control data and installed dependencies. */
const IGNORED = new Set([".git", "node_modules"]);

const BAK = /\.bak\.\d{8}-\d{6}(?:\.\d+)?/g;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/** `~/.mempalace/server/<sha256 of the palace path>/token`: the directory name derives from the sandbox path. */
const SERVER = /server\/[0-9a-f]{16,64}(?=\/|\b)/g;

/**
 * The bearer tokens the setup wrote under `<home>/.mempalace/server/<key>/token` (trimmed, at least
 * 8 characters, never the setup placeholder), for use as `Roots.secrets`.
 */
export function readTokens(home: string, placeholder: string): string[] {
  const base = path.join(home, ".mempalace/server");
  const found: string[] = [];
  if (!fs.existsSync(base)) return found;
  for (const key of fs.readdirSync(base)) {
    try {
      const token = fs.readFileSync(path.join(base, key, "token"), "utf8").trim();
      if (token.length >= 8 && token !== placeholder) found.push(token);
    } catch {
      // no token file in this directory
    }
  }
  return found;
}

function rootNames(roots: Roots): Array<[string, string]> {
  const named: Array<[string, string]> = [];
  const add = (dir: string, token: string): void => {
    named.push([dir, token]);
    try {
      const real = fs.realpathSync(dir);
      if (real !== dir) named.push([real, token]);
    } catch {
      // the directory is gone (disposed sandbox): only the literal spelling applies
    }
  };
  add(roots.root, "<SANDBOX>");
  add(roots.repo, "<REPO>");
  add(roots.home, "<HOME>");
  return named.sort((a, b) => b[0].length - a[0].length);
}

/**
 * Placeholders for what differs between runs: the sandbox root, repository and home (longest
 * first: the home sits inside the root), `.bak.<YYYYMMDD-HHMMSS>[.NN]` backup suffixes, ISO
 * timestamps, `mktemp` names (`tmp.XXXXXX`, `crewrig-*-XXXXXX`) and process ids.
 */
export function normalize(text: string, roots: Roots): string {
  let out = text;
  // Longest secret first; a secret is a random bearer, so it is replaced before anything else.
  for (const secret of [...(roots.secrets ?? [])].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("<TOKEN>");
  }
  for (const [dir, token] of rootNames(roots)) out = out.split(dir).join(token);
  for (const [value, token] of roots.literals ?? []) {
    out = out.replace(new RegExp(`(?<![0-9A-Za-z])${value}(?![0-9A-Za-z])`, "g"), token);
  }
  return out
    .replace(SERVER, "server/<SERVER>")
    .replace(BAK, ".bak.<STAMP>")
    .replace(ISO, "<ISO>")
    .replace(/\btmp\.[A-Za-z0-9]{6,}/g, "tmp.<RAND>")
    .replace(/\bcrewrig-[a-z]+-[A-Za-z0-9]{6}\b/g, "crewrig-<TMP>")
    .replace(/\b(pid|PID)([ =:]+)\d+/g, "$1$2<PID>")
    .replace(/\.(tmp|new|partial)\.\d+\b/g, ".$1.<PID>")
    .replace(/\r\n/g, "\n");
}

const sha = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

function entryOf(full: string, rel: string, roots: Roots): TreeEntry {
  const stat = fs.lstatSync(full);
  const at = normalize(rel, roots);
  if (stat.isSymbolicLink()) {
    const target = normalize(fs.readlinkSync(full), roots);
    return { path: at, kind: "symlink", target: `link -> ${target}` };
  }
  if (stat.isDirectory()) return { path: at, kind: "dir" };
  const bytes = fs.readFileSync(full);
  const mode = `0${(stat.mode & 0o777).toString(8)}`;
  const text = bytes.includes(0) ? undefined : normalize(bytes.toString("utf8"), roots);
  return { path: at, kind: "file", mode, sha256: sha(text ?? bytes) };
}

function walk(base: string, token: string, roots: Roots, out: Map<string, TreeEntry>): void {
  const visit = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (IGNORED.has(name)) continue;
      const full = path.join(dir, name);
      const rel = `${token}/${path.relative(base, full).split(path.sep).join("/")}`;
      out.set(full, entryOf(full, rel, roots));
      if (fs.lstatSync(full).isDirectory()) visit(full);
    }
  };
  if (fs.existsSync(base)) visit(base);
}

/** Every entry under the sandbox home and repository (not `.git`, not `node_modules`), by absolute path. */
export function snapshot(roots: Roots): Snapshot {
  const out = new Map<string, TreeEntry>();
  walk(roots.home, "<HOME>", roots, out);
  walk(roots.repo, "<REPO>", roots, out);
  return out;
}

const sameEntry = (a: TreeEntry, b: TreeEntry): boolean => JSON.stringify(a) === JSON.stringify(b);

const byPath = (a: TreeEntry, b: TreeEntry): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : (a.sha256 ?? "") < (b.sha256 ?? "") ? -1 : 1;

/**
 * What a run added, changed or removed since `before` (an empty snapshot when omitted), sorted by
 * path. A removed entry is `{kind: "removed"}`; backup files of one target share the placeholder
 * `.bak.<STAMP>` spelling and stay separate entries.
 */
export function treeOf(roots: Roots, before: Snapshot = new Map()): TreeEntry[] {
  const after = snapshot(roots);
  const tree: TreeEntry[] = [];
  for (const [file, entry] of after) {
    const prior = before.get(file);
    if (prior === undefined || !sameEntry(prior, entry)) tree.push(entry);
  }
  for (const [file, entry] of before) {
    if (!after.has(file)) tree.push({ path: entry.path, kind: "removed" });
  }
  return tree.sort(byPath);
}

/** The number of `.bak.<STAMP>` files per backed-up target (path without the suffix). */
export function bakCountOf(tree: readonly TreeEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of tree) {
    if (entry.kind === "removed") continue;
    const target = /^(.*)\.bak\.<STAMP>$/.exec(entry.path)?.[1];
    if (target === undefined) continue;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}
