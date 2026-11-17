// gha-if.ts — the closed evaluator of a GitHub job-level `if:` for the R6 wiring test (spec 0309
// delta-02 R6 (c)).
//
// Usage: evalJobIf(expr, ctx) -> boolean; throws UnsupportedIfError for anything outside the
// closed grammar (fail closed, the caller names the job).
//
// Grammar: no condition, `always()`, `success()`, `cancelled()`, a `==` or `!=` comparison of
// `github.event_name`, `github.ref`, `github.ref_name`, `github.repository`, `needs.<job>.result` or
// `needs.<job>.outputs.<name>` with a string literal, and `!`, `&&`, `||` and parentheses over those.
// Comparisons ignore case, as GitHub does. A condition with no status function gets GitHub's
// implicit `success() && (<whole expression>)`, applied to the parsed result.
//
// Three-valued logic (issue #1933, D5): on a push `cancelled()` is false and every `needs.*` value is
// UNKNOWN (the context carries no `needs`). A comparison of an unknown string is an unknown boolean,
// `!` of unknown is unknown, `&&` is false if either side is false, `||` is true if either side is
// true. A lookup is an unknown STRING and `bool()` rejects every string, so `needs.x.outputs.y` as a
// bare condition still throws. A condition that read a `needs.*` value under an unknown `needs` is
// accepted only if it is TRUE whatever those values are; false or unknown throws. A condition with
// no `needs.*` keeps the plain true/false result.

export class UnsupportedIfError extends Error {}

export interface IfContext {
  event_name: string;
  ref: string;
  ref_name: string;
  repository: string;
  /** Defaults to false. */
  cancelled?: boolean;
  /** Whether every needed job succeeded; defaults to true. */
  success?: boolean;
  /** Absent means every `needs.*` value is UNKNOWN (a push, where the check cannot know them). */
  needs?: Record<string, { result?: string; outputs?: Record<string, string> }>;
}

/** The canonical repository: a `github.repository` guard is a fork guard, true here. */
export const CANONICAL_REPOSITORY = "crewrig/crewrig";

/** The context of a push to `refName` (`main` or a `release/` branch) on the canonical repository. */
export function pushContext(refName: string): IfContext {
  return {
    event_name: "push",
    ref: `refs/heads/${refName}`,
    ref_name: refName,
    repository: CANONICAL_REPOSITORY,
  };
}

type Tok = { t: "str" | "id" | "op"; v: string };
const IDENTS = ["event_name", "ref", "ref_name", "repository"] as const;
const STATUS_FNS = new Set(["always()", "success()", "failure()", "cancelled()"]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) i++;
    else if (ch === "'") {
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= src.length) throw new UnsupportedIfError("unterminated string literal");
        if (src.charAt(j) === "'") {
          if (src.charAt(j + 1) === "'") {
            v += "'";
            j += 2;
            continue;
          }
          break;
        }
        v += src.charAt(j++);
      }
      out.push({ t: "str", v });
      i = j + 1;
    } else if (
      src.startsWith("==", i) ||
      src.startsWith("!=", i) ||
      src.startsWith("&&", i) ||
      src.startsWith("||", i)
    ) {
      out.push({ t: "op", v: src.slice(i, i + 2) });
      i += 2;
    } else if (ch === "!" || ch === "(" || ch === ")") {
      out.push({ t: "op", v: ch });
      i++;
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_.-]*(\(\))?/.exec(src.slice(i));
      if (m === null) throw new UnsupportedIfError(`unsupported token '${src.slice(i, i + 10)}'`);
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

// A string (known or UNKNOWN) or a boolean (known, or UNKNOWN as null).
type Val = { s: string | null } | { b: boolean | null };

export function evalJobIf(expr: unknown, ctx: IfContext): boolean {
  if (expr === undefined) return true;
  if (typeof expr !== "string") throw new UnsupportedIfError("a non-string condition");
  let src = expr.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (wrapped !== null) src = (wrapped[1] ?? "").trim();
  if (src === "") return true;
  const toks = tokenize(src);
  let pos = 0;
  let readNeeds = false;
  const peek = (v: string): boolean => toks[pos]?.t === "op" && toks[pos]?.v === v;
  const bool = (v: Val): boolean | null => {
    if (!("b" in v)) throw new UnsupportedIfError("a string used as a condition");
    return v.b;
  };
  const lookup = (id: string): Val | undefined => {
    const g = /^github\.(\w+)$/.exec(id);
    const name = IDENTS.find((n) => n === g?.[1]);
    if (name !== undefined) return { s: ctx[name] };
    const n = /^needs\.([\w-]+)\.(?:result|outputs\.([\w-]+))$/.exec(id);
    if (n === null) return undefined;
    readNeeds = true;
    const job = ctx.needs?.[n[1] ?? ""];
    if (job === undefined) return { s: null };
    return { s: n[2] === undefined ? (job.result ?? "") : (job.outputs?.[n[2]] ?? "") };
  };
  const primary = (): Val => {
    const tok = toks[pos++];
    if (tok === undefined) throw new UnsupportedIfError("unexpected end of expression");
    if (tok.t === "str") return { s: tok.v };
    if (tok.t === "op" && tok.v === "(") {
      const v = or();
      if (!peek(")")) throw new UnsupportedIfError("missing closing parenthesis");
      pos++;
      return v;
    }
    if (tok.t === "id") {
      if (tok.v === "always()") return { b: true };
      if (tok.v === "success()") return { b: ctx.success ?? true };
      if (tok.v === "cancelled()") return { b: ctx.cancelled ?? false };
      const v = lookup(tok.v);
      if (v !== undefined) return v;
    }
    throw new UnsupportedIfError(`'${tok.v}' is outside the accepted forms`);
  };
  const cmp = (): Val => {
    const l = primary();
    if (peek("==") || peek("!=")) {
      const eq = toks[pos++]?.v === "==";
      const r = primary();
      if (!("s" in l) || !("s" in r))
        throw new UnsupportedIfError("a comparison of a non-string operand");
      if (l.s === null || r.s === null) return { b: null };
      return { b: (l.s.toLowerCase() === r.s.toLowerCase()) === eq };
    }
    return l;
  };
  const unary = (): Val => {
    if (peek("!")) {
      pos++;
      const v = bool(unary());
      return { b: v === null ? null : !v };
    }
    return cmp();
  };
  const and = (): Val => {
    let v = bool(unary());
    while (peek("&&")) {
      pos++;
      const r = bool(unary());
      v = v === false || r === false ? false : v === true && r === true ? true : null;
    }
    return { b: v };
  };
  const or = (): Val => {
    let v = bool(and());
    while (peek("||")) {
      pos++;
      const r = bool(and());
      v = v === true || r === true ? true : v === false && r === false ? false : null;
    }
    return { b: v };
  };
  let result = bool(or());
  if (pos !== toks.length) throw new UnsupportedIfError("trailing tokens after the expression");
  if (!toks.some((t) => t.t === "id" && STATUS_FNS.has(t.v)) && ctx.success === false)
    result = false;
  if (readNeeds && ctx.needs === undefined && result !== true)
    throw new UnsupportedIfError(
      "unsupported: a needs.* value is unknown on a push and the condition is not true without it",
    );
  if (result === null) throw new UnsupportedIfError("unsupported: the condition stays unknown");
  return result;
}
