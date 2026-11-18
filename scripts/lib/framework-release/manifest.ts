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

export function parseManifest(text: string): string[] {
  const entries: string[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const bad =
      line.includes("\\") ||
      line.startsWith("/") ||
      line.endsWith("/") ||
      line.split("/").some((part) => part === "" || part === "." || part === "..");
    if (bad)
      throw new ManifestError(`manifest line ${index + 1}: '${line}' is not a clean relative path`);
    if (entries.includes(line))
      throw new ManifestError(`manifest line ${index + 1}: '${line}' is listed twice`);
    entries.push(line);
  }
  if (entries.length === 0) throw new ManifestError("the manifest lists no entry");
  return entries;
}

export interface ShippedFile {
  /** Flat repository-relative path, the path inside the archive. */
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

/** Resolve the entries to the files they ship, in byte order of their path. */
export function resolveManifest(root: string, entries: readonly string[]): ShippedFile[] {
  const tracked = trackedFiles(root);
  const found = new Map<string, ShippedFile>();
  for (const entry of entries) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(path.join(root, entry));
    } catch {
      throw new ManifestError(`manifest entry '${entry}' is absent from the build output`);
    }
    const files: string[] = [];
    if (stat.isDirectory()) walk(root, entry, files);
    else if (stat.isFile()) files.push(entry);
    else throw new ManifestError(`manifest entry '${entry}' is not a regular file or directory`);
    const shipped = files.filter((f) => f.startsWith(OUTPUT_PREFIX) || tracked.has(f));
    if (shipped.length === 0) {
      throw new ManifestError(
        `manifest entry '${entry}' holds no file to ship (none is tracked by git)`,
      );
    }
    for (const rel of shipped) {
      const mode = fs.statSync(path.join(root, rel)).mode;
      found.set(rel, {
        path: rel,
        abs: path.join(root, rel),
        mode: (mode & 0o111) !== 0 ? 0o755 : 0o644,
      });
    }
  }
  return [...found.values()].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  );
}
