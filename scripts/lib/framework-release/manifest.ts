// manifest.ts — read the committed manifest and resolve it against the build output (spec 0310 R3).
// An entry absent from the output fails the build; a file the manifest does not list is never shipped.

import fs from "node:fs";
import path from "node:path";

import { gitText } from "./git.ts";

export class ManifestError extends Error {}

/** Where the manifest lives, next to this file. */
export const MANIFEST_FILE = path.join(import.meta.dirname, "manifest.txt");

/** Build output that git ignores by design; every other shipped file must be tracked. */
const OUTPUT_PREFIX = "dist/";

/** The separator of a mapped line `<archive-path> <- <source>` (spec 0315 R11). */
const MAPPING = " <- ";

/** One manifest line: the path inside the archive and the repository path its content comes from. */
export interface ManifestEntry {
  readonly archive: string;
  readonly source: string;
}

function isCleanRelative(p: string): boolean {
  return !(
    p.includes("\\") ||
    p.startsWith("/") ||
    p.endsWith("/") ||
    p.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

/**
 * Parse the manifest lines. A plain line names a path that is both the archive path and the source; a
 * mapped line `<archive-path> <- <source>` ships a git-tracked file under another archive path (spec
 * 0315 R11, the archive-root package.json).
 */
export function parseManifestEntries(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split(MAPPING);
    const archive = parts[0] ?? "";
    const source = parts.length === 2 ? (parts[1] ?? "") : archive;
    const clean = parts.length <= 2 && isCleanRelative(archive) && isCleanRelative(source);
    if (!clean)
      throw new ManifestError(`manifest line ${index + 1}: '${line}' is not a clean relative path`);
    if (entries.some((entry) => entry.archive === archive))
      throw new ManifestError(`manifest line ${index + 1}: '${archive}' is listed twice`);
    entries.push({ archive, source });
  }
  if (entries.length === 0) throw new ManifestError("the manifest lists no entry");
  return entries;
}

/** The archive paths of the manifest, in manifest order. */
export function parseManifest(text: string): string[] {
  return parseManifestEntries(text).map((entry) => entry.archive);
}

export interface ShippedFile {
  /** Flat archive path, the path inside the archive. */
  readonly path: string;
  readonly abs: string;
  readonly mode: number;
}

function trackedFiles(root: string): Set<string> {
  return new Set(
    gitText(root, ["ls-files", "-z", "--cached"])
      .split("\0")
      .filter((p) => p !== ""),
  );
}

function walk(root: string, rel: string, out: string[]): void {
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const child = `${rel}/${name}`;
    const stat = fs.lstatSync(path.join(root, child));
    if (stat.isDirectory()) walk(root, child, out);
    else if (stat.isFile()) out.push(child);
    else throw new ManifestError(`cannot archive '${child}': not a regular file or directory`);
  }
}

/** Resolve the entries to the files they ship, in byte order of their archive path. */
export function resolveManifest(root: string, entries: readonly ManifestEntry[]): ShippedFile[] {
  const tracked = trackedFiles(root);
  const found = new Map<string, { source: string; file: ShippedFile }>();
  const add = (archive: string, source: string): void => {
    const prior = found.get(archive);
    if (prior !== undefined && prior.source !== source) {
      throw new ManifestError(
        `archive path '${archive}' is provided twice: by '${prior.source}' and by '${source}'`,
      );
    }
    const mode = fs.statSync(path.join(root, source)).mode;
    found.set(archive, {
      source,
      file: {
        path: archive,
        abs: path.join(root, source),
        mode: (mode & 0o111) !== 0 ? 0o755 : 0o644,
      },
    });
  };
  for (const entry of entries) {
    const { archive, source } = entry;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(path.join(root, source));
    } catch {
      throw new ManifestError(`manifest entry '${source}' is absent from the build output`);
    }
    if (archive !== source) {
      // A mapped file: git must track it, and no dist/ exemption applies (spec 0315 R11).
      if (!stat.isFile() || !tracked.has(source)) {
        throw new ManifestError(
          `manifest entry '${archive} <- ${source}' must map a file that git tracks`,
        );
      }
      add(archive, source);
      continue;
    }
    const files: string[] = [];
    if (stat.isDirectory()) walk(root, source, files);
    else if (stat.isFile()) files.push(source);
    else throw new ManifestError(`manifest entry '${source}' is not a regular file or directory`);
    const shipped = files.filter((f) => f.startsWith(OUTPUT_PREFIX) || tracked.has(f));
    if (shipped.length === 0) {
      throw new ManifestError(
        `manifest entry '${source}' holds no file to ship (none is tracked by git)`,
      );
    }
    for (const rel of shipped) add(rel, rel);
  }
  return [...found.values()]
    .map((value) => value.file)
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
