// evaluate.ts — the R6 wiring checks (spec 0309 delta-02 R6, R7) over in-memory inputs, so a
// fixture and the real tree go through the same code. Each check returns findings, one line each,
// naming the capability or job, the file and the engine; an empty list means the check passes.
//
// Usage: build PushInputs from the committed files, then call the check you need
// (checkReference = (a), checkWorkflowFilters = (b), checkJobConditions and checkGate = (c),
// checkGitlab = (d) and (e), checkExemptionList = (f), checkPullRequestControl = (g),
// checkCacheInvariance = (h), checkSkillBudgets = R7).

import { decide } from "../ci-paths-gate/gate.ts";
import { readEffective } from "../ci-paths-gate/reference.ts";
import { readCapabilities } from "../ci-parity/reference-read.ts";
import { portableCapabilities } from "../build-ci/reference.ts";
import type { TaskfileTree } from "../taskfile-tree.ts";
import { get, parse, render, resolve, YqSeq } from "../yq-accessors/index.ts";
import { listMatches, PUSH_REFS, readPush, UnresolvedPatternError } from "./branches.ts";
import { closure } from "./closure.ts";
import { checkExemptions, parseExemptions } from "./exemptions.ts";
import type { Exemption } from "./exemptions.ts";
import { evalJobIf, pushContext } from "./gha-if.ts";
import {
  jobNames,
  jobOnPush,
  pushVars,
  UnresolvedRuleError,
  workflowCreatesPipeline,
} from "./gitlab-rules.ts";

export type Engine = "reference" | "github" | "gitlab";

export interface Finding {
  rule: string;
  engine: Engine;
  subject: string;
  message: string;
}

export interface PushInputs {
  /** The concatenated capability reference text (readReference(...).text). */
  reference: string;
  /** Every workflow file under .github/workflows/, by repository-relative path. */
  workflows: Record<string, string>;
  /** The generated .gitlab-ci.yml text. */
  gitlab: string;
  /** ci/push-main-exemptions.txt. */
  exemptions: string;
  tree: TaskfileTree;
  /** The YAML reader: js-yaml is loaded by the caller, never imported here (spec 0250 R24). */
  parseYaml: (text: string) => unknown;
}

const f = (rule: string, engine: Engine, subject: string, message: string): Finding => ({
  rule,
  engine,
  subject,
  message,
});

type Doc = Record<string, unknown>;
const rec = (v: unknown): Doc | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : undefined;

/** Render a finding as the line the test prints. */
export const show = (x: Finding): string => `(${x.rule}) [${x.engine}] ${x.subject}: ${x.message}`;

type CapRecord = ReturnType<typeof readCapabilities>[number];

function capsOf(reference: string): CapRecord[] {
  return readCapabilities(parse(reference));
}

/** A capability with a push trigger that names `main` or `release/**` (a tags-only one never counts). */
interface PushCap {
  rec: CapRecord;
  /** The refs of PUSH_REFS its push trigger names. */
  refs: string[];
  filtered: boolean;
}

function pushCaps(reference: string): PushCap[] {
  const doc = parse(reference);
  const out: PushCap[] = [];
  readCapabilities(doc).forEach((rec, ci) => {
    const refs = new Set<string>();
    let filtered = false;
    rec.triggers.forEach((t, ti) => {
      if (t.kind !== "push") return;
      const b = resolve(get(doc, ["capabilities", String(ci), "trigger", String(ti), "branches"]));
      if (!(b instanceof YqSeq)) {
        if (!t.keys.includes("tag-pattern")) PUSH_REFS.forEach((r) => refs.add(r));
      } else {
        const list = b.items.map((i) => render(resolve(i)));
        PUSH_REFS.filter((r) => listMatches(list, r)).forEach((r) => refs.add(r));
      }
      if (t.paths.length > 0) filtered = true;
    });
    if (refs.size > 0) out.push({ rec, refs: [...refs], filtered });
  });
  return out;
}

function exemptionEntries(inp: PushInputs): Exemption[] {
  return parseExemptions(inp.exemptions).entries;
}

/** (a) the reference: a push trigger on main with a non-empty effective path set needs a side-effect entry. */
export function checkReference(inp: PushInputs): Finding[] {
  const side = new Set(
    exemptionEntries(inp)
      .filter((e) => e.kind === "side-effect")
      .map((e) => e.id),
  );
  const out: Finding[] = [];
  for (const { rec: c, filtered } of pushCaps(inp.reference))
    if (filtered && !side.has(c.id))
      out.push(
        f(
          "a",
          "reference",
          c.id,
          "its push trigger on main has a path filter and the capability has no side-effect entry",
        ),
      );
  return out;
}

