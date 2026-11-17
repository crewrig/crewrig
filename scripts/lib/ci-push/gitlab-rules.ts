// gitlab-rules.ts — the closed evaluator of GitLab `rules:` for the R6 wiring test (spec 0309
// delta-02 R6 (d), (e)): is a job of the generated `.gitlab-ci.yml` run, unfiltered, by a branch
// pipeline for a push to `main` or a `release/` branch with no open merge request.
//
// Usage: workflowCreatesPipeline(doc, vars), jobOnPush(doc, job, vars); both throw
// UnresolvedRuleError (fail closed) on a condition, `extends`, `include`, `only` or `except` the
// evaluator cannot resolve.
//
// A rule counts as running only when `when` is absent, `on_success` or `always` and the rule has no
// `changes:` or `exists:`; `manual`, `delayed` and `never` do not count.

export class UnresolvedRuleError extends Error {}

export type Vars = Record<string, string | undefined>;

/** The variables of a branch pipeline for a push to `branch` with no open merge request. */
export function pushVars(branch: string): Vars {
  return {
    CI_PIPELINE_SOURCE: "push",
    CI_COMMIT_BRANCH: branch,
    CI_COMMIT_REF_NAME: branch,
    CI_DEFAULT_BRANCH: "main",
  };
}

type Tok = { t: "var" | "str" | "re" | "null" | "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src.charAt(i);
    let m: RegExpExecArray | null;
    if (/\s/.test(ch)) i++;
    else if ((m = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(rest)) !== null) {
      out.push({ t: "var", v: m[0].slice(1) });
      i += m[0].length;
    } else if ((m = /^"([^"\\]*)"|^'([^'\\]*)'/.exec(rest)) !== null) {
      out.push({ t: "str", v: m[1] ?? m[2] ?? "" });
      i += m[0].length;
    } else if ((m = /^\/((?:[^/\\]|\\.)*)\/([a-z]*)/.exec(rest)) !== null) {
      if (m[2] !== "" && m[2] !== "i") throw new UnresolvedRuleError(`regex flags '${m[2]}'`);
      out.push({ t: "re", v: (m[2] === "i" ? "(?i)" : "") + (m[1] ?? "") });
      i += m[0].length;
    } else if (rest.startsWith("null")) {
      out.push({ t: "null", v: "null" });
      i += 4;
    } else if ((m = /^(==|!=|=~|!~|&&|\|\||\(|\))/.exec(rest)) !== null) {
      out.push({ t: "op", v: m[0] });
      i += m[0].length;
    } else throw new UnresolvedRuleError(`unsupported token '${rest.slice(0, 12)}'`);
  }
  return out;
}

type Val = string | undefined | RegExp | boolean;

/** Evaluate one `if:` expression over `vars`. */
export function evalCondition(src: string, vars: Vars): boolean {
  const toks = tokenize(src);
  let pos = 0;
  const peekOp = (...ops: string[]): string | undefined => {
    const k = toks[pos];
    return k !== undefined && k.t === "op" && ops.includes(k.v) ? k.v : undefined;
  };
  const operand = (): Val => {
    const k = toks[pos++];
    if (k === undefined) throw new UnresolvedRuleError("unexpected end of condition");
    if (k.t === "var") return vars[k.v];
    if (k.t === "str") return k.v;
    if (k.t === "null") return undefined;
    if (k.t === "re") {
      if (k.v.startsWith("(?i)")) return new RegExp(k.v.slice(4), "i");
      return new RegExp(k.v);
    }
    if (k.t === "op" && k.v === "(") {
      const v = or();
      if (peekOp(")") === undefined) throw new UnresolvedRuleError("missing closing parenthesis");
      pos++;
      return v;
    }
    throw new UnresolvedRuleError(`unexpected '${k.v}'`);
  };
  const cmp = (): Val => {
    const l = operand();
    const op = peekOp("==", "!=", "=~", "!~");
    if (op === undefined) return typeof l === "boolean" ? l : l !== undefined && l !== "";
    pos++;
    const r = operand();
    if (op === "==" || op === "!=") {
      if (
        l instanceof RegExp ||
        r instanceof RegExp ||
        typeof l === "boolean" ||
        typeof r === "boolean"
      )
        throw new UnresolvedRuleError("a comparison of a regex or boolean with ==");
      return (l === r) === (op === "==");
    }
    if (!(r instanceof RegExp) || typeof l === "boolean" || l instanceof RegExp)
      throw new UnresolvedRuleError("a match against a non-regex");
    const hit = l !== undefined && r.test(l);
    return op === "=~" ? hit : !hit;
  };
  const and = (): boolean => {
    let v = truthy(cmp());
    while (peekOp("&&") !== undefined) {
      pos++;
      const r = truthy(cmp());
      v = v && r;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (peekOp("||") !== undefined) {
      pos++;
      const r = and();
      v = v || r;
    }
    return v;
  };
  const truthy = (v: Val): boolean => {
    if (typeof v === "boolean") return v;
    if (v instanceof RegExp) throw new UnresolvedRuleError("a regex used as a condition");
    return v !== undefined && v !== "";
  };
  const result = or();
  if (pos !== toks.length) throw new UnresolvedRuleError("trailing tokens after the condition");
  return result;
}

type Doc = Record<string, unknown>;

function asRecord(v: unknown): Doc | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : undefined;
}

