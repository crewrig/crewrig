// component-resolve.ts — TypeScript twin of one slice of scripts/lib/component-resolve.sh:
// the build's installed-name collision pre-pass (spec 0119 R13; spec 0250 R17).
//
// Twin of that slice of the shell library: change both, and keep them equal. The
// conformance test `scripts/tests/build-components-conformance.test.ts` compares
// the two.
//
// No precedent (spec 0250 R2): this slice moved only because the step (b) build
// depends on it. It is not a precedent for the other consumers of the shell
// library, the four `scripts/manage-*-component.sh` scripts of step (c), row F2.
// Row F2 extends this module; nothing else of `component-resolve.sh` lives here
// (`resolve_component_in_roots`, `enumerate_components_in_roots`,
// `report_unresolved`, `component_set_*`, `component_read_lines`,
// `ensure_overlay_tiers_fresh` and the install drivers stay Bash until F2).
//
// Twinned functions: `_component_declared_name` (`componentDeclaredName`),
// `_component_emit_target` (`componentEmitTarget`), `_component_target_display_name`
// (`componentTargetDisplayName`), `report_collision` (`reportCollision`),
// `installed_targets` (`installedTargets`) and `report_installed_name_collisions`
// (`reportInstalledNameCollisions`). Differences of form, none of behaviour:
//   - records are typed objects; `targetRecordLine` prints one as the shell did;
//   - a report goes to a `TextSink` (default: standard error), written once;
//   - directory listings are in code-unit order and skip names beginning with `.`,
//     as a shell glob does under the C locale;
//   - a component's name is read from the raw bytes of the file, with the shell's
//     line rule (no CRLF or BOM normalisation, unlike the YAML reader).

import fs from "node:fs";
import path from "node:path";

/** Where a report is written; the build hands in its standard error. */
export type TextSink = (text: string) => void;

export type TierClass = "core" | "overlay";

export type ComponentKind =
  | "skills"
  | "commands"
  | "agents"
  | "policies"
  | "hooks"
  | "themes"
  | "mcp-servers";

/** One `<tier-class><TAB><install-target><TAB><tier><TAB><kind>` record. */
export interface TargetRecord {
  readonly tierClass: TierClass;
  readonly installTarget: string;
  readonly tier: string;
  readonly kind: ComponentKind;
}

const stderrSink: TextSink = (text) => {
  process.stderr.write(text);
};

const FRONTMATTER_FENCE = /^---[ \t]*$/;
const NAME_PREFIX = /^name:[ \t]*/;

function statOf(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

const isDir = (target: string): boolean => statOf(target)?.isDirectory() === true;
const isFile = (target: string): boolean => statOf(target)?.isFile() === true;
const exists = (target: string): boolean => statOf(target) !== null;

/** The entries of `dir` a glob `*` (or `*<suffix>`) matches, in code-unit order. */
function glob(dir: string, suffix = ""): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith(".") && name.endsWith(suffix))
      .sort();
  } catch {
    return [];
  }
}

/** The first `name:` line of the leading frontmatter, past `name:` and its blanks. */
function firstNameLine(file: string): string {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines[0] === undefined || !FRONTMATTER_FENCE.test(lines[0])) return "";
  for (const line of lines.slice(1)) {
    if (FRONTMATTER_FENCE.test(line)) return "";
    if (NAME_PREFIX.test(line)) return line.replace(NAME_PREFIX, "");
  }
  return "";
}

/**
 * `_component_declared_name`: the `name:` of `file`'s leading frontmatter, or
 * `fallback` when it declares none. Line-based, never YAML: the build keys its
 * output paths on it, so the guard must key on the same text. In the shell's
 * order: one trailing then one leading double quote, one trailing then one
 * leading single quote, every carriage return, trailing whitespace. `name: probe
 * # note` is therefore `probe # note`, and `"foo"` followed by a blank keeps its
 * quote, as the shell does.
 */
export function componentDeclaredName(file: string, fallback: string): string {
  let value = isFile(file) ? firstNameLine(file) : "";
  if (value.endsWith('"')) value = value.slice(0, -1);
  if (value.startsWith('"')) value = value.slice(1);
  if (value.endsWith("'")) value = value.slice(0, -1);
  if (value.startsWith("'")) value = value.slice(1);
  value = value.replace(/\r/g, "").replace(/[ \t\n\v\f\r]+$/, "");
  return value === "" ? fallback : value;
}

/** `_component_emit_target`: one installed-target record. */
export function componentEmitTarget(
  tierClass: TierClass,
  installTarget: string,
  tier: string,
  kind: ComponentKind,
): TargetRecord {
  return { tierClass, installTarget, tier, kind };
}

/** A record as `installed_targets` printed it: four tab-separated fields and a line feed. */
export function targetRecordLine(record: TargetRecord): string {
  return `${record.tierClass}\t${record.installTarget}\t${record.tier}\t${record.kind}\n`;
}

/**
 * `_component_target_display_name`: the installed name a target key carries.
 * `basename` is POSIX: for `claude:mcpServers.x` there is no slash, so the
 * `mcpServers.` prefix is only removed when the whole target begins with it, as
 * the shell's `case` does. Suffixes `.md`, `.toml`, `.json` come off in that order.
 */
