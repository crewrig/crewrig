// check-skill-mirrors.ts — verify the built skill (and optional agent) mirrors of one component
// across .claude/, .gemini/ and .github/ (the `task skill:check` guard; TypeScript replacement of
// the former yq/awk Taskfile script, spec 0266 R13).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-skill-mirrors.ts <skill-name>
// Override the repository root with CREWRIG_REPO_DIR (default: the parent of scripts/).
//
// Exit: 0 every mirror is present and carries `name` and `metadata.provenance.version`
// (`<name>: OK across .claude/, .gemini/, .github/` on stdout), 1 the first failure (`FAIL:` and
// `Remediation:` lines on stderr), 2 the name argument is missing.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const REBUILD =
  "rebuild with `node scripts/lib/node-floor-guard.js` then `node scripts/build-components.ts`.";

class Failure extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

/** The YAML frontmatter block of a Markdown file, or undefined when it has none. */
function frontmatter(text: string): string | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return match?.[1];
}

function isNonEmptyFile(file: string): boolean {
  try {
    return statSync(file).size > 0;
  } catch {
    return false;
  }
}

function parsedFrontmatter(repoDir: string, rel: string): Record<string, unknown> {
  const file = path.join(repoDir, rel);
  if (!isNonEmptyFile(file)) {
    throw new Failure(`${rel} — missing or empty`, REBUILD);
  }
  const block = frontmatter(readFileSync(file, "utf8"));
  let doc: unknown;
  try {
    doc = block === undefined ? undefined : load(block);
  } catch {
    doc = undefined;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Failure(`${rel} — YAML frontmatter does not parse`, REBUILD);
  }
  return doc as Record<string, unknown>;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function requireField(rel: string, value: unknown, label: string): void {
  if (!present(value)) {
    throw new Failure(`${rel} — missing or empty YAML field ${label}`, REBUILD);
  }
}

function provenanceVersion(doc: Record<string, unknown>): unknown {
  const metadata = doc["metadata"];
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const provenance = (metadata as Record<string, unknown>)["provenance"];
  if (typeof provenance !== "object" || provenance === null) {
    return undefined;
  }
  return (provenance as Record<string, unknown>)["version"];
}

function checkYamlMirror(repoDir: string, rel: string): void {
  const doc = parsedFrontmatter(repoDir, rel);
  requireField(rel, doc["name"], "name");
  requireField(rel, provenanceVersion(doc), "metadata.provenance.version");
}

export function checkMirrors(repoDir: string, name: string): void {
  for (const dir of [".claude", ".gemini", ".github"]) {
    checkYamlMirror(repoDir, `${dir}/skills/${name}/SKILL.md`);
  }
  const claude = `.claude/agents/${name}.md`;
  const gemini = `.gemini/agents/${name}.md`;
  const copilot = `.github/agents/${name}.md`;
  const all = [claude, gemini, copilot];
  const found = all.filter((rel) => existsSync(path.join(repoDir, rel)));
  if (found.length !== 0 && found.length !== 3) {
    const missing = all.filter((rel) => !found.includes(rel)).join(" ");
    throw new Failure(
      `agent mirrors are asymmetric — present on ${found.length}/3 paths; missing: ${missing}`,
      REBUILD,
    );
  }
  if (found.length === 3) {
    for (const rel of [claude, copilot]) {
      checkYamlMirror(repoDir, rel);
    }
    const doc = parsedFrontmatter(repoDir, gemini);
    requireField(gemini, doc["name"], "name");
    const body = readFileSync(path.join(repoDir, gemini), "utf8")
      .replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")
      .split(/\r?\n/)
      .find((line) => line.trim() !== "");
    if (
      body === undefined ||
      !/^<!-- crewrig-provenance: (?:[a-z]+="[^"]*" )*version="[^"]+"/.test(body)
    ) {
      throw new Failure(
        `${gemini} — missing HTML-comment provenance line (\`<!-- crewrig-provenance: version="…" … -->\`) immediately after YAML frontmatter`,
        REBUILD,
      );
    }
  }
}

const name = process.argv[2] ?? "";
if (name === "") {
  process.stderr.write("ERROR: NAME is required. Usage: task skill:check NAME=<skill-name>\n");
  process.exitCode = 2;
} else {
  const envDir = process.env["CREWRIG_REPO_DIR"];
  const repoDir =
    envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");
  try {
    checkMirrors(repoDir, name);
    process.stdout.write(`${name}: OK across .claude/, .gemini/, .github/\n`);
  } catch (error) {
    if (!(error instanceof Failure)) {
      throw error;
    }
    process.stderr.write(`FAIL: ${error.message}\n`);
    if (error.hint !== undefined) {
      process.stderr.write(`Remediation: ${error.hint}\n`);
    }
    process.exitCode = 1;
  }
}
