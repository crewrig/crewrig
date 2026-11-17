// subagent-conventions.ts — verify the subagent conventions block of every compiled agent
// (spec 0306 R17, R18). Independent of the emitter on purpose: nothing here imports the build
// code, so the check is not a tautology of it. The fragment rules and the provenance pattern
// are restated below.
//
// Usage: checkSubagentConventions(repoDir, io) -> exit code
// Inspects the WORKING TREE. Sources are `artifacts/*/agents/*/AGENT.md`; emitted files are the
// flat regular `*.md` files of `.claude/agents`, `.gemini/agents`, `.github/agents` and
// `.agents/agents`, at the repository root and under each `dist/*/`.
// Exit codes: 0 everything holds (OK line on stdout); 1 findings, each on stderr as
// `- <path>: <rule>` with <rule> one of fragment-invalid, missing-block, stale-block,
// missing-omit-key, foreign-omit-key, source-carries-block; 2 the fragment file is absent or the
// repository root cannot be resolved.

import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

export const FRAGMENT_REL = "artifacts/core/fragments/subagent-conventions.md";
const CEILING = 1500;
const PROVENANCE = /<!--\s*provenance:|crewrig-provenance/;
const KEY = "omitClaudeMd: true";

const TREES: readonly { readonly dir: string; readonly claude: boolean }[] = [
  { dir: ".claude/agents", claude: true },
  { dir: ".gemini/agents", claude: false },
  { dir: ".github/agents", claude: false },
  { dir: ".agents/agents", claude: false },
];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort(byCodeUnit);
  } catch {
    return [];
  }
}

/** True when `text` breaks R2 to R4. */
export function fragmentInvalid(text: string): boolean {
  if (text === "" || text.includes("\r")) return true;
  const lines = text.split("\n");
  if (!/^## \S/.test(lines[0] ?? "")) return true;
  if (!text.endsWith("\n") || text.endsWith("\n\n")) return true;
  if ([...text].length > CEILING) return true;
  if (/\$\{[^}]*\}/.test(text) || PROVENANCE.test(text)) return true;
  return lines.includes("---");
}

/** The frontmatter lines of a compiled file, `null` when it has no frontmatter. */
function frontmatter(text: string): string[] | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  return end < 0 ? null : lines.slice(1, end);
}

/** Flat regular `*.md` files of one agent tree, sorted; symlinks and directories are skipped. */
function flatFiles(dir: string): string[] {
  return names(dir).filter((n) => {
    if (!n.endsWith(".md")) return false;
    try {
      return lstatSync(`${dir}/${n}`).isFile();
    } catch {
      return false;
    }
  });
}

export function checkSubagentConventions(repoDir: string, io: Io): number {
  if (!isDir(repoDir)) {
    io.err(`Error: repository root ${repoDir} cannot be resolved`);
    return 2;
  }
  let fragment: string;
  try {
    fragment = readFileSync(`${repoDir}/${FRAGMENT_REL}`, "utf8");
  } catch {
    io.err(`Error: ${FRAGMENT_REL} is absent under ${repoDir}`);
    return 2;
  }

  const found: string[] = [];
  const finding = (path: string, rule: string): void => {
    found.push(`- ${path}: ${rule}`);
  };

  const valid = !fragmentInvalid(fragment);
  if (!valid) finding(FRAGMENT_REL, "fragment-invalid");
  const heading = fragment.split("\n")[0] ?? "";
  const hasHeading = /^## \S/.test(heading);
  const tail = `\n\n${fragment}`;

  // (e) no agent source carries the block.
  let sources = 0;
  if (hasHeading) {
    for (const tier of names(`${repoDir}/artifacts`)) {
      const agents = `${repoDir}/artifacts/${tier}/agents`;
      for (const agent of names(agents)) {
        const rel = `artifacts/${tier}/agents/${agent}/AGENT.md`;
        let text: string;
        try {
          text = readFileSync(`${repoDir}/${rel}`, "utf8");
        } catch {
          continue;
        }
        sources += 1;
        if (text.split("\n").includes(heading)) finding(rel, "source-carries-block");
      }
    }
  }

  // (b) (c) (d) every emitted file, at the root and under each dist/*/.
  const bases = [""];
  for (const d of names(`${repoDir}/dist`))
    if (isDir(`${repoDir}/dist/${d}`)) bases.push(`dist/${d}/`);
  let files = 0;
  for (const base of bases) {
    for (const tree of TREES) {
      const rel = `${base}${tree.dir}`;
      const dir = `${repoDir}/${rel}`;
      if (!isDir(dir)) {
        io.out(`OK: ${rel} is absent — nothing to check.`);
        continue;
      }
      for (const name of flatFiles(dir)) {
        files += 1;
        const path = `${rel}/${name}`;
        const text = readFileSync(`${repoDir}/${path}`, "utf8");
        if (valid && !text.endsWith(tail)) {
          finding(path, text.split("\n").includes(heading) ? "stale-block" : "missing-block");
        }
        const front = frontmatter(text) ?? [];
        if (tree.claude) {
          if (front.filter((l) => l === KEY).length !== 1) finding(path, "missing-omit-key");
        } else if (front.some((l) => /^omitClaudeMd\s*:/.test(l))) {
          finding(path, "foreign-omit-key");
        }
      }
    }
  }

  if (found.length > 0) {
    for (const line of found) io.err(line);
    return 1;
  }
  io.out(
    `OK: the conventions block holds in ${files} compiled agent file(s) and ${sources} source(s).`,
  );
  return 0;
}
