// metadata-keys.ts — closed-key check logic for the `metadata:` block of an
// upstream-owned component source (spec 0259; replaces the logic of
// scripts/check-component-metadata-keys.ts, spec 0200 R8-R12).
//
// Usage: checkMetadataKeys({ args, repoDir, yamlNamespace }) -> { code, stdout, stderr }
// Reused: scripts/lib/build-components/frontmatter.ts (createFrontmatter), scripts/lib/
// yaml-text.ts (the readers it binds), scripts/lib/render-command.ts (frontmatterOfText,
// the awk twin). The file is read RAW (no CRLF or BOM normalisation): awk matched `---`
// byte for byte, so a CRLF or BOM-prefixed source has no front matter at all.
// Exit codes: 0 clean, 1 rejections (or the shell's silent `set -e` abort, see below),
// 2 a named argument that is not a regular file, or no artifacts/ or no sources.
// Finding-line format: `<file>: K1 metadata.<key> is not admitted ...` on stderr,
// then a blank line and the `FAILED:` line; the `OK:` line is on stdout.
// Shell behaviours reproduced: `yq keys` lists keys in DOCUMENT order (not sorted),
// a sequence-valued `metadata:` yields its indices as keys, and a `metadata:` whose
// value is null or a scalar aborts the script (exit 1, nothing more printed) because
// `keys=$(yq ...)` fails under `set -e`. An empty key is skipped. Deviation (d): an
// unreadable governed source prints one `Error: <path>: <reason>` line on stderr, exit 1.
// Deviation (e): a front matter js-yaml refuses for a duplicated mapping key (yq accepted it)
// is a rejection, never a clean pass: one `Error: <path>: duplicated mapping key in front
// matter` line on stderr, counted in the FAILED block, exit 1.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createFrontmatter } from "../build-components/frontmatter.ts";
import { frontmatterOfText } from "../render-command.ts";
import { toYamlLib } from "../yaml-text.ts";

const ADMITTED = new Set(["provenance", "model"]);
/** Spec 0291 R9: `tools` is admitted on an agent source only (the allowlist of an agent). */
const AGENT_ONLY = new Set(["tools"]);
/** Spec 0291 R17: an allowlist is declared only for an agent whose classes exclude these. */
const BANNED_CLASSES = ["execute", "edit"];
const GOVERNED_PREFIXES = ["artifacts/core/", "artifacts/library/"];

export interface MetadataKeysInput {
  readonly args: readonly string[];
  readonly repoDir: string;
  readonly yamlNamespace: unknown;
}

export interface Outcome {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** The POSIX-style reason of a filesystem error, for the `Error: <path>: <reason>` line. */
export function fsReason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "EISDIR") return "Is a directory";
  return err instanceof Error ? err.message : String(err);
}

/** Whether js-yaml refuses `text` because a mapping key is duplicated (deviation (e)). */
export function hasDuplicateKey(yamlNamespace: unknown, text: string): boolean {
  try {
    toYamlLib(yamlNamespace).load(text);
    return false;
  } catch (err) {
    return err instanceof Error && err.message.includes("duplicated mapping key");
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => !n.startsWith("."))
      .sort(byCodeUnit);
  } catch {
    return [];
  }
}

/** The default sources, in the shell's glob order: per tier skills, commands, agents. */
function defaultSources(artifactsDir: string): string[] {
  const found: string[] = [];
  for (const tier of ["core", "library"]) {
    const base = `${artifactsDir}/${tier}`;
    for (const d of listDir(`${base}/skills`)) found.push(`${base}/skills/${d}/SKILL.md`);
    for (const f of listDir(`${base}/commands`)) {
      if (f.endsWith(".md")) found.push(`${base}/commands/${f}`);
    }
    for (const d of listDir(`${base}/agents`)) found.push(`${base}/agents/${d}/AGENT.md`);
  }
  return found.filter(isFile);
}

export function isGoverned(file: string): boolean {
  return GOVERNED_PREFIXES.some((p) => file.startsWith(p) || file.includes(`/${p}`));
}