/** The first rule of `rules` that is true in `vars`; undefined when none is. */
function firstTrue(rules: unknown[], vars: Vars, who: string): Doc | undefined {
  for (const raw of rules) {
    const r = asRecord(raw);
    if (r === undefined) throw new UnresolvedRuleError(`${who}: a rule that is not a mapping`);
    const cond = r["if"];
    if (cond === undefined) return r;
    if (typeof cond !== "string")
      throw new UnresolvedRuleError(`${who}: a non-string rule condition`);
    if (evalCondition(cond, vars)) return r;
  }
  return undefined;
}

/** Whether the workflow rules create a pipeline for the push described by `vars`. */
export function workflowCreatesPipeline(doc: Doc, vars: Vars): boolean {
  if (doc["include"] !== undefined)
    throw new UnresolvedRuleError("workflow: an include is not resolved");
  const wf = asRecord(doc["workflow"]);
  const rules = wf?.["rules"];
  if (rules === undefined) return true;
  if (!Array.isArray(rules)) throw new UnresolvedRuleError("workflow: rules is not a list");
  const r = firstTrue(rules, vars, "workflow");
  return r !== undefined && r["when"] !== "never";
}

const RUNS = new Set(["on_success", "always"]);

export type JobOnPush = { runs: true } | { runs: false; why: string };

/** Whether `job` runs, unfiltered, in the push described by `vars`. */
export function jobOnPush(doc: Doc, job: string, vars: Vars): JobOnPush {
  const j = asRecord(doc[job]);
  if (j === undefined) throw new UnresolvedRuleError(`${job}: not a job of the file`);
  for (const k of ["only", "except", "extends"])
    if (j[k] !== undefined)
      throw new UnresolvedRuleError(`${job}: uses '${k}', which is not resolved`);
  if (doc["include"] !== undefined)
    throw new UnresolvedRuleError(`${job}: an include is not resolved`);
  const verdict = (when: unknown, what: string): JobOnPush =>
    when === undefined || RUNS.has(String(when))
      ? { runs: true }
      : { runs: false, why: `${what} has when: ${String(when)}` };
  const rules = j["rules"];
  if (rules === undefined) return verdict(j["when"], "the job");
  if (!Array.isArray(rules)) throw new UnresolvedRuleError(`${job}: rules is not a list`);
  const r = firstTrue(rules, vars, job);
  if (r === undefined) return { runs: false, why: "no rule is true" };
  if (r["changes"] !== undefined || r["exists"] !== undefined)
    return { runs: false, why: "the first true rule carries changes: or exists:" };
  return verdict(r["when"], "the first true rule");
}

const RESERVED = new Set([
  "stages",
  "workflow",
  "default",
  "variables",
  "include",
  "image",
  "services",
  "cache",
  "before_script",
  "after_script",
  "pages",
]);

/** The job keys of a parsed `.gitlab-ci.yml`: non-hidden mappings with `script` or `trigger`. */
export function jobNames(doc: Doc): string[] {
  return Object.keys(doc).filter((k) => {
    if (k.startsWith(".") || (RESERVED.has(k) && k !== "pages")) return false;
    const v = asRecord(doc[k]);
    return v !== undefined && (v["script"] !== undefined || v["trigger"] !== undefined);
  });
}
