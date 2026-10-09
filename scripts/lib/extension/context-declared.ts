// context-declared.ts — the declared command and skill names of an extension (spec 0254 R16).
// Twins `_render_context_declared_commands` / `_render_context_declared_skills`
// (scripts/lib/render-context.sh:161-184): pass (d)'s only source of truth. Both read the
// subject's `location` (default `commands/` / `skills/`, trailing slash stripped), list in
// code-unit order of the entry name and return nothing when the subject or directory is absent.

import fs from "node:fs";

import type { RenderCommand } from "../render-command.ts";
import { subjectLocation, subjectPresent } from "./manifest.ts";
import type { Manifest } from "./manifest.ts";

function locationDir(
  manifest: Manifest,
  extDir: string,
  subject: string,
  dflt: string,
): string | null {
  if (!subjectPresent(manifest, subject)) return null;
  const location = subjectLocation(manifest, subject, dflt);
  const dir = `${extDir}/${location.endsWith("/") ? location.slice(0, -1) : location}`;
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

function statOrNull(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** The `name` of every `<location>/*.md` file that has one (empty and `null` skipped). */
export function declaredCommands(
  manifest: Manifest,
  extDir: string,
  renderCommand: RenderCommand,
): string[] {
  const dir = locationDir(manifest, extDir, "commands", "commands/");
  if (dir === null) return [];
  const names: string[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith(".") && f.endsWith(".md"))
    .sort();
  for (const file of files) {
    if (statOrNull(`${dir}/${file}`)?.isFile() !== true) continue;
    const name = renderCommand.yamlField(`${dir}/${file}`, "name");
    if (name !== "" && name !== "null") names.push(name);
  }
  return names;
}

/** The directory names under `<location>/` (dotfiles excluded, as the shell's glob does). */
export function declaredSkills(manifest: Manifest, extDir: string): string[] {
  const dir = locationDir(manifest, extDir, "skills", "skills/");
  if (dir === null) return [];
  const isDir = (entry: string): boolean => statOrNull(`${dir}/${entry}`)?.isDirectory() === true;
  return fs
    .readdirSync(dir)
    .filter((entry) => entry[0] !== "." && isDir(entry))
    .sort();
}
