// org-components.ts — `is_org_component_output` of the sync (spec 0204, spec 0253 R19): is a
// tracked compiled output the product of an organization-tier component under artifacts/org/?

import { readdirSync, readFileSync, statSync } from "node:fs";
import type { Ctx } from "./types.ts";

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** A shell glob `*` segment: the non-hidden entries of `dir`, sorted; none when it is absent. */
function globEntries(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** The component name a compiled output stands for; empty when the path is not one. */
function componentOf(tracked: string): string {
  const skillRoots = [".claude/skills/", ".gemini/skills/", ".github/skills/", ".agents/skills/"];
  if (skillRoots.some((root) => tracked.startsWith(root))) {
    const rest = tracked.slice(tracked.indexOf("/skills/") + "/skills/".length);
    const slash = rest.indexOf("/");
    return slash === -1 ? rest : rest.slice(0, slash);
  }
  const commands = ".gemini/commands/";
  if (
    tracked.startsWith(commands) &&
    tracked.endsWith(".toml") &&
    tracked.length >= commands.length + 5
  ) {
    return tracked.slice(commands.length, -".toml".length);
  }
  return "";
}

/** True when `tracked` is a compiled output of an active organization-tier component. */
export function isOrgComponentOutput(ctx: Ctx, tracked: string): boolean {
  const comp = componentOf(tracked);
  if (comp === "") return false;
  const orgRoot = `${ctx.repoDir}/artifacts/org`;
  if (!isDir(orgRoot)) return false;
  if (isDir(`${orgRoot}/skills/${comp}`) || isFile(`${orgRoot}/commands/${comp}.md`)) return true;

  // The declared `name:` of the frontmatter may differ from the directory or file name.
  const declared = new RegExp(
    `^name:[ \\t\\n\\v\\f\\r]*["']?${escapeRegExp(comp)}["']?[ \\t\\n\\v\\f\\r]*$`,
  );
  const sources = [
    ...globEntries(`${orgRoot}/skills`).map((name) => `${orgRoot}/skills/${name}/SKILL.md`),
    ...globEntries(`${orgRoot}/commands`)
      .filter((name) => name.endsWith(".md"))
      .map((name) => `${orgRoot}/commands/${name}`),
  ];
  for (const src of sources) {
    if (!isFile(src)) continue;
    let text: string;
    try {
      text = readFileSync(src, "utf8");
    } catch {
      continue;
    }
    if (text.split("\n").some((line) => declared.test(line))) return true;
  }
  return false;
}