/** An agent source: `AGENT.md` (a skill or a command source is not). */
const isAgentSource = (file: string): boolean => file.split("/").pop() === "AGENT.md";

/** The classes of `metadata.tools` that R17 bans, in the order they are written. */
function bannedClasses(fm: ReturnType<typeof createFrontmatter>, text: string): string[] {
  const doc = fm.yaml.parse(text);
  if (doc === null) return [];
  const declared = fm.yaml.seq(doc, ["metadata", "tools"]);
  return BANNED_CLASSES.filter((cls) => declared.includes(cls));
}

/** `null` aborts the script silently; otherwise the keys `yq keys | .[]` printed. */
function metadataKeys(
  fm: ReturnType<typeof createFrontmatter>,
  text: string,
): string[] | null | "absent" {
  const doc = fm.yaml.parse(text);
  if (doc === null || !fm.yaml.has(doc, ["metadata"])) return "absent";
  const core = doc.core as Record<string, unknown>;
  const meta = core["metadata"];
  if (Array.isArray(meta)) return meta.map((_, i) => String(i));
  if (typeof meta !== "object" || meta === null) return null;
  return fm.yaml.entries(doc, ["metadata"]).map((e) => e.key);
}

export function checkMetadataKeys(input: MetadataKeysInput): Outcome {
  const fm = createFrontmatter(input.yamlNamespace);
  let files: string[] = [];
  if (input.args.length > 0) {
    for (const a of input.args) {
      if (!isFile(a)) {
        return { code: 2, stdout: "", stderr: `Error: named argument does not exist: ${a}\n` };
      }
      files.push(a);
    }
  } else {
    const artifactsDir = `${input.repoDir}/artifacts`;
    if (!isDir(artifactsDir)) {
      return { code: 2, stdout: "", stderr: `Error: artifacts/ not found: ${artifactsDir}\n` };
    }
    files = defaultSources(artifactsDir);
    if (files.length === 0) {
      return {
        code: 2,
        stdout: "",
        stderr: `Error: no component sources found under ${artifactsDir}/{core,library}\n`,
      };
    }
  }

  let stderr = "";
  let rejections = 0;
  for (const file of files) {
    if (!isGoverned(file)) continue;
    let text: string;
    try {
      text = frontmatterOfText(readFileSync(file, "utf8"));
    } catch (err) {
      return { code: 1, stdout: "", stderr: `${stderr}Error: ${file}: ${fsReason(err)}\n` };
    }
    if (hasDuplicateKey(input.yamlNamespace, text)) {
      rejections += 1;
      stderr += `Error: ${file}: duplicated mapping key in front matter\n`;
      continue;
    }
    const keys = metadataKeys(fm, text);
    if (keys === null) return { code: 1, stdout: "", stderr };
    if (keys === "absent") continue;
    const agent = isAgentSource(file);
    for (const k of keys) {
      if (k === "") continue;
      if (agent && AGENT_ONLY.has(k)) {
        const banned = bannedClasses(fm, text);
        for (const cls of banned) {
          rejections += 1;
          stderr += `${file}: K2 metadata.tools declares the class ${cls}; an allowlist is declared only for an agent whose classes exclude execute and edit (spec 0291 R17)\n`;
        }
        continue;
      }
      if (ADMITTED.has(k)) continue;
      rejections += 1;
      stderr += `${file}: K1 metadata.${k} is not admitted — only metadata.provenance and metadata.model are, and metadata.tools on an AGENT.md, on artifacts/core/** and artifacts/library/** (spec 0200 R8, spec 0291 R9)\n`;
    }
  }
  if (rejections > 0) {
    stderr += `\nFAILED: ${rejections} rejection(s) across ${files.length} source(s) (spec 0200 R8).\n`;
    return { code: 1, stdout: "", stderr };
  }
  return {
    code: 0,
    stdout: `OK: ${files.length} source(s) checked; every governed metadata: block admits only provenance, model and, on an agent, tools.\n`,
    stderr: "",
  };
}
