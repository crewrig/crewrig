// changelog-plugin.ts — lint-safe facade over @semantic-release/changelog
// (issue #1364).
//
// Every extension release prepends its note to extensions/<tier>/<ext>/CHANGELOG.md
// and @semantic-release/git commits that file with `[skip ci]`, so nothing on
// the release path ever lints it: whatever the note template renders lands on
// `main` unchecked. semantic-release-gitmoji's default template renders a
// heading directly followed by its list (MD022/MD032), one H1 per release
// (MD025 from the second release on), a trailing space after every subject
// without issue references (MD009), a 4-space nested list for WIP commits
// (MD007), and one issue link per squashed commit that cites it, so the same
// `#NNNN` can repeat many times.
//
// This plugin changes only the CHANGELOG.md bytes. The release note itself —
// the forge release body and the release commit message — is left exactly as
// the note template renders it (spec 0213 R21 governs that note):
//
//   1. prepare() normalises the note before handing it to the real changelog
//      plugin: release headings are demoted one level under the file's single
//      `# Changelog` title, headings and lists get their blank lines, trailing
//      whitespace is dropped, nested lists use 2-space indentation, duplicate
//      issue links are collapsed, and a raw `<` outside inline code is escaped.
//   2. prepare() then lints the written file with the repository's own
//      .markdownlintrc and throws on any finding, so the release fails loudly
//      BEFORE @semantic-release/git commits the file — a future template change
//      can no longer break `lint-markdown` on `main` silently.
//
// scripts/lib/monorepo-release-lib.sh references this file by absolute path in
// place of the bare "@semantic-release/changelog" package name.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lint, readConfig } from "markdownlint/sync";

/** The single top-level heading every extension CHANGELOG.md starts with. */
export const CHANGELOG_TITLE = "# Changelog";

interface Logger {
  log(message: string, ...args: unknown[]): void;
}

interface PluginConfig {
  changelogFile?: string;
  changelogTitle?: string;
  [key: string]: unknown;
}

interface Context {
  cwd?: string;
  logger: Logger;
  nextRelease: { notes?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface ChangelogPlugin {
  verifyConditions(config: PluginConfig, context: Context): Promise<void>;
  prepare(config: PluginConfig, context: Context): Promise<void>;
}

const require = createRequire(import.meta.url);
const changelog = require("@semantic-release/changelog") as ChangelogPlugin;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Kind = "heading" | "list" | "text";

function kindOf(line: string): Kind {
  if (/^#{1,6} /.test(line)) return "heading";
  if (/^ *[-*+] /.test(line)) return "list";
  return "text";
}

/** Escape raw `<` outside inline code spans, so a subject never renders as HTML (MD033). */
function escapeHtml(line: string): string {
  return line
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replaceAll("<", "&lt;")))
    .join("");
}

/** Keep the first occurrence of each link in an `(Issues: ...)` group. */
function dedupeIssues(line: string): string {
  return line.replace(/\(Issues:((?: \[`[^`]+`\]\([^)\s]+\))+)\)/g, (_all, group: string) => {
    const links = group.match(/\[`[^`]+`\]\([^)\s]+\)/g) ?? [];
    return `(Issues: ${[...new Set(links)].join(" ")})`;
  });
}

/**
 * Normalise a rendered release note into a lint-safe CHANGELOG.md entry that
 * nests under {@link CHANGELOG_TITLE}. Pure: no I/O.
 */
export function normalizeChangelogNotes(notes: string): string {
  const out: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, "");
    if (line === "") {
      if (out.length > 0 && out.at(-1) !== "") out.push("");
      continue;
    }
    const heading = /^(#{1,5}) +(.*)$/.exec(line);
    if (heading) {
      line = `#${heading[1]} ${heading[2]}`;
    } else {
      const item = /^( +)([-*+] .*)$/.exec(line);
      if (item) line = `${" ".repeat(Math.ceil(item[1].length / 2))}${item[2]}`;
    }
    line = dedupeIssues(escapeHtml(line));
    const last = out.at(-1);
    if (last !== undefined && last !== "") {
      const kind = kindOf(line);
      const lastKind = kindOf(last);
      if (
        kind === "heading" ||
        lastKind === "heading" ||
        (kind === "list") !== (lastKind === "list")
      ) {
        out.push("");
      }
    }
    out.push(line);
  }
  while (out.at(-1) === "") out.pop();
  return out.join("\n");
}

/** Lint one file with the repository's own markdownlint configuration. */
export function lintChangelog(file: string): string[] {
  const config = readConfig(path.join(REPO_ROOT, ".markdownlintrc"));
  const results = lint({ files: [file], config });
  return (results[file] ?? []).map(
    (e) => `${file}:${e.lineNumber} ${e.ruleNames.join("/")} ${e.ruleDescription}`,
  );
}

function withTitle(config: PluginConfig): PluginConfig {
  return { ...config, changelogTitle: config.changelogTitle ?? CHANGELOG_TITLE };
}

export async function verifyConditions(config: PluginConfig, context: Context): Promise<void> {
  await changelog.verifyConditions(withTitle(config), context);
}

export async function prepare(config: PluginConfig, context: Context): Promise<void> {
  const notes = context.nextRelease.notes;
  const effective = withTitle(config);
  await changelog.prepare(effective, {
    ...context,
    nextRelease: { ...context.nextRelease, notes: notes ? normalizeChangelogNotes(notes) : notes },
  });
  if (!notes) return;
  const file = path.resolve(
    context.cwd ?? process.cwd(),
    effective.changelogFile ?? "CHANGELOG.md",
  );
  const findings = lintChangelog(file);
  if (findings.length > 0) {
    throw new Error(
      `changelog-plugin: ${path.basename(file)} would fail lint-markdown; refusing to commit it ` +
        `(fix normalizeChangelogNotes in scripts/lib/release-notes/changelog-plugin.ts):\n` +
        findings.join("\n"),
    );
  }
}
