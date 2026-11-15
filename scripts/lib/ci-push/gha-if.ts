// gha-if.ts — the closed evaluator of a GitHub job-level `if:` for the R6 wiring test (spec 0309
// delta-02 R6 (c)).
//
// Usage: evalJobIf(expr, ctx) -> boolean; throws UnsupportedIfError for anything outside the
// closed grammar (fail closed, the caller names the job).
//
// Grammar: no condition, `always()`, `success()`, a `==` or `!=` comparison of `github.event_name`,
// `github.ref`, `github.ref_name` or `github.repository` with a string literal, and `!`, `&&`,
// `||` and parentheses over those. Comparisons ignore case, as GitHub does.

export class UnsupportedIfError extends Error {}

export interface IfContext {
  event_name: string;
  ref: string;
  ref_name: string;
  repository: string;
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
const IDENTS = new Set(["event_name", "ref", "ref_name", "repository"]);

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
      const m = /^[A-Za-z_][A-Za-z0-9_.]*(\(\))?/.exec(src.slice(i));
      if (m === null) throw new UnsupportedIfError(`unsupported token '${src.slice(i, i + 10)}'`);
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

type Val = boolean | string;

export function evalJobIf(expr: unknown, ctx: IfContext): boolean {
  if (expr === undefined) return true;
  if (typeof expr !== "string") throw new UnsupportedIfError("a non-string condition");
  let src = expr.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (wrapped !== null) src = (wrapped[1] ?? "").trim();
  if (src === "") return true;
  const toks = tokenize(src);
  let pos = 0;
  const peek = (v: string): boolean => toks[pos]?.t === "op" && toks[pos]?.v === v;
  const bool = (v: Val): boolean => {
    if (typeof v !== "boolean") throw new UnsupportedIfError("a string used as a condition");
    return v;
  };
  const primary = (): Val => {
    const tok = toks[pos++];
    if (tok === undefined) throw new UnsupportedIfError("unexpected end of expression");
    if (tok.t === "str") return tok.v;
    if (tok.t === "op" && tok.v === "(") {
      const v = or();
      if (!peek(")")) throw new UnsupportedIfError("missing closing parenthesis");
      pos++;
      return v;
    }
    if (tok.t === "id") {
      if (tok.v === "always()" || tok.v === "success()") return true;
      const m = /^github\.(\w+)$/.exec(tok.v);
      if (m !== null && IDENTS.has(m[1] ?? "")) return ctx[m[1] as keyof IfContext];
    }
    throw new UnsupportedIfError(`'${tok.v}' is outside the accepted forms`);
  };
  const cmp = (): Val => {
    const l = primary();
    if (peek("==") || peek("!=")) {
      const eq = toks[pos++]?.v === "==";
      const r = primary();
      if (typeof l !== "string" || typeof r !== "string")
        throw new UnsupportedIfError("a comparison of a non-string operand");
      return (l.toLowerCase() === r.toLowerCase()) === eq;
    }
    return l;
  };
  const unary = (): Val => {
    if (peek("!")) {
      pos++;
      return !bool(unary());
    }
    return cmp();
  };
  const and = (): Val => {
    let v = unary();
    while (peek("&&")) {
      pos++;
      const r = bool(unary());
      v = bool(v) && r;
    }
    return v;
  };
  const or = (): Val => {
    let v = and();
    while (peek("||")) {
      pos++;
      const r = bool(and());
      v = bool(v) || r;
    }
    return v;
  };
  const result = bool(or());
  if (pos !== toks.length) throw new UnsupportedIfError("trailing tokens after the expression");
  return result;
}
