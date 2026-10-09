// context-spans.ts — the mask pass and the ONLY/EXCEPT span pass of the context renderer,
// pure functions over text (spec 0254 R16).
// Twins `_render_context_impl` pass (b) (scripts/lib/render-context.sh:463-465) and
// `_render_context_pass_a` (render-context.sh:192-350), reproducing its awk control flow:
// the first diagnostic aborts the scan and nothing else is produced.

/** U+0001 stands for a literal `$${` between the mask pass and the unmask pass. */
export const MASK = "\u0001";
/** U+0002 marks both sites of a kept span until the blank-line rule has run. */
export const SENTINEL = "\u0002";

/** The outcome of one pass: the rewritten text, or the diagnostics (complete lines, no line feed). */
export type PassResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly diagnostics: string[] };

/** Pass (b): every literal `$${` becomes U+0001 (leftmost, non-overlapping matches). */
export function maskLiteralDollars(source: string): string {
  return source.split("$${").join(MASK);
}

/** The one-based line of the character at `pos` (0-based): the `\n` before it, plus one (awk `line_at`). */
export function lineAt(text: string, pos: number): number {
  let count = 1;
  for (let k = text.indexOf("\n"); k >= 0 && k < pos; k = text.indexOf("\n", k + 1)) count += 1;
  return count;
}

type MarkerKind = "ONLY" | "EXCEPT" | "ENDONLY" | "ENDEXCEPT";
type SpanKind = "ONLY" | "EXCEPT";

const MARKERS: ReadonlyArray<readonly [MarkerKind, string]> = [
  ["ONLY", "${ONLY:"],
  ["EXCEPT", "${EXCEPT:"],
  ["ENDONLY", "${ENDONLY}"],
  ["ENDEXCEPT", "${ENDEXCEPT}"],
];

interface Marker {
  readonly kind: MarkerKind;
  readonly at: number;
  readonly length: number;
}

/** The earliest of the four markers at or after `from`, or undefined. */
function nextMarker(text: string, from: number): Marker | undefined {
  let best: Marker | undefined;
  for (const [kind, literal] of MARKERS) {
    const at = text.indexOf(literal, from);
    if (at >= 0 && (best === undefined || at < best.at)) {
      best = { kind, at, length: literal.length };
    }
  }
  return best;
}

/** Rule 5: a line that is whitespace-only and carries a sentinel is deleted; sentinels are stripped. */
function dropSentinelLines(text: string): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const clean = line.split(SENTINEL).join("");
    if (clean.length !== line.length && /^[ \t\r]*$/.test(clean)) continue;
    kept.push(clean);
  }
  return kept.join("\n");
}

/**
 * Pass (a): resolves the `${ONLY:...}`/`${EXCEPT:...}` spans of the MASKED text for `target`.
 * `knownTargets` is the descriptor's row names without the `_`-prefixed keys; `fname` names the
 * source in the diagnostics.
 */
export function resolveSpans(
  text: string,
  target: string,
  knownTargets: readonly string[],
  fname: string,
): PassResult {
  const known = ` ${knownTargets.join(" ")} `;
  const fail = (code: string, pos: number, message: string): PassResult => ({
    ok: false,
    diagnostics: [`${code}: ${fname}:${lineAt(text, pos)} - ${message}`],
  });
  let out = "";
  let i = 0;
  let inSpan = false;
  let spanKeep = false;
  let spanKind: SpanKind = "ONLY";
  let openLine = 0;
  for (;;) {
    const marker = nextMarker(text, i);
    if (marker === undefined) {
      if (inSpan) {
        return {
          ok: false,
          diagnostics: [
            `UNCLOSED-BLOCK: ${fname}:${openLine} - ${spanKind} span opened here has no matching close before end of file`,
          ],
        };
      }
      out += text.slice(i);
      break;
    }
    const prefix = text.slice(i, marker.at);
    const { kind, at } = marker;
    if (kind === "ONLY" || kind === "EXCEPT") {
      const nameStart = at + marker.length;
      const brace = text.indexOf("}", nameStart);
      if (brace < 0) return fail("UNCLOSED-BLOCK", at, `${kind} marker has no closing brace`);
      const raw = text.slice(nameStart, brace);
      if (inSpan) {
        return fail(
          "NESTED-BLOCK",
          at,
          `a new ${kind} span opened while a ${spanKind} span is already open`,
        );
      }
      if (raw === "") return fail("EMPTY-TARGET-LIST", at, "${" + kind + ":} names no target");
      const named = new Set<string>();
      let unknown = "";
      for (const part of raw.split(",")) {
        const name = part.replace(/^[ \t]+|[ \t]+$/g, "");
        named.add(name);
        if (!known.includes(` ${name} `)) unknown = name;
      }
      if (unknown !== "") {
        return fail("UNKNOWN-TARGET", at, `'${unknown}' is not a known render target`);
      }
      let keep = named.has(target);
      if (kind === "EXCEPT") {
        keep = !keep;
        if (knownTargets.every((name) => named.has(name))) {
          return fail(
            "SPAN-KEPT-NOWHERE",
            at,
            "${EXCEPT:" + raw + "} names every known target; this span is kept on none of them",
          );
        }
      }
      out += prefix + (keep ? SENTINEL : "");
      inSpan = true;
      spanKeep = keep;
      spanKind = kind;
      openLine = lineAt(text, at);
      i = brace + 1;
      continue;
    }
    if (!inSpan) return fail("STRAY-BLOCK-END", at, `${kind} with no span open`);
    if (kind !== (spanKind === "ONLY" ? "ENDONLY" : "ENDEXCEPT")) {
      return fail("MISMATCHED-BLOCK-END", at, `a ${spanKind} span closed by ${kind}`);
    }
    if (spanKeep) out += prefix + SENTINEL;
    inSpan = false;
    i = at + marker.length;
  }
  return { ok: true, text: dropSentinelLines(out) };
}
