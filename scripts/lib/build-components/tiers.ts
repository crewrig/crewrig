// tiers.ts — tier discovery, output routing and the helpers every emitter shares
// (ADR-0011, spec 0019; spec 0250 R9, R13).
//
// Twins scripts/build-components.sh `discover_tiers` (:473-487) and
// `output_root_for_tier` (:518-527), the `[ -z "$name" ]` skip shared by
// `build_skills` (:551), `build_commands` (:748) and `build_agents` (:845), and the
// glob forms the three builders iterate (`"$skills_dir"/*/`, `"$commands_dir"/*.md`,
// `"$agents_dir"/*/`). The tier loop itself is in `main.ts`; this module holds no
// emitter, so the emitters can import it without a cycle.
//
// Globs. A shell glob skips names beginning with `.` and, here, is read in code-unit
// order (spec 0250 R9; the shell's order was the locale's). A directory is anything
// `stat` calls one, a symbolic link to a directory included. An unreadable directory
// matches nothing, as a glob that expands to itself and fails `[ -d ]` did.
//
// The directory form keeps the glob's trailing slash (`<skills>/<entry>/`), so a
// source path is `<skills>/<entry>//SKILL.md` exactly as the shell built it, and the
// `Warning: <source> missing 'name' field` line shows that double slash. The command
// form (`<commands>/<file>.md`) has none.

import fs from "node:fs";
import path from "node:path";

import { joinRoot } from "./args.ts";
import { escapeControl, isControlCode } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { BaseCtx, CliId, SourceDoc } from "./types.ts";

/** `[ "$TARGET" = "<cli>" ] || [ "$TARGET" = "all" ]`: the whole `--target` text is compared. */
export function selects(ctx: Pick<BaseCtx, "opts">, cli: CliId): boolean {
  return ctx.opts.target === cli || ctx.opts.target === "all";
}

/** The shell's `[ -d ]`. */
export function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** The names a `*` glob matches in `dir` for which `keep` holds, in code-unit order. */
function glob(dir: string, keep: (full: string, name: string) => boolean): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith(".") && keep(path.join(dir, name), name))
      .sort();
  } catch {
    return [];
  }
}

/** The directory glob (a `*` then a slash): the entries of `dir` that are directories, each as `<dir>/<name>/`. */
export function globDirs(ctx: Pick<BaseCtx, "platform">, dir: string): string[] {
  return glob(dir, (full) => isDirectory(full)).map((name) =>
    joinRoot(ctx.platform, dir, `${name}/`),
  );
}

/** `"<dir>"/*.md` narrowed by `[ -f ]`: the regular files, each as `<dir>/<name>`. */
export function globMarkdown(ctx: Pick<BaseCtx, "platform">, dir: string): string[] {
  const regular = (full: string): boolean => {
    try {
      return fs.statSync(full).isFile();
    } catch {
      return false;
    }
  };
  return glob(dir, (full, name) => name.endsWith(".md") && regular(full)).map((name) =>
    joinRoot(ctx.platform, dir, name),
  );
}

/**
 * `discover_tiers`: the subdirectories of `artifacts/`, narrowed by `--tier` (an unknown
 * name matches nothing, an empty list matches nothing). An absent `artifacts/` has none.
 */
export function discoverTiers(ctx: Pick<BaseCtx, "artifactsDir" | "opts">): string[] {
  const wanted = ctx.opts.tierFilter;
  return glob(ctx.artifactsDir, (full) => isDirectory(full)).filter(
    (tier) => wanted === null || wanted.includes(tier),
  );
}

/**
 * `output_root_for_tier`: `core` writes into the project tree, every other tier into
 * `dist/<tier>`, or, in `--check` (where only `core` is committed), into the throwaway
 * staging root so the tier is compiled and discarded.
 */
export function outputRootForTier(
  ctx: Pick<BaseCtx, "opts" | "platform" | "repoDir" | "state">,
  tier: string,
): string {
  if (tier === "core") return ctx.repoDir;
  if (ctx.opts.check) return joinRoot(ctx.platform, ctx.state.stagingRoot, tier);
  return joinRoot(ctx.platform, ctx.repoDir, `dist/${tier}`);
}

/** Whether `name` holds a control character or a `..` path segment (split on `/` and `\`). */
function unsafeName(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    if (isControlCode(name.charCodeAt(i))) return true;
  }
  return name.split(/[/\\]/).includes("..");
}

/**
 * The component's name, or `null` after the shell's warning when it has none. A name
 * is missing when it is absent, empty, `null`, or any other spelling of a YAML null
 * (`~`, `Null`, `NULL`): the shell skipped only the empty one and built `null` for the
 * rest (spec 0250 R33(f), which lists "absent or null"). A quoted `"~"` is a string
 * and a name; `false` is a name too, as it was.
 *
 * A name that would leave its output folder (a `..` segment) or act on a terminal or a CI
 * log (a control character) is refused before anything is written for the component
 * (spec 0250 R33 hardening); no other shape is enforced.
 *
 * @throws BuildFailure (status 1) for such a name.
 */
export function componentName(ctx: Pick<BaseCtx, "io">, source: SourceDoc): string | null {
  const name = source.field("name");
  const entry = source.entries([]).find((candidate) => candidate.key === "name");
  const writtenNull = entry !== undefined && entry.kind === "scalar" && entry.text === "";
  if (name === "" || name === "null" || writtenNull) {
    ctx.io.out(`Warning: ${escapeControl(source.file)} missing 'name' field, skipping`);
    return null;
  }
  if (unsafeName(name)) {
    throw new BuildFailure(
      `Error: ${escapeControl(source.file)}: the component name '${escapeControl(name)}' ` +
        "is not allowed (control character or '..' path segment).",
    );
  }
  return name;
}

/** The shell's `[ -n "$v" ] && [ "$v" != "null" ]`. */
export function present(text: string): boolean {
  return text !== "" && text !== "null";
}

/** `license:` and `compatibility:` lines, each present only when its text is neither empty nor `null`. */
export function licenseLines(source: SourceDoc): string[] {
  const license = source.field("license");
  const compatibility = source.field("compatibility");
  const lines: string[] = [];
  if (present(license)) lines.push(`license: ${license}`);
  if (present(compatibility)) lines.push(`compatibility: "${compatibility}"`);
  return lines;
}

/** `allowed-tools:` and one `  - <tool>` line per element, or nothing when there is none. */
export function allowedToolsLines(source: SourceDoc): string[] {
  const tools = source.lines(["claude", "allowed-tools"]);
  return tools.length === 0 ? [] : ["allowed-tools:", ...tools.map((tool) => `  - ${tool}`)];
}

/** The `<<EOF` heredoc of the shell: `---`, the frontmatter, `---`, an empty line, the body. */
export function markdownFile(frontmatter: readonly string[], body: string): string {
  return `---\n${frontmatter.join("\n")}\n---\n\n${body}`;
}
