// schema.ts — validator of `evals/evals.json` (spec 0290 R1-R6, normative contract of the file).
//
// validateEvals(text, ctx) reports EVERY violation, each naming the file, the JSON path and the
// rule; it never throws. A file is valid iff it is well-formed JSON, satisfies R2 to R5 and its
// `skill_name` equals the skill directory name. File existence (R3 `files`) is checked against
// the skill directory on disk.
//
// Usage: const { violations, evals } = validateEvals(text, { file, skillDir, skillName });
// Exit codes: not applicable (library). Finding-line format: `<file>: <jsonPath>: <rule>: <message>`.

import fs from "node:fs";
import path from "node:path";

export interface Violation {
  readonly file: string;
  readonly path: string;
  readonly rule: string;
  readonly message: string;
}

export type Check =
  | { type: "exit_code"; script: string; args: string[]; expected: number }
  | { type: "file_exists"; path: string }
  | { type: "file_contains"; path: string; pattern: string }
  | { type: "file_not_contains"; path: string; pattern: string };

export interface EvalCase {
  id: number;
  prompt: string;
  expected_output: string;
  files: string[];
  expectations: string[];
  checks: Check[];
}

export interface EvalsFile {
  skill_name: string;
  evals: EvalCase[];
  trigger_probes: { query: string; should_trigger: boolean }[];
}

export interface ValidateContext {
  /** The file name used in violations (repository-relative when known). */
  readonly file: string;
  readonly skillDir: string;
  readonly skillName: string;
}

export function formatViolation(v: Violation): string {
  return `${v.file}: ${v.path}: ${v.rule}: ${v.message}`;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** True when `rel` is a relative path that stays inside its base. */
export function staysInside(rel: string): boolean {
  if (rel === "" || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return false;
  const norm = path.posix.normalize(rel.replaceAll("\\", "/"));
  return !(norm === ".." || norm.startsWith("../") || norm === ".");
}

export function validateEvals(
  text: string,
  ctx: ValidateContext,
): { violations: Violation[]; evals?: EvalsFile } {
  const violations: Violation[] = [];
  const bad = (p: string, rule: string, message: string) =>
    void violations.push({ file: ctx.file, path: p, rule, message });
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    bad("$", "R6", `not well-formed JSON: ${(e as Error).message}`);
    return { violations };
  }
  if (!isObj(doc)) {
    bad("$", "R2", "the file must be a JSON object");
    return { violations };
  }
  for (const k of Object.keys(doc))
    if (!["skill_name", "evals", "trigger_probes"].includes(k))
      bad(`$.${k}`, "R2", "unknown top-level key (allowed: skill_name, evals, trigger_probes)");

  const name = doc["skill_name"];
  if (typeof name !== "string" || name === "")
    bad("$.skill_name", "R2", "required non-empty string");
  else if (name !== ctx.skillName)
    bad(
      "$.skill_name",
      "R6",
      `skill_name "${name}" must equal the skill directory name "${ctx.skillName}"`,
    );

  const evals = doc["evals"];
  const cases: EvalCase[] = [];
  if (!Array.isArray(evals) || evals.length === 0)
    bad("$.evals", "R2", "required array of at least one eval");
  else {
    const seen = new Set<number>();
    evals.forEach((raw, i) => {
      const at = `$.evals[${i}]`;
      if (!isObj(raw)) return bad(at, "R3", "an eval must be an object");
      const id = raw["id"];
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0)
        bad(`${at}.id`, "R3", "id must be a positive integer");
      else if (seen.has(id))
        bad(`${at}.id`, "R3", `duplicate id ${id}: ids are unique within the file`);
      else seen.add(id);
      for (const k of ["prompt", "expected_output"] as const) {
        const v = raw[k];
        if (typeof v !== "string" || v.trim() === "")
          bad(`${at}.${k}`, "R3", "required non-empty string");
      }
      const files = raw["files"];
      const fileList: string[] = [];
      if (!Array.isArray(files) || files.some((f) => typeof f !== "string"))
        bad(`${at}.files`, "R3", "files must be an array of strings (possibly empty)");
      else {
        const bases = new Map<string, number>();
        files.forEach((f: string, j) => {
          fileList.push(f);
          if (!staysInside(f))
            return bad(
              `${at}.files[${j}]`,
              "R3",
              `"${f}" must be a path relative to the skill directory that stays inside it`,
            );
          const abs = path.join(ctx.skillDir, f);
          let isFile = false;
          try {
            isFile = fs.statSync(abs).isFile();
          } catch {
            isFile = false;
          }
          if (!isFile)
            bad(`${at}.files[${j}]`, "R3", `"${f}" does not resolve to an existing file`);
          const base = path.posix.basename(f.replaceAll("\\", "/"));
          if (bases.has(base))
            bad(`${at}.files[${j}]`, "R3", `base name "${base}" repeats files[${bases.get(base)}]`);
          else bases.set(base, j);
        });
      }
      const expectations = raw["expectations"];
      const expList: string[] = [];
      if (!Array.isArray(expectations))
        bad(`${at}.expectations`, "R3", "expectations must be an array");
      else
        expectations.forEach((e, j) => {
          if (typeof e !== "string" || e.trim() === "")
            bad(`${at}.expectations[${j}]`, "R3", "each expectation must be a non-empty string");
          else expList.push(e);
        });
      const checks = raw["checks"];
      const checkList: Check[] = [];
      if (checks !== undefined) {
        if (!Array.isArray(checks)) bad(`${at}.checks`, "R4", "checks must be an array");
        else
          checks.forEach((c, j) => {
            const c0 = validateCheck(c, `${at}.checks[${j}]`, bad);
            if (c0 !== undefined) checkList.push(c0);
          });
      }
      const nExp = Array.isArray(expectations) ? expectations.length : 0;
      const nChk = Array.isArray(checks) ? checks.length : 0;
      if (nExp + nChk === 0)
        bad(at, "R3", "an eval must declare at least one expectation or one check");
      cases.push({
        id: typeof id === "number" ? id : -1,
        prompt: typeof raw["prompt"] === "string" ? raw["prompt"] : "",
        expected_output: typeof raw["expected_output"] === "string" ? raw["expected_output"] : "",
        files: fileList,
        expectations: expList,
        checks: checkList,
      });
    });
  }

  const probes = doc["trigger_probes"];
  const probeList: EvalsFile["trigger_probes"] = [];
  if (probes !== undefined) {
    if (!Array.isArray(probes)) bad("$.trigger_probes", "R5", "trigger_probes must be an array");
    else
      probes.forEach((p, j) => {
        const at = `$.trigger_probes[${j}]`;
        if (!isObj(p)) return bad(at, "R5", "a probe must be an object");
        const q = p["query"];
        const t = p["should_trigger"];
        if (typeof q !== "string" || q.trim() === "")
          bad(`${at}.query`, "R5", "required non-empty string");
        if (typeof t !== "boolean") bad(`${at}.should_trigger`, "R5", "required boolean");
        if (typeof q === "string" && typeof t === "boolean")
          probeList.push({ query: q, should_trigger: t });
      });
  }
  if (violations.length > 0) return { violations };
  return {
    violations,
    evals: { skill_name: ctx.skillName, evals: cases, trigger_probes: probeList },
  };
}

