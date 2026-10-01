// spec-status-derivation.ts — the spec 0109 delta-04 Requirement 23 rule: the
// status a merged spec or delta-spec truly carries on a branch B, determined
// from evidence (commit-graph reachability plus the forge's merged-PR record).
// CLI entry: scripts/derive-spec-status.ts. Every dependency (git, gh, the
// file system) is injected, so scripts/tests/derive-spec-status.test.ts drives
// `main()` against a real throwaway repository and a fake forge.
//
// Exit codes: 0 clean (or every candidate applied); 1 candidates remain under
// --check; 2 usage or wiring fault — a shallow clone, an incomplete merged-PR
// record, an unauthenticated or failing `gh`, a work tree that is not the
// branch being derived (v1-F4), or a file `--apply` cannot rewrite.

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface DeriveDeps {
  /** Run git in `cwd` (default: the derivation repository). */
  git: (args: readonly string[], cwd?: string) => RunResult;
  /** Run the GitHub CLI. */
  gh: (args: readonly string[]) => RunResult;
  readFile: (abs: string) => string | null;
  writeFile: (abs: string, content: string) => void;
  /** Absolute repository root of the derivation repository. */
  root: string;
  sleep: (ms: number) => void;
  out: (line: string) => void;
  err: (line: string) => void;
}

export type Status = "draft" | "approved" | "implemented" | "archived" | "superseded";
export type Scope = "draft-deltas" | "release-only";

export interface SpecFile {
  path: string;
  id: string;
  isDelta: boolean;
  relatedIssue: number | undefined;
  status: string | undefined;
}

export interface PrRecord {
  number: number;
  headRefName: string;
  baseRefName: string;
  mergeCommit: string | null;
  closingIssues: number[];
}

export interface IssueState {
  state: string;
  stateReason: string | null;
}

/** The graph and forge oracles the rule reads; the CLI backs them with git and gh. */
export interface Evidence {
  prs: readonly PrRecord[];
  /** M is reachable from B's head. */
  onBranch: (sha: string) => boolean;
  /** `ancestor` is an ancestor of (or equal to) `sha`. */
  descends: (ancestor: string, sha: string) => boolean;
  /** The ticket T a head branch resolves to under R20, read in the tree at M (PLAN S1). */
  ticketAt: (mergeCommit: string, nnnn: string) => number | undefined;
  issue: (n: number) => IssueState;
}

export interface Determination {
  status: "implemented" | "archived" | "approved";
  /** The implementation PRs for N on B that descend from C_D. */
  implementing: PrRecord[];
  /** Ambiguity reason (R23), recorded `approved`; `null` when unambiguous. */
  ambiguity: string | null;
  /** Human-readable evidence for the correction PR body. */
  evidence: string;
}

const IMPL_BRANCH = /^(?:feat|fix|refactor|perf|chore)\/(\d{4})-/;
const SYNC_BRANCH = /^chore\/\d{4}-sync-main/;

/** The `<NNNN>` of an implementation-form branch (spec 0168 R2 / 0109 delta-04 R20), else `undefined`. */
export function implBranchNumber(head: string): string | undefined {
  return IMPL_BRANCH.exec(head)?.[1];
}

/** A sync of `main` into a release branch (R21). */
export function isSyncBranch(head: string): boolean {
  return SYNC_BRANCH.test(head);
}

/**
 * R20 ticket resolution: a non-delta spec with id `<NNNN>` in the tree makes T
 * that spec's `related-issue`; otherwise T is `<NNNN>` read as an integer.
 */
export function resolveTicket(
  nnnn: string,
  specRelatedIssue: number | undefined | null,
  specExists: boolean,
): number | undefined {
  if (specExists) return specRelatedIssue ?? undefined;
  return Number.parseInt(nnnn, 10);
}

/** Frontmatter fields of a spec file (only the ones the rule reads). */
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return {};
  const fm: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    if (line.trim() === "---") return fm;
    const m = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (m?.[1] !== undefined) fm[m[1]] = unquote(m[2] ?? "");
  }
  return {};
}

