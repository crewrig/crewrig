// ratchet-lists.ts — list files of the spec 0238 ratchet (scripts/check-ratchet.ts):
// parsing with hygiene findings, the shared finding collector, and the
// shrink-only `--write` generator. Standard library only (runs before `npm ci`).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  WiringError,
  inBuiltTree,
  isJsFile,
  isShellFile,
  repoRoot,
  resolveBase,
  showAt,
  trackedFiles,
} from "./ts-scope.ts";

export const SHELL_LIST = "ci/shell-allowlist.txt";
export const JS_BASELINE = "ci/js-baseline.txt";
export const JS_EXCEPTIONS = "ci/js-exceptions.txt";
export const WRITE_CMD =
  "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ratchet.ts --write";

export interface Entry {
  value: string;
  reason: string;
  line: number;
}

export const findings: string[] = [];

export function finding(rule: string, where: string, message: string): void {
  findings.push(`ratchet: ${rule}: ${where}: ${message}`);
}

/** Parse a list file: `#` lines are comments; every other line is one entry. */
export function parseList(rel: string, content: string, withReason: boolean): Entry[] {
  const entries: Entry[] = [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let previous: string | undefined;
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.startsWith("#")) return;
    const [value = "", ...rest] = withReason ? raw.split("\t") : [raw];
    if (value.trim() === "") {
      finding("list-unsorted", `${rel}:${line}`, "blank entry line; remove it");
      return;
    }
    if (previous !== undefined && value <= previous) {
      const why = value === previous ? "duplicate entry" : "entry out of byte order";
      finding(
        "list-unsorted",
        `${rel}:${line}`,
        `${why} '${value}'; keep the list sorted and unique`,
      );
    }
    previous = value;
    entries.push({ value, reason: rest.join("\t").trim(), line });
  });
  return entries;
}

const listCache = new Map<string, Entry[]>();

/** Read and parse a list once per run, so hygiene findings are reported once. */
export function readList(rel: string, withReason: boolean, optional: boolean): Entry[] {
  const cached = listCache.get(rel);
  if (cached !== undefined) return cached;
  const entries = loadList(rel, withReason, optional);
  listCache.set(rel, entries);
  return entries;
}

function loadList(rel: string, withReason: boolean, optional: boolean): Entry[] {
  const abs = path.join(repoRoot(), rel);
  if (!existsSync(abs)) {
    if (optional) return [];
    throw new WiringError(`${rel} is missing; generate it with: ${WRITE_CMD}`);
  }
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch (err) {
    throw new WiringError(`${rel} is unreadable: ${String(err)}`);
  }
  return parseList(rel, content, withReason);
}

function header(name: string, what: string): string {
  return [
    `# ${name} — generated, shrink-only list of ${what} (spec 0238).`,
    `# Regenerate with: ${WRITE_CMD}`,
    "# Entries may only ever be removed: delete a line in the same PR that",
    "# deletes or migrates its file. See DEVELOPMENT.md (TypeScript toolchain and ratchet).",
  ].join("\n");
}

export function computeSets(tracked: string[]): { shell: string[]; js: string[] } {
  const scoped = tracked.filter((p) => !inBuiltTree(p));
  return {
    shell: scoped.filter((p) => isShellFile(p)).sort(),
    js: scoped.filter((p) => isJsFile(p)).sort(),
  };
}

export function writeLists(): void {
  const base = resolveBase();
  const { shell, js } = computeSets(trackedFiles());
  const plan: Array<[string, string[], string]> = [
    [SHELL_LIST, shell, "tracked shell files outside the built-copy trees"],
    [JS_BASELINE, js, "tracked JavaScript files outside the built-copy trees"],
  ];
  for (const [rel, computed, what] of plan) {
    const abs = path.join(repoRoot(), rel);
    const onBase = base === null ? null : showAt(base.mergeBase, rel);
    const bootstrap = (base !== null && onBase === null) || (!existsSync(abs) && onBase === null);
    let entries = computed;
    if (!bootstrap) {
      // Intersect with the base list when there is one, so --write can never
      // re-admit an entry a PR added; without a base, with the working tree.
      const source = onBase ?? readFileSync(abs, "utf8");
      const kept = new Set(parseList(rel, source, false).map((e) => e.value));
      entries = computed.filter((p) => kept.has(p));
    }
    const body = entries.length > 0 ? `${entries.join("\n")}\n` : "";
    writeFileSync(abs, `${header(path.basename(rel), what)}\n${body}`);
    const mode = bootstrap ? "bootstrap" : "shrink-only";
    console.log(`ratchet: wrote ${rel} (${entries.length} entries, ${mode})`);
  }
}

export function parseListQuiet(content: string): string[] {
  return content.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
}
