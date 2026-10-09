// hardening-kit.ts — builders for the security-hardening suites of the build (spec 0250 delta 01,
// requirements 34 and 35): hostile YAML and hostile component names, and a sandbox whose repository
// root sits two directories below a directory the suite owns, so a write that leaves the output
// root is visible and cannot reach a real location. Nothing here reimplements a module under test.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO } from "../../lib/build-fixture-tree.ts";
import type { FixtureTree, RunResult } from "../../lib/build-fixture-tree.ts";

/** A YAML double-quoted scalar for `text`: C0 and C1 controls, DEL, `\` and `"` escaped (YAML refuses them raw). */
export function quoted(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || char === '"') out += `\\${char}`;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f))
      out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += char;
  }
  return `"${out}"`;
}

/**
 * Block-mapping lines of `levels + 1` anchored sequences, `a0` a flat one of `width` scalars and
 * each next one a sequence of `width` aliases of the one below: a few hundred bytes that expand to
 * `width ** (levels + 1)` nodes once every alias is followed.
 */
export function aliasBomb(levels: number, width: number): string[] {
  const lines = [`a0: &a0 [${Array.from({ length: width }, () => "x").join(",")}]`];
  for (let level = 1; level <= levels; level += 1) {
    const refs = Array.from({ length: width }, () => `*a${level - 1}`).join(",");
    lines.push(`a${level}: &a${level} [${refs}]`);
  }
  return lines;
}

/** A skill, agent or command source whose YAML `name` is `name` (written escaped). */
export function namedSource(name: string, extra: readonly string[] = []): string {
  return ["---", `name: ${quoted(name)}`, 'description: "d"', ...extra, "---", "Body.", ""].join(
    "\n",
  );
}

export type Kind = "skill" | "agent" | "command";

/** Where `kind` named `dir` lives under a tier, and the `.md` source it has there. */
export function sourcePath(tier: string, kind: Kind, dir: string): string {
  if (kind === "skill") return `artifacts/${tier}/skills/${dir}/SKILL.md`;
  if (kind === "agent") return `artifacts/${tier}/agents/${dir}/AGENT.md`;
  return `artifacts/${tier}/commands/${dir}.md`;
}

const owned: string[] = [];
after(() => {
  for (const dir of owned) fs.rmSync(dir, { recursive: true, force: true });
  owned.length = 0;
});

function mkOwned(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  owned.push(dir);
  return dir;
}

function walk(root: string, rel: string, into: string[], files: boolean): void {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const sub = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!files) into.push(sub);
      walk(root, sub, into, files);
    } else {
      into.push(sub);
    }
  }
}

export interface Sandbox {
  /** The directory the suite owns; `repo` is two levels below it (`<container>/a/b/repo`). */
  readonly container: string;
  /** `REPO_DIR` of every run: the repository root the build reads and writes. */
  readonly repo: string;
  /** The `TMPDIR` of every run, empty before it: a staging root or merge root shows here. */
  readonly tmp: string;
  /** Write a file under the repository root (parents created). */
  write(rel: string, content: string): void;
  /** Copy the committed `model-mappings/` into the repository root. */
  seedMappings(): void;
  run(args: readonly string[]): RunResult;
  /** Every file and directory of the container that is not the repository root or inside it. */
  outside(): string[];
  /** Every file of the repository root, `/`-separated, sorted. */
  inside(): string[];
  /** Every path of the container and of `tmp` with a segment containing `marker`. */
  find(marker: string): string[];
  /** Entries left in `tmp`. */
  leftovers(): string[];
}

/** A sandbox that runs the entry of `tree` over its own repository root and `TMPDIR`. */
export function createSandbox(tree: FixtureTree): Sandbox {
  const container = mkOwned("bc-hard-");
  const tmp = mkOwned("bc-hard-tmp-");
  const repo = path.join(container, "a", "b", "repo");
  fs.mkdirSync(repo, { recursive: true });
  const write = (rel: string, content: string): void => {
    const file = path.join(repo, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write("crewrig.config.toml", 'canonical_repo = "https://example.test/o/r"\n');
  const outside = (): string[] => {
    const all: string[] = [];
    walk(container, "", all, false);
    const inRepo = "a/b/repo";
    return all.filter((p) => p !== inRepo && !p.startsWith(`${inRepo}/`)).sort();
  };
  return {
    container,
    repo,
    tmp,
    write,
    seedMappings: () =>
      fs.cpSync(path.join(REPO, "model-mappings"), path.join(repo, "model-mappings"), {
        recursive: true,
      }),
    run: (args) => tree.run(args, { env: { REPO_DIR: repo, TMPDIR: tmp, TEMP: tmp, TMP: tmp } }),
    outside,
    inside() {
      const files: string[] = [];
      walk(repo, "", files, true);
      return files.sort();
    },
    find(marker) {
      const hits: string[] = [];
      for (const root of [container, tmp]) {
        const all: string[] = [];
        walk(root, "", all, false);
        for (const p of all) if (p.split("/").some((seg) => seg.includes(marker))) hits.push(p);
      }
      return hits.sort();
    },
    leftovers: () => fs.readdirSync(tmp).sort(),
  };
}
