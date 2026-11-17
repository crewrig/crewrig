// grammar.ts — the one definition of a citation inside a skill body or reference
// (spec 0293 R9, R11, R12; plan v2 step 1). The skill linter and the component build both
// call it, so a path is "cited" for the linter exactly when it is "cited" for the build.
//
// A citation is a token of the form `references/…`, `scripts/…` or `assets/…`. It counts
// inside inline code spans and ordinary code fences. It does not count inside a `yaml` or
// `yml` fence, nor between `<!-- crewrig-repo-only:start -->` and `<!-- crewrig-repo-only:end -->`
// (the same exemptions as the script-citation check bundled with `pr-reviewer`), nor in the
// frontmatter. A token with a `<placeholder>`, a glob, a variable or a `..` segment, or one
// that ends with a slash (a directory mention), is not a citation of one file.
//
// Usage: import { citations, proseLines, sharedTopic } from "./grammar.ts".
// Exit codes: not applicable (library). Finding-line format: not applicable.

export const REPO_ONLY_START = "<!-- crewrig-repo-only:start -->";
export const REPO_ONLY_END = "<!-- crewrig-repo-only:end -->";

export interface Citation {
  /** Path relative to the skill directory, `/` separators, no leading `./`. */
  readonly path: string;
  /** 1-based line number in the scanned text. */
  readonly line: number;
}

export interface Line {
  /** 1-based line number in the scanned text. */
  readonly line: number;
  /** The line text without its carriage return. */
  readonly text: string;
  /** True inside a code fence (any language), false in prose. */
  readonly inFence: boolean;
  /** True inside a `yaml`/`yml` fence or a repo-only fence: citations are not read there. */
  readonly exempt: boolean;
}

const DELIM = /^---[ \t]*$/;
const TOKEN = /(?:^|[\s`"'(\[])((?:\.\/)?(?:references|scripts|assets)\/[^\s`"')\]]+)/g;
const SHARED = /^references\/shared-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** The lines of `text` with the frontmatter removed (when asked) and each line's fence state. */
export function classify(text: string, skipFrontmatter: boolean): Line[] {
  const raw = text.split("\n");
  let i = 0;
  if (skipFrontmatter && raw.length > 0 && DELIM.test(raw[0] as string)) {
    i = 1;
    while (i < raw.length && !DELIM.test(raw[i] as string)) i++;
    i++;
  }
  const out: Line[] = [];
  let fence: { ch: string; len: number; yaml: boolean } | undefined;
  let repoOnly = false;
  for (; i < raw.length; i++) {
    const t = (raw[i] as string).replace(/\r$/, "");
    const open = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(t);
    if (fence !== undefined) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(t);
      const run = close === null ? "" : (close[1] as string);
      const closes = run.startsWith(fence.ch) && run.length >= fence.len;
      out.push({ line: i + 1, text: t, inFence: true, exempt: fence.yaml || repoOnly });
      if (closes) fence = undefined;
      continue;
    }
    if (open !== null) {
      const lang = (open[2] as string).toLowerCase();
      const run = open[1] as string;
      fence = { ch: run.charAt(0), len: run.length, yaml: lang === "yaml" || lang === "yml" };
      out.push({ line: i + 1, text: t, inFence: true, exempt: fence.yaml || repoOnly });
      continue;
    }
    const trimmed = t.trim();
    if (trimmed === REPO_ONLY_START) repoOnly = true;
    out.push({ line: i + 1, text: t, inFence: false, exempt: repoOnly });
    if (trimmed === REPO_ONLY_END) repoOnly = false;
  }
  return out;
}

/** The lines of prose: fences and repo-only blocks removed, inline code spans blanked. */
export function proseLines(text: string, skipFrontmatter: boolean): Line[] {
  return classify(text, skipFrontmatter)
    .filter((l) => !l.inFence && !l.exempt)
    .map((l) => ({ ...l, text: l.text.replace(/(`+)[^`]*?\1/g, " ") }));
}

function usable(token: string): string | undefined {
  const trimmed = token.replace(/^\.\//, "").replace(/[.,;:!?]+$/, "");
  if (trimmed.endsWith("/")) return undefined;
  if (/[<>{}*$|\\]/.test(trimmed)) return undefined;
  if (trimmed.split("/").some((seg) => seg === ".." || seg === "")) return undefined;
  return trimmed;
}

/** Every citation in `text`, in line order, duplicates kept. */
export function citations(text: string, skipFrontmatter: boolean): Citation[] {
  const found: Citation[] = [];
  for (const l of classify(text, skipFrontmatter)) {
    if (l.exempt) continue;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(l.text); m !== null; m = TOKEN.exec(l.text)) {
      const p = usable(m[1] as string);
      if (p !== undefined) found.push({ path: p, line: l.line });
    }
  }
  return found;
}

/** The topic of a shared-reference path (`references/shared-<topic>.md`), or undefined. */
export function sharedTopic(citedPath: string): string | undefined {
  const m = SHARED.exec(citedPath);
  return m === null ? undefined : (m[1] as string);
}