interface JobInfo {
  key: string;
  job: Doc;
  /** The capability id the job belongs to, "" when none is found. */
  capability: string;
}

function ciJobId(job: Doc): string {
  const steps = job["steps"];
  if (!Array.isArray(steps)) return "";
  for (const s of steps) {
    const r = rec(s);
    const uses = r?.["uses"];
    if (typeof uses === "string" && uses.endsWith("/actions/ci-job")) {
      const id = rec(r?.["with"])?.["id"];
      if (typeof id === "string") return id;
    }
  }
  return "";
}

/** Job to capability: the ci-job `id:` input, else a `# ci-capability:` annotation, else the job key when a capability has it. */
function jobsOf(text: string, doc: Doc, caps: Set<string>): JobInfo[] {
  const jobs = rec(doc["jobs"]) ?? {};
  return Object.entries(jobs).map(([key, raw]) => {
    const job = rec(raw) ?? {};
    const note = new RegExp(`^ {2}${key}:[ \\t]*#[ \\t]*ci-capability:[ \\t]*(\\S+)`, "m").exec(
      text,
    );
    const id = ciJobId(job) || (note?.[1] ?? "") || (caps.has(key) ? key : "");
    return { key, job, capability: id };
  });
}

function loadDoc(inp: PushInputs, text: string): Doc {
  const d = rec(inp.parseYaml(text));
  if (d === undefined) throw new Error("not a mapping");
  return d;
}

/** The capabilities a workflow file hosts, plus those whose evidence names the file. */
function hosted(file: string, text: string, doc: Doc, capRecs: CapRecord[]): string[] {
  const ids = new Set(
    jobsOf(text, doc, new Set(capRecs.map((c) => c.id)))
      .map((j) => j.capability)
      .filter((x) => x !== ""),
  );
  for (const c of capRecs) if (c.evidence.includes(file)) ids.add(c.id);
  return [...ids];
}

/** (b) every workflow whose push names main or release/** carries no paths or paths-ignore, unless exempt. */
export function checkWorkflowFilters(inp: PushInputs): Finding[] {
  const out: Finding[] = [];
  // A push filter is excused by a side-effect entry (or a file entry), never by a no-push one.
  const entries = new Set(
    exemptionEntries(inp)
      .filter((e) => e.kind === "side-effect")
      .map((e) => e.id),
  );
  const capRecs = capsOf(inp.reference);
  for (const [file, text] of Object.entries(inp.workflows)) {
    let doc: Doc;
    try {
      doc = loadDoc(inp, text);
    } catch (e) {
      out.push(
        f(
          "b",
          "github",
          file,
          `cannot be parsed (fail closed): ${(e as Error).message.split("\n")[0]}`,
        ),
      );
      continue;
    }
    let push;
    try {
      push = readPush(doc["on"]);
    } catch (e) {
      if (!(e instanceof UnresolvedPatternError)) throw e;
      out.push(
        f("b", "github", file, `push trigger cannot be resolved (fail closed): ${e.message}`),
      );
      continue;
    }
    if (file.endsWith("/build.yml") && (push === null || push.refs.length !== PUSH_REFS.length))
      out.push(f("b", "github", file, "the push trigger lacks main or release/**"));
    if (push === null || !push.counts || !(push.paths || push.pathsIgnore)) continue;
    const exempt =
      entries.has(file) || hosted(file, text, doc, capRecs).some((id) => entries.has(id));
    if (!exempt)
      out.push(
        f(
          "b",
          "github",
          file,
          `the push trigger carries ${push.paths ? "paths:" : "paths-ignore:"} and neither the file nor a capability it hosts has an exemption entry`,
        ),
      );
  }
  return out;
}

const CALLEE = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/;

