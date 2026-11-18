// extension-dirs.ts — the extension directories a flow walks: the shell's `extensions/*/*/` glob
// (a directory two levels below `extensions/`, in byte order) and the sorted `*.tar.gz` of an
// output directory (`ls "$out"/*.tar.gz | head -n 1`).

import fs from "node:fs";
import path from "node:path";

import { ReleaseRefusal } from "./refusal.ts";

function sortedDirs(parent: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(parent);
  } catch {
    return [];
  }
  return names
    .filter((name) => {
      // The shell glob `*/` never matches a name that starts with a dot.
      if (name.startsWith(".")) return false;
      try {
        return fs.statSync(path.join(parent, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Every `<base>/extensions/<group>/<name>` directory, as absolute paths in byte order. */
export function extensionDirs(base: string): string[] {
  const top = path.join(base, "extensions");
  return sortedDirs(top).flatMap((group) =>
    sortedDirs(path.join(top, group)).map((name) => path.join(top, group, name)),
  );
}

/** The first `*.tar.gz` of `dir` in name order, or `undefined` when there is none. */
export function firstArchive(dir: string): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const first = names.filter((name) => name.endsWith(".tar.gz")).sort()[0];
  return first === undefined ? undefined : path.join(dir, first);
}

/**
 * Spec 0310 R2: an extension named `crewrig` would tag `crewrig-v<version>`, the tag form of the
 * framework release unit; refuse before anything is written so `<ext>-v*` and `crewrig-v*` stay disjoint.
 */
export function assertNoCrewrigExtension(base: string): void {
  const clash = extensionDirs(base).find((dir) => path.basename(dir) === "crewrig");
  if (clash !== undefined) {
    throw new ReleaseRefusal(
      `extension directory named crewrig (${path.relative(base, clash)}): its tag would collide with the framework release tag crewrig-v*`,
    );
  }
}
