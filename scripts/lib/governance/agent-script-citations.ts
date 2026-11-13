// agent-script-citations.ts — the script-citation rule for agent bodies (issue #1863, extending spec 0289).
//
// An agent body (artifacts/*/agents/*/AGENT.md) installs on its own, with no scripts/ directory beside it,
// so a `scripts/...` path cited there resolves nowhere. Every such citation SHALL sit inside a
// `<!-- crewrig-repo-only:start -->` / `<!-- crewrig-repo-only:end -->` fence (a step for the CrewRig
// repository only, announced by visible prose). A skill's script is cited as `<skill-dir>/scripts/...`,
// which is not a citation. Nothing else resolves a citation, and a `..` segment never does.
//
// The scanning semantics (fence markers, fenced code blocks, yaml/yml blocks ignored, the citation pattern,
// nested/stray/unterminated fence findings) are a deliberate DUPLICATE of `citationFindings` in
// artifacts/core/skills/pr-reviewer/scripts/lint-skill.ts: that bundled script must stay self-contained and
// cannot import a repository library. scripts/tests/agent-script-citations.test.ts runs both
// implementations on the same fixtures so the two cannot diverge.
//
// Usage: findCitations(text, { skipFrontmatter, resolves }) / findAgentCitations(repoDir)
// Exit codes: not applicable (library). Finding-line format: defined by the calling script.

import fs from "node:fs";
import path from "node:path";

export const FENCE_START = "<!-- crewrig-repo-only:start -->";
export const FENCE_END = "<!-- crewrig-repo-only:end -->";
const CITATION =
  /(?:^|[\s`"'(])(?:\.\/)?(scripts\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|js|mjs|py|sh))(?![A-Za-z0-9_-])/g;
const DELIM = /^---[ \t\n\v\f\r]*$/;

export interface Finding {
  readonly line: number;
  readonly message: string;
}

export interface ScanOptions {
  /** Skip the leading `---` frontmatter block. */
  readonly skipFrontmatter: boolean;
  /** Whether an unfenced citation resolves. An agent body resolves nothing. */
  readonly resolves: (cited: string) => boolean;
  /** Wording of the unresolved-citation finding after the cited path. */
  readonly hint?: string;
}

/** Citation and fence findings of one Markdown text, in line order. */
export function findCitations(text: string, opts: ScanOptions): Finding[] {
  const found: Finding[] = [];
  const lines = text.split("\n");
  let i = 0;
  if (opts.skipFrontmatter && DELIM.test(lines[0] as string)) {
    i = 1;
    while (i < lines.length && !DELIM.test(lines[i] as string)) i++;
    i++;
  }
  let fence = 0;
  let code: { ch: string; len: number; skip: boolean } | undefined;
  for (; i < lines.length; i++) {
    const raw = (lines[i] as string).replace(/\r$/, "");
    const lineNo = i + 1;
    const fm = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(raw);
    if (code !== undefined) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (close !== null) {
        const run = close[1] as string;
        if (run.startsWith(code.ch) && run.length >= code.len) code = undefined;
        continue;
      }
    } else if (fm !== null) {
      const run = fm[1] as string;
      const lang = (fm[2] as string).toLowerCase();
      code = { ch: run.charAt(0), len: run.length, skip: lang === "yaml" || lang === "yml" };
      continue;
    }
    if (code === undefined) {
      const trimmed = raw.trim();
      if (trimmed === FENCE_START) {
        if (fence !== 0)
          found.push({
            line: lineNo,
            message: "nested crewrig-repo-only fence (start inside an open fence)",
          });
        else fence = lineNo;
        continue;
      }
      if (trimmed === FENCE_END) {
        if (fence === 0)
          found.push({
            line: lineNo,
            message: "stray crewrig-repo-only end marker (no open fence)",
          });
        fence = 0;
        continue;
      }
    } else if (code.skip) {
      continue;
    }
    if (fence !== 0) continue;
    CITATION.lastIndex = 0;
    for (let m = CITATION.exec(raw); m !== null; m = CITATION.exec(raw)) {
      const cited = m[1] as string;
      if (!cited.includes("..") && opts.resolves(cited)) continue;
      found.push({
        line: lineNo,
        message: `unresolved script citation ${cited} (${opts.hint ?? "not in a crewrig-repo-only fence"})`,
      });
    }
  }
  if (fence !== 0)
    found.push({ line: fence, message: "unterminated crewrig-repo-only fence (no end marker)" });
  return found;
}

/** Every `artifacts/<layer>/agents/<name>/AGENT.md` under a repository root, sorted. */
export function agentBodies(repoDir: string): string[] {
  const out: string[] = [];
  const artifacts = path.join(repoDir, "artifacts");
  let layers: string[] = [];
  try {
    layers = fs.readdirSync(artifacts).sort();
  } catch {
    return out;
  }
  for (const layer of layers) {
    const agents = path.join(artifacts, layer, "agents");
    let names: string[] = [];
    try {
      names = fs.readdirSync(agents).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(agents, name, "AGENT.md");
      if (fs.existsSync(file)) out.push(file);
    }
  }
  return out;
}

export interface AgentFinding extends Finding {
  /** Path relative to the repository root, `/` separators. */
  readonly file: string;
}

/** Citation findings of every agent body under a repository root. */
export function findAgentCitations(repoDir: string): AgentFinding[] {
  const out: AgentFinding[] = [];
  for (const file of agentBodies(repoDir)) {
    const rel = path.relative(repoDir, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "latin1");
    for (const f of findCitations(text, {
      skipFrontmatter: true,
      resolves: () => false,
      hint: "an agent ships no scripts: cite a skill's script as <skill-dir>/scripts/..., or put the step in a crewrig-repo-only fence",
    }))
      out.push({ ...f, file: rel });
  }
  return out;
}