/** (c, job conditions) a job reached on a push to main or release/ carries no `if:` that is false or outside the closed grammar. */
export function checkJobConditions(inp: PushInputs): Finding[] {
  const out: Finding[] = [];
  const entries = new Set(exemptionEntries(inp).map((e) => e.id));
  const capIds = new Set(capsOf(inp.reference).map((c) => c.id));
  const docs = new Map<string, { text: string; doc: Doc }>();
  for (const [file, text] of Object.entries(inp.workflows)) {
    try {
      docs.set(file, { text, doc: loadDoc(inp, text) });
    } catch {
      // checkWorkflowFilters reports the unparsable file.
    }
  }
  const walk = (file: string, root: string, refName: string, ok: (k: string) => boolean): void => {
    const got = docs.get(file);
    if (got === undefined) return;
    const jobs = jobsOf(got.text, got.doc, capIds);
    const byKey = new Map(jobs.map((j) => [j.key, j]));
    const memo = new Map<string, boolean>();
    const runs = (key: string, stack: string[]): boolean => {
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const j = byKey.get(key);
      if (j === undefined || stack.includes(key)) return true;
      let v: boolean;
      try {
        v = evalJobIf(j.job["if"], pushContext(refName));
      } catch (e) {
        out.push(
          f(
            "c",
            "github",
            `${file} job '${key}'`,
            `condition outside the closed grammar (fail closed): ${(e as Error).message}`,
          ),
        );
        v = true;
      }
      const needs = j.job["needs"];
      const list =
        typeof needs === "string" ? [needs] : Array.isArray(needs) ? needs.map(String) : [];
      const ownTrue = v;
      v = v && list.every((n) => runs(n, [...stack, key]));
      memo.set(key, v);
      if (
        !v &&
        !(
          entries.has(key) ||
          entries.has(file) ||
          (j.capability !== "" && entries.has(j.capability))
        )
      )
        out.push(
          f(
            "c",
            "github",
            `${file} job '${key}'`,
            `does not run on a push to ${refName} (${ownTrue ? "a needed job is skipped" : "its if: is false"}) and is not in the exemption list`,
          ),
        );
      return v;
    };
    for (const j of jobs) {
      if (!ok(j.key)) continue;
      const running = runs(j.key, []);
      const uses = typeof j.job["uses"] === "string" ? CALLEE.exec(j.job["uses"]) : null;
      if (running && uses !== null) walk(`.github/workflows/${uses[1]}`, root, refName, () => true);
    }
  };
  for (const [file, { doc }] of docs) {
    let push;
    try {
      push = readPush(doc["on"]);
    } catch {
      continue;
    }
    if (push === null || !push.counts) continue;
    for (const r of push.refs) walk(file, file, r, () => true);
  }
  return dedupe(out);
}