function unquote(v: string): string {
  const m = /^(["'])(.*)\1$/.exec(v);
  return m?.[2] ?? v;
}

const SPEC_FILE = /^specs\/(\d{4})-[^/]*\.md$/;
const DELTA_FILE = /\.delta-\d+\.md$/;

/** True for a spec or delta-spec path under specs/. */
export function isSpecPath(rel: string): boolean {
  return SPEC_FILE.test(rel);
}

export function toSpecFile(rel: string, text: string): SpecFile {
  const fm = parseFrontmatter(text);
  const ri = fm["related-issue"];
  return {
    path: rel,
    id: SPEC_FILE.exec(rel)?.[1] ?? "",
    isDelta: DELTA_FILE.test(rel),
    relatedIssue: ri !== undefined && /^\d+$/.test(ri) ? Number.parseInt(ri, 10) : undefined,
    status: fm.status,
  };
}

/** Candidate implementation PRs for N on B (R23), before the C_D descent test. */
export function implementationPrs(n: number, ev: Evidence): PrRecord[] {
  return ev.prs.filter((pr) => {
    if (pr.mergeCommit === null || !ev.onBranch(pr.mergeCommit)) return false;
    if (pr.headRefName.startsWith("spec/") || isSyncBranch(pr.headRefName)) return false;
    if (pr.closingIssues.includes(n)) return true;
    const nnnn = implBranchNumber(pr.headRefName);
    return nnnn !== undefined && ev.ticketAt(pr.mergeCommit, nnnn) === n;
  });
}

const list = (prs: readonly PrRecord[]): string => prs.map((p) => `#${p.number}`).join(", ");

/** R23: implemented, else archived, else approved — never more than the evidence shows. */
export function determine(n: number, cD: string, ev: Evidence): Determination {
  const candidates = implementationPrs(n, ev);
  const implementing = candidates.filter((pr) => ev.descends(cD, pr.mergeCommit ?? ""));
  if (implementing.length > 0)
    return { status: "implemented", implementing, ambiguity: null, evidence: list(implementing) };
  const issue = ev.issue(n);
  const closed = issue.state.toUpperCase() === "CLOSED";
  const reason = (issue.stateReason ?? "").toUpperCase();
  if (closed && (reason === "NOT_PLANNED" || reason === "DUPLICATE"))
    return {
      status: "archived",
      implementing: [],
      ambiguity: null,
      evidence: `issue #${n} closed as ${reason.toLowerCase().replace("_", " ")}`,
    };
  if (candidates.length > 0) {
    const verb = candidates.length === 1 ? "precedes or parallels" : "precede or parallel";
    const why = `${list(candidates)} ${verb} the delta`;
    return { status: "approved", implementing: [], ambiguity: why, evidence: why };
  }
  if (closed) {
    const why = `issue #${n} closed as completed, no implementation PR found`;
    return { status: "approved", implementing: [], ambiguity: why, evidence: why };
  }
  return {
    status: "approved",
    implementing: [],
    ambiguity: null,
    evidence: `issue #${n} open, no implementation PR found`,
  };
}

const RANK: Record<string, number> = { draft: 0, approved: 1, implemented: 2, archived: 2 };

/** True when `recorded` ranks below `determined` (`draft < approved < implemented|archived`). */
export function ranksBelow(recorded: string | undefined, determined: string): boolean {
  const r = recorded === undefined ? undefined : RANK[recorded];
  const d = RANK[determined];
  return r !== undefined && d !== undefined && r < d;
}

/**
 * Rewrite the frontmatter `status:` line only, preserving its quoting.
 * Returns `null` when the frontmatter has no `status:` line.
 */
export function rewriteStatus(text: string, to: string): string | null {
  const lines = text.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") return null;
    const m = /^(status:\s*)(["']?)([^"'\s]*)\2(\s*\r?)$/.exec(line);
    if (m !== null) {
      lines[i] = `${m[1] ?? ""}${m[2] ?? ""}${to}${m[2] ?? ""}${m[4] ?? ""}`;
      return lines.join("\n");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLI orchestration
// ---------------------------------------------------------------------------

export class WiringFault extends Error {}

export const USAGE = `usage: derive-spec-status.ts --branch <ref> --scope draft-deltas|release-only
         [--main-ref <ref>] [--repo <owner/name>] [--format md|tsv]
         [--apply [--worktree <dir>]] [--check]

  --branch    the branch B whose specs are derived (e.g. HEAD, crewrig/release/1231-ts-migration)
  --main-ref  the default-branch ref for --scope release-only (default: <remote>/main)
  --scope     draft-deltas: every delta-spec on B recorded 'draft' (R24)
              release-only: every spec or delta-spec on B recorded below its
              determined status, where the determination depends on a commit
              not reachable from --main-ref (R25)
  --apply     rewrite each candidate's 'status:' line in the work tree of
              --worktree (default: this repository's work tree). That work
              tree's HEAD must be the commit --branch names, else exit 2.
  --check     exit 1 when candidates remain (ignored with --apply)

Exit codes: 0 clean or applied, 1 candidates remain under --check, 2 usage or wiring fault.`;

export interface Options {
  branch: string;
  mainRef: string | undefined;
  scope: Scope;
  repo: string | undefined;
  format: "md" | "tsv";
  apply: boolean;
  worktree: string | undefined;
  check: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const o: Partial<Options> = { format: "md", apply: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const val = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new WiringFault(`${a} needs a value`);
      return v;
    };
    if (a === "--branch") o.branch = val();
    else if (a === "--main-ref") o.mainRef = val();
    else if (a === "--repo") o.repo = val();
    else if (a === "--worktree") o.worktree = val();
    else if (a === "--apply") o.apply = true;
    else if (a === "--check") o.check = true;
    else if (a === "--scope") {
      const v = val();
      if (v !== "draft-deltas" && v !== "release-only")
        throw new WiringFault(`unknown --scope '${v}'`);
      o.scope = v;
    } else if (a === "--format") {
      const v = val();
      if (v !== "md" && v !== "tsv") throw new WiringFault(`unknown --format '${v}'`);
      o.format = v;
    } else throw new WiringFault(`unknown argument '${a}'`);
  }
  if (o.branch === undefined) throw new WiringFault("--branch is required");
  if (o.scope === undefined) throw new WiringFault("--scope is required");
  if (o.worktree !== undefined && o.apply !== true)
    throw new WiringFault("--worktree is only meaningful with --apply");
  return o as Options;
}

export interface Row {
  file: SpecFile;
  determined: Determination;
}

class Deriver {
  readonly d: DeriveDeps;
  readonly o: Options;
  readonly branchSha: string;
  private mainRefCache: string | undefined;
  private branchSet = new Set<string>();
  private mainSet: Set<string> | undefined;
  private ticketCache = new Map<string, number | undefined>();
  private issueCache = new Map<number, IssueState>();
  prs: PrRecord[] = [];

  constructor(d: DeriveDeps, o: Options) {
    this.d = d;
    this.o = o;
    this.branchSha = this.rev(o.branch);
  }

  /** `--main-ref`, else `<preferred remote>/main`; resolved only when a scope needs it. */
  get mainRef(): string {
    this.mainRefCache ??= this.o.mainRef ?? `${this.preferredRemote()}/main`;
    return this.mainRefCache;
  }

  git(args: readonly string[], what: string): string {
    const r = this.d.git(args);
    if (r.status !== 0) throw new WiringFault(`git ${what} failed: ${r.stderr.trim()}`);
    return r.stdout;
  }

  rev(ref: string): string {
    return this.git(
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      `rev-parse ${ref}`,
    ).trim();
  }

  preferredRemote(): string {
    const remotes = this.git(["remote"], "remote")
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r !== "");
    const r = remotes.find((x) => /crewrig|origin/.test(x)) ?? remotes[0];
    if (r === undefined) throw new WiringFault("no git remote; pass --main-ref and --repo");
    return r;
  }

  revList(ref: string): Set<string> {
    return new Set(
      this.git(["rev-list", ref], `rev-list ${ref}`)
        .split("\n")
        .filter((s) => s !== ""),
    );
  }

  guardShallow(): void {
    if (this.git(["rev-parse", "--is-shallow-repository"], "rev-parse").trim() === "true")
      throw new WiringFault(
        "shallow clone: R23 reachability needs full history (git fetch --unshallow)",
      );
  }

  repo(): string {
    if (this.o.repo !== undefined) return this.o.repo;
    const remote =
      this.o.mainRef === undefined ? this.preferredRemote() : (this.o.mainRef.split("/")[0] ?? "");
    const url = this.git(["remote", "get-url", remote], `remote get-url ${remote}`).trim();
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
    if (m === null) throw new WiringFault(`cannot read owner/name from '${url}'; pass --repo`);
    return `${m[1]}/${m[2]}`;
  }

  gh(args: readonly string[], what: string): string {
    const r = this.d.gh(args);
    if (r.status !== 0) throw new WiringFault(`gh ${what} failed: ${r.stderr.trim()}`);
    return r.stdout;
  }

  /** The merged-PR record, fail-closed against GraphQL totalCount (v1-F6), with one retry. */
  loadPrs(repo: string): void {
    const [owner, name] = repo.split("/");
    for (let attempt = 0; ; attempt++) {
      const raw = JSON.parse(
        this.gh(
          [
            "pr",
            "list",
            "--repo",
            repo,
            "--state",
            "merged",
            "--limit",
            "5000",
            "--json",
            "number,headRefName,baseRefName,mergeCommit,closingIssuesReferences",
          ],
          "pr list",
        ),
      ) as {
        number: number;
        headRefName: string;
        baseRefName: string;
        mergeCommit: { oid: string } | null;
        closingIssuesReferences: { number: number }[] | null;
      }[];
      const total = Number(
        this.gh(
          [
            "api",
            "graphql",
            "-f",
            "query=query($o:String!,$n:String!){repository(owner:$o,name:$n){pullRequests(states:MERGED){totalCount}}}",
            "-f",
            `o=${owner ?? ""}`,
            "-f",
            `n=${name ?? ""}`,
            "--jq",
            ".data.repository.pullRequests.totalCount",
          ],
          "api graphql",
        ).trim(),
      );
      if (raw.length === total) {
        this.prs = raw.map((p) => ({
          number: p.number,
          headRefName: p.headRefName,
          baseRefName: p.baseRefName,
          mergeCommit: p.mergeCommit?.oid ?? null,
          closingIssues: (p.closingIssuesReferences ?? []).map((c) => c.number),
        }));
        return;
      }
      if (attempt >= 1)
        throw new WiringFault(
          `incomplete merged-PR record: gh pr list returned ${raw.length}, GraphQL totalCount is ${total}`,
        );
      this.d.sleep(5000);
    }
  }

  issue(n: number): IssueState {
    const hit = this.issueCache.get(n);
    if (hit !== undefined) return hit;
    const s = JSON.parse(
      this.gh(
        ["issue", "view", String(n), "--repo", this.repo(), "--json", "state,stateReason"],
        `issue view ${n}`,
      ),
    ) as { state: string; stateReason: string | null };
    const v = { state: s.state, stateReason: s.stateReason || null };
    this.issueCache.set(n, v);
    return v;
  }

  /** T for an implementation-form head, resolved in the tree at its merge commit (PLAN S1). */
  ticketAt(m: string, nnnn: string): number | undefined {
    const key = `${m}:${nnnn}`;
    if (this.ticketCache.has(key)) return this.ticketCache.get(key);
    const spec = this.git(["ls-tree", "--name-only", m, "specs/"], `ls-tree ${m}`)
      .split("\n")
      .find((p) => p.startsWith(`specs/${nnnn}-`) && p.endsWith(".md") && !DELTA_FILE.test(p));
    let t: number | undefined;
    if (spec === undefined) t = resolveTicket(nnnn, undefined, false);
    else {
      const text = this.git(["show", `${m}:${spec}`], `show ${m}:${spec}`);
      t = resolveTicket(nnnn, toSpecFile(spec, text).relatedIssue, true);
    }
    this.ticketCache.set(key, t);
    return t;
  }

  specsAt(sha: string): SpecFile[] {
    return this.git(["ls-tree", "--name-only", sha, "specs/"], `ls-tree ${sha}`)
      .split("\n")
      .filter(isSpecPath)
      .map((p) => toSpecFile(p, this.git(["show", `${sha}:${p}`], `show ${p}`)));
  }

  introducedBy(rel: string): string {
    const c = this.git(
      ["log", "--diff-filter=A", "--format=%H", "-1", this.branchSha, "--", rel],
      `log ${rel}`,
    ).trim();
    if (c === "") throw new WiringFault(`no commit introduces ${rel} on ${this.o.branch}`);
    return c;
  }

  presentOnMain(rel: string): boolean {
    return this.d.git(["cat-file", "-e", `${this.mainRef}:${rel}`]).status === 0;
  }

  onMain(sha: string): boolean {
    this.mainSet ??= this.revList(this.mainRef);
    return this.mainSet.has(sha);
  }

  run(): Row[] {
    this.guardShallow();
    if (this.o.scope === "release-only") this.rev(this.mainRef);
    this.branchSet = this.revList(this.branchSha);
    this.loadPrs(this.repo());
    const ev: Evidence = {
      prs: this.prs,
      onBranch: (sha) => this.branchSet.has(sha),
      descends: (a, sha) => this.d.git(["merge-base", "--is-ancestor", a, sha]).status === 0,
      ticketAt: (m, nnnn) => this.ticketAt(m, nnnn),
      issue: (n) => this.issue(n),
    };
    const rows: Row[] = [];
    for (const f of this.specsAt(this.branchSha)) {
      if (f.status === "superseded") continue;
      if (this.o.scope === "draft-deltas" && !(f.isDelta && f.status === "draft")) continue;
      if (f.relatedIssue === undefined) {
        this.d.err(`[SKIP] ${f.path}: no integer related-issue`);
        continue;
      }
      if (this.o.scope === "release-only" && !(f.status === "draft" || f.status === "approved"))
        continue;
      const det = determine(f.relatedIssue, this.introducedBy(f.path), ev);
      if (!ranksBelow(f.status, det.status)) continue;
      if (this.o.scope === "release-only") {
        const onMainToo =
          this.presentOnMain(f.path) &&
          (det.status !== "implemented" ||
            det.implementing.some((p) => p.mergeCommit !== null && this.onMain(p.mergeCommit)));
        if (onMainToo) continue;
      }
      rows.push({ file: f, determined: det });
    }
    return rows;
  }

  apply(rows: readonly Row[]): void {
    const dir = this.o.worktree ?? this.d.root;
    const head = this.d.git(["rev-parse", "HEAD"], dir);
    if (head.status !== 0) throw new WiringFault(`'${dir}' is not a git work tree`);
    if (head.stdout.trim() !== this.branchSha)
      throw new WiringFault(
        `work tree '${dir}' is at ${head.stdout.trim().slice(0, 12)}, not at --branch ${this.o.branch} (${this.branchSha.slice(0, 12)})`,
      );
    const writes: [string, string][] = [];
    for (const r of rows) {
      const abs = `${dir.replace(/\/$/, "")}/${r.file.path}`;
      const current = this.d.readFile(abs);
      const atBranch = this.git(
        ["show", `${this.branchSha}:${r.file.path}`],
        `show ${r.file.path}`,
      );
      if (current === null) throw new WiringFault(`${r.file.path} is absent from '${dir}'`);
      if (current !== atBranch)
        throw new WiringFault(
          `${r.file.path} differs from ${this.o.branch} in '${dir}'; commit or discard first`,
        );
      const next = rewriteStatus(current, r.determined.status);
      if (next === null) throw new WiringFault(`${r.file.path} has no frontmatter 'status:' line`);
      writes.push([abs, next]);
    }
    for (const [abs, next] of writes) this.d.writeFile(abs, next);
  }
}

function render(rows: readonly Row[], prs: readonly PrRecord[], format: "md" | "tsv"): string[] {
  const base = (n: string): string => {
    const pr = prs.find((p) => `#${p.number}` === n);
    return pr === undefined ? n : `${n} (${pr.baseRefName})`;
  };
  const evidence = (d: Determination): string =>
    d.status === "implemented"
      ? d.implementing.map((p) => base(`#${p.number}`)).join(", ")
      : d.evidence;
  const cells = rows.map((r) => [
    r.file.path,
    String(r.file.relatedIssue ?? ""),
    r.file.status ?? "",
    r.determined.status,
    evidence(r.determined),
    r.determined.ambiguity === null ? "" : `ambiguous: ${r.determined.ambiguity}`,
  ]);
  const head = ["File", "related-issue", "Recorded", "Determined", "Evidence", "Ambiguity"];
  if (format === "tsv") return [head, ...cells].map((c) => c.join("\t"));
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...cells.map(
      (c) =>
        `| \`${c[0]}\` | ${c
          .slice(1, 3)
          .map((x) => `\`${x}\``)
          .join(" | ")} | \`${c[3]}\` | ${c[4]} | ${c[5]} |`,
    ),
  ];
}

export function main(argv: readonly string[], deps: DeriveDeps): number {
  let o: Options;
  try {
    o = parseArgs(argv);
  } catch (e) {
    deps.err(`derive-spec-status: ${(e as Error).message}`);
    deps.err(USAGE);
    return 2;
  }
  try {
    const dv = new Deriver(deps, o);
    const rows = dv.run();
    for (const line of render(rows, dv.prs, o.format)) deps.out(line);
    const ambiguous = rows.filter((r) => r.determined.ambiguity !== null).length;
    deps.err(
      `derive-spec-status: ${o.scope} on ${o.branch} (${dv.branchSha.slice(0, 12)}): ${rows.length} candidate(s), ${ambiguous} ambiguous`,
    );
    if (o.apply) {
      dv.apply(rows);
      deps.err(
        `derive-spec-status: applied ${rows.length} status correction(s) in ${o.worktree ?? deps.root}`,
      );
      return 0;
    }
    return o.check && rows.length > 0 ? 1 : 0;
  } catch (e) {
    if (e instanceof WiringFault || e instanceof SyntaxError) {
      deps.err(`derive-spec-status: wiring fault: ${e.message}`);
      return 2;
    }
    throw e;
  }
}
