// ci-split.ts — writes the capability reference directory from one source text (spec 0309 R2).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-split.ts [--from <file>] [--ref <git-ref>]
//   Source: --from <file>, or `git show <git-ref>:ci/ci-capabilities.yml`, or the file
//   ci/ci-capabilities.yml itself. Re-run it after a rebase that touched the old file: it
//   rewrites every file of ci/capabilities/ from scratch.
// Placement: ci/capability-parts.json lists, per group (and `standalone` for the capabilities
// without one), ordered parts of id globs; the first part whose glob matches takes the
// capability and the last part is `*`. A part holding nothing writes no file. A block moves
// as text, with the comment lines that lead it, and is never edited, with one exception: a
// path-filter entry that is exactly `ci/ci-capabilities.yml` becomes `ci/capabilities/**`
// (R12(e), the deletion of that file makes it unavoidable; scripts/ci-split-proof.ts checks it).
// It always works on the checkout it lives in. Exit: 0 ok, 1 invalid input.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { globToRegExp } from "./lib/glob-engine.ts";
import { splitBlocks, type Block } from "./lib/ci-split/blocks.ts";

const SELF_ENTRY = /^( +- )"ci\/ci-capabilities\.yml"$/gm;

export interface Part {
  part?: string;
  ids: string[];
}
export type Parts = Record<string, Part[]>;

const GROUPS = ["gate", "modules", "governance", "extensions", "integration", "windows"];

/** File name of a group's part: `<group>.yml` or `<group>-<part>.yml`. */
export const fileName = (group: string, part: Part): string =>
  `${group === "" ? "standalone" : group}${part.part ? `-${part.part}` : ""}.yml`;

/** The R2 header: one comment line, then `capabilities:`. */
export const header = (group: string, part: Part): string =>
  `# CI capabilities: ${group === "" ? "standalone" : `group ${group}`}${part.part ? `, part ${part.part}` : ""} (format: docs/ci-reference-format.md, spec 0309).\ncapabilities:\n`;

/** Throws on a parts file that breaks the rules above. */
export function checkParts(parts: Parts): void {
  for (const g of Object.keys(parts))
    if (![...GROUPS, "standalone"].includes(g)) throw new Error(`parts: unknown group '${g}'`);
  for (const g of [...GROUPS, "standalone"]) {
    const list = parts[g];
    if (!list || list.length === 0) throw new Error(`parts: group '${g}' has no part`);
    const last = list[list.length - 1] as Part;
    if (last.ids.length !== 1 || last.ids[0] !== "*")
      throw new Error(`parts: the last part of '${g}' must be exactly ["*"]`);
    const names = list.map((p) => p.part ?? "");
    if (new Set(names).size !== names.length) throw new Error(`parts: '${g}' repeats a part name`);
    if (list.length > 1 && names.includes(""))
      throw new Error(`parts: '${g}' has several parts, each needs a name`);
  }
}

/** The files to write, name to text, from the blocks of the source. */
export function place(blocks: Block[], parts: Parts): Map<string, string> {
  checkParts(parts);
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) throw new Error(`capability '${b.id}' appears twice in the source`);
    seen.add(b.id);
    const key = b.group === "" ? "standalone" : b.group;
    const list = parts[key];
    if (!list) throw new Error(`capability '${b.id}': unknown group '${b.group}'`);
    const part = list.find((p) => p.ids.some((g) => globToRegExp(g).test(b.id))) as Part;
    const name = fileName(b.group, part);
    out.set(
      name,
      (out.get(name) ?? header(b.group, part)) +
        b.text.replace(SELF_ENTRY, '$1"ci/capabilities/**"'),
    );
  }
  return out;
}

function main(): number {
  const repo = path.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const opt = (n: string): string | undefined => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  try {
    const from = opt("--from");
    const ref = opt("--ref");
    const source =
      from !== undefined
        ? fs.readFileSync(from, "utf8")
        : ref !== undefined
          ? execFileSync("git", ["show", `${ref}:ci/ci-capabilities.yml`], {
              cwd: repo,
              encoding: "utf8",
              maxBuffer: 1 << 26,
            })
          : fs.readFileSync(path.join(repo, "ci/ci-capabilities.yml"), "utf8");
    const parts = JSON.parse(
      fs.readFileSync(path.join(repo, "ci/capability-parts.json"), "utf8"),
    ) as Parts;
    const files = place(splitBlocks(source), parts);
    const dir = path.join(repo, "ci/capabilities");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of files) fs.writeFileSync(path.join(dir, name), text);
    for (const [name, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1)))
      process.stdout.write(`${text.split("\n").length - 1} ${name}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`ci-split: ${(e as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
