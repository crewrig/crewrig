// context-render.ts — the context renderer as one pure function over text (spec 0254 R16).
// Twins `_render_context_impl` (the shell renderer `render-context` (deleted in spec 0254 PR D; `git show 6657b08:scripts/lib/render-context (shell)`) lines 446-511): the passes run in the
// order (b) mask, (a) spans, (c) names, (d) references, (e) unmask, then the near-miss scan.
// No file is read or written and nothing is printed: the caller passes the data and prints the
// returned diagnostics and warnings.

import { maskLiteralDollars, resolveSpans } from "./context-spans.ts";
import { nearMissWarnings, resolveReferences, substituteNames, unmask } from "./context-refs.ts";

export interface RenderInput {
  readonly source: string;
  /** The source's name as the diagnostics print it. */
  readonly sourceName: string;
  readonly target: string;
  /** The descriptor's row names, `_`-prefixed keys already excluded by the caller. */
  readonly knownTargets: readonly string[];
  readonly displayName: string;
  readonly commandRef: string;
  readonly skillRef: string;
  readonly extName: string;
  readonly declaredCommands: readonly string[];
  readonly declaredSkills: readonly string[];
}

export type RenderResult =
  | { readonly ok: true; readonly text: string; readonly warnings: string[] }
  | { readonly ok: false; readonly diagnostics: string[] };

/**
 * U+0001 is the mask's own byte; U+0003 is refused too: the shell's awk read it as a record
 * separator and silently truncated the source (spec 0254 deviation 28(e)).
 */
const RESERVED: ReadonlyArray<readonly [string, string]> = [
  ["\u0001", "U+0001"],
  ["\u0003", "U+0003"],
];

export function renderContext(input: RenderInput): RenderResult {
  const name = input.sourceName;
  for (const [byte, label] of RESERVED) {
    if (input.source.includes(byte)) {
      return {
        ok: false,
        diagnostics: [
          `ERROR: ${name} — source already contains a reserved control byte (${label}); cannot render`,
        ],
      };
    }
  }
  const spanned = resolveSpans(
    maskLiteralDollars(input.source),
    input.target,
    input.knownTargets,
    name,
  );
  if (!spanned.ok) return spanned;
  const named = substituteNames(spanned.text, input.displayName, input.extName);
  const resolved = resolveReferences(named, {
    fname: name,
    extName: input.extName,
    commandRef: input.commandRef,
    skillRef: input.skillRef,
    declaredCommands: input.declaredCommands,
    declaredSkills: input.declaredSkills,
  });
  if (!resolved.ok) return resolved;
  const text = unmask(resolved.text);
  return { ok: true, text, warnings: nearMissWarnings(text, name) };
}
