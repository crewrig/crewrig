// antigravity-migrate.ts — TypeScript twin of `migrate_antigravity_superseded_components`
// and its readers in scripts/lib/common.sh (spec 0255, 0215 F2).
//
// Removes framework-installed components left at the superseded Antigravity
// placement. The predicate is a CONJUNCTION: a served name AND leading-frontmatter
// `metadata.provenance.canonical`; a provenance-only leftover is REPORTED, never
// removed. Both readers stop at the closing `---`. Output goes to injected sinks.

import fs from "node:fs";

/** Output sinks; one call per line, without a trailing newline. */
export interface MigrateIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** `status` is 1 only for the shell's empty-name-set `return 1`. */
export interface MigrateResult {
  status: number;
  removed: number;
}

const TIERS = ["library", "community", "org"] as const;

/** The file whose presence makes a component of that kind real. */
function kindMarker(kind: string): string {
  return kind === "skills" ? "SKILL.md" : "AGENT.md";
}

/** Leading `---` block lines; [] when unreadable or line 1 is not exactly `---`. */
function frontmatterLines(file: string): string[] {
  let text: unknown;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = typeof text === "string" ? text.split("\n") : [];
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  return lines.slice(1, end < 0 ? undefined : end);
}

/** The declared `name:` of the leading frontmatter ("" when absent). */
export function frontmatterName(file: string): string {
  for (const line of frontmatterLines(file)) {
    if (!/^name:[ \t]*/.test(line)) continue;
    return line
      .replace(/^name:[ \t]*/, "")
      .replace(/^["']/, "")
      .replace(/["']$/, "");
  }
  return "";
}

/** True iff the leading frontmatter has an indented `provenance:` then a `canonical:` value. */
export function hasProvenance(file: string): boolean {
  let seenProv = false;
  for (const line of frontmatterLines(file)) {
    if (/^\s+provenance:\s*$/.test(line)) {
      seenProv = true;
      continue;
    }
    if (seenProv && /^\s+canonical:\s*\S/.test(line)) return true;
  }
  return false;
}

/** Sorted (byte order, like a C-locale glob) non-dot children of `dir`; [] when unreadable. */
function children(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => !n.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

function stat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
const isDir = (p: string): boolean => stat(p)?.isDirectory() === true;
const isFile = (p: string): boolean => stat(p)?.isFile() === true;

/** Source component marker files of a kind, across all three non-core tiers. */
function sourceMarkers(artifactsRoot: string, kind: string): string[] {
  const out: string[] = [];
  for (const tier of TIERS) {
    const base = `${artifactsRoot}/${tier}/${kind}`;
    for (const name of children(base)) {
      const marker = `${base}/${name}/${kindMarker(kind)}`;
      if (isDir(`${base}/${name}`) && isFile(marker)) out.push(marker);
    }
  }
  return out;
}

/** Every component name the framework serves for `kind`, read from the sources. */
export function frameworkNames(artifactsRoot: string, kind: string): string[] {
  return sourceMarkers(artifactsRoot, kind)
    .map(frontmatterName)
    .filter((n) => n !== "");
}

/** Bounded removal: contents first, then the directory only if empty (never follows a symlink). */
function removeEntry(entry: string, asDir: boolean): void {
  try {
    if (!asDir) {
      fs.rmSync(entry, { force: true });
      return;
    }
    if (fs.lstatSync(entry).isSymbolicLink()) return;
    for (const name of fs.readdirSync(entry)) {
      try {
        fs.rmSync(`${entry}/${name}`, { recursive: true, force: true });
      } catch {
        // resistant child: the directory stays and surfaces as residue
      }
    }
    fs.rmdirSync(entry);
  } catch {
    // reported below through the existence check
  }
}

/**
 * Remove framework components from `supersededRoot` (spec R8), keep the rest (R9).
 * With explicit `names` the sweep is narrowed to them; with none, every served
 * name of each kind is used. `kind` is "skills", "agents", or anything else for both.
 */
export function migrateAntigravitySupersededComponents(
  supersededRoot: string,
  artifactsRoot: string,
  kind: string,
  names: readonly string[],
  io: MigrateIo,
): MigrateResult {
  const kinds =
    kind === "skills" ? ["skills"] : kind === "agents" ? ["agents"] : ["skills", "agents"];
  const residue: string[] = [];
  let removed = 0;

  for (const k of kinds) {
    let served: string[];
    if (names.length > 0) {
      // The shell word-splits its unquoted name list: split on whitespace.
      served = names.flatMap((n) => n.split(/\s+/)).filter((n) => n !== "");
    } else {
      served = frameworkNames(artifactsRoot, k);
      const dirCount = sourceMarkers(artifactsRoot, k).length;
      // An empty name set read from present sources is an ERROR, not "nothing to do".
      if (dirCount > 0 && served.length === 0) {
        io.err(`  ERROR: read no ${k} name from ${dirCount} source director(ies) under`);
        io.err(`         ${artifactsRoot} — refusing to run a migration that would`);
        io.err("         remove nothing and report success.");
        return { status: 1, removed };
      }
    }

    const dest = `${supersededRoot}/${k}`;
    if (!isDir(dest)) continue;
    const marker = kindMarker(k);

    for (const item of children(dest)) {
      const entry = `${dest}/${item}`;
      let markerFile: string;
      let stripped = item;
      if (isDir(entry)) {
        markerFile = `${entry}/${marker}`;
      } else if (isFile(entry) && item.endsWith(".md")) {
        markerFile = entry;
        stripped = item.slice(0, -3);
      } else {
        continue;
      }
      if (!isFile(markerFile)) continue;

      const declared = frontmatterName(markerFile) || stripped;
      const inSet = served.includes(declared);
      const hasProv = hasProvenance(markerFile);

      if (inSet && hasProv) {
        removeEntry(entry, isDir(entry));
        if (fs.existsSync(entry)) {
          residue.push(`${entry} (removal incomplete)`);
        } else {
          removed += 1;
          io.out(`  Migrated away: ${entry} (superseded placement)`);
        }
      } else if (hasProv) {
        residue.push(entry);
      }
    }
  }

  if (residue.length > 0) {
    io.err("  The following carry framework provenance but match no served component");
    io.err("  name. They were NOT removed — check them, then remove by hand:");
    for (const item of residue) {
      const cut = item.indexOf(" (");
      io.err(`    rm -rf ${cut < 0 ? item : item.slice(0, cut)}`);
    }
  }
  if (removed > 0) {
    io.out(
      `  Removed ${removed} framework component(s) from the superseded placement at ${supersededRoot}.`,
    );
  }
  return { status: 0, removed };
}