function validateCheck(
  c: unknown,
  at: string,
  bad: (p: string, rule: string, message: string) => void,
): Check | undefined {
  if (!isObj(c)) return void bad(at, "R4", "a check must be an object");
  const type = c["type"];
  const relPath = (key: string, mustUnderScripts: boolean): string | undefined => {
    const v = c[key];
    if (typeof v !== "string" || v === "")
      return void bad(`${at}.${key}`, "R4", "required non-empty string");
    if (!staysInside(v))
      return void bad(
        `${at}.${key}`,
        "R4",
        `"${v}" must be a relative path that does not escape its base`,
      );
    if (mustUnderScripts && !v.replaceAll("\\", "/").startsWith("scripts/"))
      return void bad(
        `${at}.${key}`,
        "R4",
        `"${v}" must be a path under the skill's scripts/ directory`,
      );
    return v;
  };
  if (type === "exit_code") {
    const script = relPath("script", true);
    const args = c["args"];
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== "string")))
      bad(`${at}.args`, "R4", "args must be an array of strings");
    const expected = c["expected"];
    if (expected !== undefined && (typeof expected !== "number" || !Number.isInteger(expected)))
      bad(`${at}.expected`, "R4", "expected must be an integer");
    if (script === undefined) return undefined;
    return {
      type,
      script,
      args: Array.isArray(args) ? (args as string[]) : [],
      expected: typeof expected === "number" ? expected : 0,
    };
  }
  if (type === "file_exists") {
    const p = relPath("path", false);
    return p === undefined ? undefined : { type, path: p };
  }
  if (type === "file_contains" || type === "file_not_contains") {
    if (type === "file_not_contains")
      for (const k of Object.keys(c))
        if (!["type", "path", "pattern"].includes(k))
          bad(`${at}.${k}`, "R4", "unknown field (allowed: type, path, pattern)");
    const p = relPath("path", false);
    const pattern = c["pattern"];
    let ok = typeof pattern === "string";
    if (!ok) bad(`${at}.pattern`, "R4", "required string (a regular expression)");
    else
      try {
        new RegExp(pattern as string);
      } catch (e) {
        ok = false;
        bad(`${at}.pattern`, "R4", `invalid regular expression: ${(e as Error).message}`);
      }
    return p === undefined || !ok ? undefined : { type, path: p, pattern: pattern as string };
  }
  return void bad(
    `${at}.type`,
    "R4",
    `unknown check type ${JSON.stringify(type)} (allowed: exit_code, file_exists, file_contains, file_not_contains)`,
  );
}