function dedupe(xs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = show(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The synthetic changed file that no filter pattern of the reference matches. */
export const SYNTHETIC_FILE = "zz-synthetic-no-pattern-matches/unfiltered-probe.dat";

const diffOf =
  (files: string[]) =>
  async (a: string[]): Promise<string> =>
    a[0] === "diff" ? files.join("\n") + "\n" : a[0] === "rev-parse" ? "b".repeat(40) + "\n" : "";
const BEFORE = "b".repeat(40);

/** (c, gate) the gate decision for a push with a change set no pattern matches is "run" for every capability of (a)'s set. */
export async function checkGate(inp: PushInputs): Promise<Finding[]> {
  const out: Finding[] = [];
  const side = new Set(
    exemptionEntries(inp)
      .filter((e) => e.kind === "side-effect")
      .map((e) => e.id),
  );
  for (const { rec: c } of pushCaps(inp.reference)) {
    if (side.has(c.id)) continue;
    const eff = readEffective(inp.reference, c.id);
    const d = await decide(c.id, "push", BEFORE, eff.paths, diffOf([SYNTHETIC_FILE]));
    if (!d.changed)
      out.push(
        f(
          "c",
          "github",
          c.id,
          "the gate decides not to run it on a push whose changes match no filter pattern",
        ),
      );
  }
  return out;
}

/** (d, e) GitLab: a pipeline is created for a push to main and release/, and every job of a capability with a push trigger runs unfiltered. */
export function checkGitlab(inp: PushInputs): Finding[] {
  const out: Finding[] = [];
  let doc: Doc;
  try {
    doc = loadDoc(inp, inp.gitlab);
  } catch (e) {
    return [
      f(
        "e",
        "gitlab",
        ".gitlab-ci.yml",
        `cannot be parsed (fail closed): ${(e as Error).message.split("\n")[0]}`,
      ),
    ];
  }
  const pcs = new Map(pushCaps(inp.reference).map((p) => [p.rec.id, p]));
  for (const branch of PUSH_REFS) {
    const vars = pushVars(branch);
    try {
      if (!workflowCreatesPipeline(doc, vars))
        out.push(
          f(
            "d",
            "gitlab",
            "workflow:rules",
            `no pipeline is created for a push to ${branch} with no open merge request`,
          ),
        );
    } catch (e) {
      if (!(e instanceof UnresolvedRuleError)) throw e;
      out.push(
        f("e", "gitlab", "workflow:rules", `cannot be resolved (fail closed): ${e.message}`),
      );
    }
    for (const job of jobNames(doc)) {
      if (pcs.get(job)?.refs.includes(branch) !== true) continue;
      try {
        const r = jobOnPush(doc, job, vars);
        if (!r.runs)
          out.push(
            f("d", "gitlab", job, `does not run unfiltered on a push to ${branch}: ${r.why}`),
          );
      } catch (e) {
        if (!(e instanceof UnresolvedRuleError)) throw e;
        out.push(f("e", "gitlab", job, `cannot be resolved (fail closed): ${e.message}`));
      }
    }
  }
  return out;
}

/** (f) the exemption list. */
export function checkExemptionList(inp: PushInputs): Finding[] {
  const parsed = parseExemptions(inp.exemptions);
  const caps = capsOf(inp.reference);
  const otherIds = new Set(Object.keys(inp.workflows));
  for (const [file, text] of Object.entries(inp.workflows)) {
    try {
      jobsOf(text, loadDoc(inp, text), new Set()).forEach((j) => otherIds.add(j.key));
    } catch {
      // reported by (b)
    }
  }
  const pcs = pushCaps(inp.reference);
  const reachCache = new Map<string, string[]>();
  const problems = [
    ...parsed.problems,
    ...checkExemptions(parsed.entries, {
      capabilities: new Set(caps.map((c) => c.id)),
      otherIds,
      withPush: new Set(pcs.map((p) => p.rec.id)),
      unfilteredPush: new Set(pcs.filter((p) => !p.filtered).map((p) => p.rec.id)),
      reached: (id) => {
        let v = reachCache.get(id);
        if (v === undefined) {
          const cap = caps.find((c) => c.id === id);
          const r = closure(inp.tree, cap?.cmds ?? []);
          v = [...r.tests, ...r.checks];
          reachCache.set(id, v);
        }
        return v;
      },
    }),
  ];
  return problems.map((p) => f("f", "reference", EXEMPTION_SUBJECT, p));
}
const EXEMPTION_SUBJECT = "ci/push-main-exemptions.txt";

/** (g) control: pull requests keep their filters on both engines. */
export async function checkPullRequestControl(inp: PushInputs): Promise<Finding[]> {
  const out: Finding[] = [];
  let gl: Doc | undefined;
  try {
    gl = loadDoc(inp, inp.gitlab);
  } catch {
    gl = undefined;
  }
  const jobs = new Set(gl === undefined ? [] : jobNames(gl));
  for (const c of capsOf(inp.reference)) {
    const pr = c.triggers.find((t) => t.kind === "pull-request");
    if (pr === undefined || pr.paths.length === 0) continue;
    const eff = readEffective(inp.reference, c.id);
    const d = await decide(c.id, "pull_request", BEFORE, eff.paths, diffOf([SYNTHETIC_FILE]));
    if (d.changed)
      out.push(
        f(
          "g",
          "github",
          c.id,
          "a pull request that matches no filter pattern is run: its pull-request filter was removed",
        ),
      );
    if (gl !== undefined && jobs.has(c.id)) {
      const rules = gl[c.id] !== undefined ? rec(gl[c.id])?.["rules"] : undefined;
      const mr = Array.isArray(rules)
        ? rules.filter(
            (r) =>
              typeof rec(r)?.["if"] === "string" &&
              String(rec(r)?.["if"]).includes("merge_request_event"),
          )
        : [];
      if (!mr.some((r) => rec(r)?.["changes"] !== undefined))
        out.push(f("g", "gitlab", c.id, "no merge-request rule carries changes: any more"));
    }
  }
  return out;
}

interface CacheView {
  gate: string;
  gen: string;
  env: string;
}

/** The effective cache.files and cache.env of every capability as the gate reader and the generator read them. */
function cacheViews(reference: string): Map<string, CacheView> {
  const gen = new Map(portableCapabilities(reference).map((c) => [c.id, c]));
  const out = new Map<string, CacheView>();
  for (const c of capsOf(reference)) {
    const e = readEffective(reference, c.id);
    const g = gen.get(c.id);
    out.set(c.id, {
      gate: JSON.stringify(e.cacheFiles),
      gen: g === undefined ? "" : JSON.stringify(g.cacheFiles.split("\n").filter((l) => l !== "")),
      env: JSON.stringify([e.cacheEnv, g?.cacheEnv ?? ""]),
    });
  }
  return out;
}

/** (h) cache invariance: the effective cache.files and cache.env of every capability, on both readers, are equal before and after a change of form. */
export function checkCacheInvariance(before: string, after: string): Finding[] {
  const b = cacheViews(before);
  const out: Finding[] = [];
  for (const [id, v] of cacheViews(after)) {
    const w = b.get(id);
    if (w === undefined) continue;
    for (const k of ["gate", "gen", "env"] as const)
      if (v[k] !== w[k])
        out.push(
          f(
            "h",
            "reference",
            id,
            `the effective cache ${k === "env" ? "env" : "files"} changed on the ${k === "gen" ? "generator" : "gate"} reader: ${w[k]} became ${v[k]}`,
          ),
        );
  }
  return out;
}

/** (h) on one reference: neither reader falls back to the paths of a trigger when a capability has no cache.files and no capability-level paths. */
export function checkCacheNoTriggerFallback(reference: string): Finding[] {
  const views = cacheViews(reference);
  const out: Finding[] = [];
  for (const c of capsOf(reference)) {
    if (c.cacheFiles.length > 0 || c.capPaths.length > 0) continue;
    const v = views.get(c.id);
    if (v !== undefined && (v.gate !== "[]" || (v.gen !== "[]" && v.gen !== "")))
      out.push(f("h", "reference", c.id, "cache.files falls back to the paths of a trigger"));
  }
  return out;
}

/** R7: the capabilities whose command reaches `testFile`, and a verdict per engine. */
export function checkSkillBudgets(inp: PushInputs, testFile: string): Finding[] {
  const caps = capsOf(inp.reference);
  const hits = caps.filter((c) => closure(inp.tree, c.cmds).tests.includes(testFile));
  if (hits.length === 0)
    return [
      f(
        "r7",
        "reference",
        testFile,
        "no ci:<id> command reaches a task that runs the test (fail closed)",
      ),
    ];
  const out: Finding[] = [];
  const capIds = new Set(caps.map((c) => c.id));
  const jobFindings = checkJobConditions(inp);
  let gl: Doc | undefined;
  try {
    gl = loadDoc(inp, inp.gitlab);
  } catch {
    gl = undefined;
  }
  for (const c of hits) {
    // GitHub: the job of the capability, in a workflow whose push carries no filter, running on main.
    let found = false;
    for (const [file, text] of Object.entries(inp.workflows)) {
      let doc: Doc;
      try {
        doc = loadDoc(inp, text);
      } catch {
        continue;
      }
      const mine = jobsOf(text, doc, capIds).filter((j) => j.capability === c.id);
      if (mine.length === 0) continue;
      found = true;
      const callers = Object.entries(inp.workflows).filter(([, t]) =>
        t.includes(file.replace(/^.*\//, "")),
      );
      const roots = file.includes("/_ci-") ? callers : [[file, text] as [string, string]];
      let covered = false;
      for (const [rf, rt] of roots) {
        let p;
        try {
          p = readPush(loadDoc(inp, rt)["on"]);
        } catch {
          continue;
        }
        if (p !== null && p.refs.includes("main") && !p.paths && !p.pathsIgnore) covered = true;
      }
      if (!covered)
        out.push(
          f(
            "r7",
            "github",
            `${file} job '${mine[0]?.key}' (capability '${c.id}', runs ${testFile.replace(/^.*\//, "")})`,
            "is not run on every push to main: the push trigger of its workflow carries a path filter",
          ),
        );
      for (const j of jobFindings.filter((x) =>
        x.subject.includes(`${file} job '${mine[0]?.key}'`),
      ))
        out.push(f("r7", "github", j.subject, j.message));
    }
    if (!found)
      out.push(
        f(
          "r7",
          "github",
          c.id,
          `no workflow job is found for the capability that runs ${testFile} (fail closed)`,
        ),
      );
    // GitLab: the generated job of the same id.
    if (gl === undefined || !jobNames(gl).includes(c.id)) {
      out.push(
        f(
          "r7",
          "gitlab",
          c.id,
          `no generated job is found for the capability that runs ${testFile} (fail closed)`,
        ),
      );
      continue;
    }
    try {
      const r = jobOnPush(gl, c.id, pushVars("main"));
      if (!r.runs)
        out.push(
          f(
            "r7",
            "gitlab",
            c.id,
            `job '${c.id}' does not run unfiltered on a push to main: ${r.why}`,
          ),
        );
    } catch (e) {
      out.push(
        f("r7", "gitlab", c.id, `cannot be resolved (fail closed): ${(e as Error).message}`),
      );
    }
  }
  return out;
}
