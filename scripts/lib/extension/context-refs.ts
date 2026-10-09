// context-refs.ts — the name, reference, near-miss and unmask passes of the context renderer,
// pure functions over text (spec 0254 R16).
// Twins `_render_context_impl` passes (c) and (e) (scripts/lib/render-context.sh:484-490, 505),
// `_render_context_pass_d` (render-context.sh:354-403) and `_render_context_warn_near_miss`
// (render-context.sh:407-428). Every replacement is a literal string replacement.

import { lineAt, MASK, type PassResult } from "./context-spans.ts";

/** In-vocabulary identifiers, never a near miss (`RENDER_CONTEXT_VOCAB`, render-context.sh:128). */
const VOCAB = ["TOOL", "EXTENSION", "COMMAND", "SKILL", "ONLY", "EXCEPT", "ENDONLY", "ENDEXCEPT"];
/** Known-external identifiers (`RENDER_CONTEXT_KNOWN_EXTERNAL`, render-context.sh:126). */
const KNOWN_EXTERNAL = ["SKELETON_NAME"];

function replaceAllLiteral(text: string, search: string, value: string): string {
  return text.split(search).join(value);
}

/** The descriptor's `{ext}` then `{name}` placeholders, replaced as plain strings. */
export function expandTemplate(template: string, ext: string, name: string): string {
  return replaceAllLiteral(replaceAllLiteral(template, "{ext}", ext), "{name}", name);
}

/** Pass (c): `${TOOL}` then `${EXTENSION}`, replaced literally. */
export function substituteNames(text: string, displayName: string, extName: string): string {
  return replaceAllLiteral(
    replaceAllLiteral(text, "${TOOL}", displayName),
    "${EXTENSION}",
    extName,
  );
}

/**
 * The declared entries as the shell hands them to awk: each name followed by one space
 * (`tr '\n' ' '`), the whole padded by one space each side. Membership is a substring test
 * for ` <name> `, so an empty reference name matches (two adjacent spaces), as in the shell.
 */
function declaredSet(names: readonly string[]): string {
  return ` ${names.map((name) => `${name} `).join("")} `;
}

export interface RefInput {
  readonly fname: string;
  readonly extName: string;
  readonly commandRef: string;
  readonly skillRef: string;
  readonly declaredCommands: readonly string[];
  readonly declaredSkills: readonly string[];
}

/** Pass (d): `${COMMAND:x}` / `${SKILL:x}` against the declared entries; every unresolved one is reported. */
export function resolveReferences(text: string, input: RefInput): PassResult {
  const commands = declaredSet(input.declaredCommands);
  const skills = declaredSet(input.declaredSkills);
  const diagnostics: string[] = [];
  let out = "";
  let i = 0;
  for (;;) {
    const command = text.indexOf("${COMMAND:", i);
    const skill = text.indexOf("${SKILL:", i);
    let best = -1;
    let kind = "";
    if (command >= 0) {
      best = command;
      kind = "COMMAND";
    }
    if (skill >= 0 && (best < 0 || skill < best)) {
      best = skill;
      kind = "SKILL";
    }
    if (best < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, best);
    const nameStart = best + (kind === "COMMAND" ? 10 : 8);
    const brace = text.indexOf("}", nameStart);
    if (brace < 0) {
      out += text.slice(best);
      break;
    }
    const name = text.slice(nameStart, brace);
    const declared = kind === "COMMAND" ? commands : skills;
    if (declared.includes(` ${name} `)) {
      out += expandTemplate(
        kind === "COMMAND" ? input.commandRef : input.skillRef,
        input.extName,
        name,
      );
    } else {
      diagnostics.push(
        `UNRESOLVED-REFERENCE: ${input.fname}:${lineAt(text, best)} - \${${kind}:${name}}`,
      );
    }
    i = brace + 1;
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, text: out };
}

/** Pass (e): U+0001 back to `${`. */
export function unmask(text: string): string {
  return replaceAllLiteral(text, MASK, "${");
}

/** The near-miss warnings of the final text (non-fatal), one per surviving token, in order. */
export function nearMissWarnings(text: string, fname: string): string[] {
  const warnings: string[] = [];
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    for (const match of (lines[n] ?? "").matchAll(/\$\{[A-Za-z_]+(:[^}]*)?\}/g)) {
      const token = match[0];
      const ident = token.slice(2, -1).split(":")[0] ?? "";
      if (VOCAB.includes(ident) || KNOWN_EXTERNAL.includes(ident)) continue;
      if (/^[A-Z][A-Z_]*$/.test(ident)) {
        warnings.push(
          `Warning: ${fname}:${n + 1} — '${token}' has the shape of a vocabulary token but matches none; passed through verbatim`,
        );
      }
    }
  }
  return warnings;
}