export function componentTargetDisplayName(installTarget: string): string {
  let base = path.posix.basename(installTarget);
  for (const prefix of ["mcpServers.", "settings.themes."]) {
    if (base.startsWith(prefix)) {
      base = base.slice(prefix.length);
      break;
    }
  }
  for (const suffix of [".md", ".toml", ".json"]) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  }
  return base;
}

/**
 * `report_collision`: the refusal formatter, on standard error. The sources are an
 * unordered set (spec 0119 R15): nothing here picks one.
 */
export function reportCollision(
  name: string,
  sources: readonly string[],
  sink: TextSink = stderrSink,
): void {
  let text = `Refusing '${name}': one installed name is claimed by more than one component.\n`;
  text += "Every source presenting it, in no significant order:\n";
  for (const source of sources) text += `  - ${source}\n`;
  sink(text);
}

const SKILL_ROOTS = [".claude/skills/", ".gemini/skills/", ".github/skills/", ".agents/skills/"];
const MCP_PREFIXES = ["claude:", "gemini:", "copilot:", "antigravity:"];

/**
 * `installed_targets`: one record per target every component of every tier would
 * be installed to. Tiers in code-unit order and, within a tier, skills, commands,
 * agents, policies, hooks, themes, mcp-servers. The key is `(tierClass,
 * installTarget)`, never the name: `architect` is both a skill and an agent.
 */
export function installedTargets(artifactsDir: string): TargetRecord[] {
  const records: TargetRecord[] = [];
  for (const tier of glob(artifactsDir)) {
    const tierPath = path.join(artifactsDir, tier);
    if (!isDir(tierPath)) continue;
    const tierClass: TierClass = tier === "core" ? "core" : "overlay";
    const emit = (target: string, kind: ComponentKind): void => {
      records.push(componentEmitTarget(tierClass, target, tier, kind));
    };

    for (const entry of glob(path.join(tierPath, "skills"))) {
      const dir = path.join(tierPath, "skills", entry);
      if (!isDir(dir) || !isFile(path.join(dir, "SKILL.md"))) continue;
      const name = componentDeclaredName(path.join(dir, "SKILL.md"), entry);
      for (const root of SKILL_ROOTS) emit(`${root}${name}`, "skills");
    }

    // Three CLIs compile a command into the skills namespace.
    for (const entry of glob(path.join(tierPath, "commands"), ".md")) {
      const file = path.join(tierPath, "commands", entry);
      if (!isFile(file)) continue;
      const name = componentDeclaredName(file, entry.slice(0, -".md".length));
      emit(`.claude/skills/${name}`, "commands");
      emit(`.gemini/commands/${name}.toml`, "commands");
      emit(`.github/skills/${name}`, "commands");
      emit(`.agents/skills/${name}`, "commands");
    }

    for (const entry of glob(path.join(tierPath, "agents"))) {
      const dir = path.join(tierPath, "agents", entry);
      if (!isDir(dir) || !isFile(path.join(dir, "AGENT.md"))) continue;
      const name = componentDeclaredName(path.join(dir, "AGENT.md"), entry);
      emit(`.claude/agents/${name}.md`, "agents");
      emit(`.gemini/agents/${name}.md`, "agents");
      emit(`.github/agents/${name}.md`, "agents");
      emit(`.agents/agents/${name}`, "agents");
    }

    for (const base of glob(path.join(tierPath, "policies"))) {
      if (!exists(path.join(tierPath, "policies", base)) || base === ".gitkeep") continue;
      emit(`claude:rules/${base}`, "policies");
      emit(`gemini:policies/${base}`, "policies");
      emit(`antigravity:rules/${base}`, "policies");
    }

    for (const base of glob(path.join(tierPath, "hooks"))) {
      if (!exists(path.join(tierPath, "hooks", base)) || base === ".gitkeep") continue;
      emit(`gemini:hooks/${base}`, "hooks");
    }

    for (const entry of glob(path.join(tierPath, "themes"), ".json")) {
      if (!isFile(path.join(tierPath, "themes", entry))) continue;
      emit(`gemini:settings.themes.${entry.slice(0, -".json".length)}`, "themes");
    }

    for (const entry of glob(path.join(tierPath, "mcp-servers"), ".json")) {
      if (!isFile(path.join(tierPath, "mcp-servers", entry))) continue;
      const base = entry.slice(0, -".json".length);
      for (const prefix of MCP_PREFIXES) emit(`${prefix}mcpServers.${base}`, "mcp-servers");
    }
  }
  return records;
}

/**
 * `report_installed_name_collisions`, the build's R13 pre-pass. Returns 0 when no
 * two components claim one installed target, 1 otherwise, having reported each
 * offending target through `reportCollision` in code-unit order of
 * `<tier-class><TAB><install-target>` (the shell's `sort | uniq -d` under the C locale).
 */
export function reportInstalledNameCollisions(
  artifactsDir: string,
  sink: TextSink = stderrSink,
): 0 | 1 {
  const records = installedTargets(artifactsDir);
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.tierClass}\t${record.installTarget}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  for (const key of duplicates) {
    const [tierClass, installTarget] = key.split("\t");
    const sources = records
      .filter((r) => r.tierClass === tierClass && r.installTarget === installTarget)
      .map(
        (r) => `tier '${r.tier}' declares a ${r.kind} component installing to ${r.installTarget}`,
      );
    reportCollision(componentTargetDisplayName(installTarget ?? ""), sources, sink);
  }
  return duplicates.length === 0 ? 0 : 1;
}
