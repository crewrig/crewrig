// derive-spec-status.test.ts — the spec 0109 delta-04 R23 derivation end to
// end: `main(argv, deps)` against a real throwaway git repository (a `main`
// and a `release` line) and an in-process fake `gh` (merged-PR list, GraphQL
// totalCount, issue state). Cases D1–D10 of PLAN v1 *Test strategy*, plus the
// v1-F4 work-tree guard and the v1-F6 GraphQL count with one retry.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/derive-spec-status.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { DeriveDeps, RunResult } from "../lib/spec-status-derivation.ts";
import {
  implBranchNumber,
  isSyncBranch,
  main,
  ranksBelow,
  rewriteStatus,
} from "../lib/spec-status-derivation.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "derive-spec-status-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

function sh(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function spec(related: number, status = "draft", quote = ""): string {
  return `---\nid: "0000"\nslug: x\nstatus: ${quote}${status}${quote}\ncomplexity: small\nrelated-issue: ${related}\nversion: 1.0.0\n---\n\n# body\n`;
}

interface Pr {
  number: number;
  headRefName: string;
  baseRefName: string;
  mergeCommit: { oid: string } | null;
  closingIssuesReferences: { number: number }[];
}

class Repo {
  readonly dir: string;
  readonly prs: Pr[] = [];
  readonly issues = new Map<number, { state: string; stateReason: string | null }>();
  /** GraphQL totalCount answers, consumed in order; the last one repeats. */
  totals: number[] | undefined;
  sleeps = 0;
  private n = 0;
  constructor(name: string) {
    this.dir = path.join(TMP, name);
    mkdirSync(this.dir);
    sh(this.dir, "init", "-q", "-b", "main");
    sh(this.dir, "config", "user.email", "t@example.invalid");
    sh(this.dir, "config", "user.name", "t");
    sh(this.dir, "config", "commit.gpgsign", "false");
    this.commit("init", { "README.md": "x\n" });
  }
  commit(msg: string, files: Record<string, string>): string {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(this.dir, rel)), { recursive: true });
      writeFileSync(path.join(this.dir, rel), body);
      sh(this.dir, "add", rel);
    }
    sh(this.dir, "commit", "-q", "--allow-empty", "-m", msg);
    return sh(this.dir, "rev-parse", "HEAD");
  }
  /** A squash-merged PR: one commit on the current branch, recorded as merged. */
  pr(head: string, files: Record<string, string>, closes: number[] = [], base = "main"): number {
    const number = ++this.n;
    const oid = this.commit(`PR #${number} ${head}`, files);
    this.prs.push({
      number,
      headRefName: head,
      baseRefName: base,
      mergeCommit: { oid },
      closingIssuesReferences: closes.map((c) => ({ number: c })),
    });
    return number;
  }
  checkout(...args: string[]): void {
    sh(this.dir, "checkout", "-q", ...args);
  }
  gh = (args: readonly string[]): RunResult => {
    const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: "" });
    if (args[0] === "pr" && args[1] === "list") return ok(JSON.stringify(this.prs));
    if (args[0] === "api" && args[1] === "graphql") {
      const t =
        this.totals === undefined ? this.prs.length : (this.totals.shift() ?? this.prs.length);
      if (this.totals !== undefined && this.totals.length === 0) this.totals.push(t);
      return ok(`${t}\n`);
    }
    if (args[0] === "issue" && args[1] === "view") {
      const s = this.issues.get(Number(args[2])) ?? { state: "OPEN", stateReason: null };
      return ok(JSON.stringify(s));
    }
    return { status: 1, stdout: "", stderr: `fake gh: unexpected ${args.join(" ")}` };
  };
  derive(argv: string[], root = this.dir): { code: number; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const deps: DeriveDeps = {
      git: (a, cwd) => {
        const r = spawnSync("git", ["-C", cwd ?? root, ...a], { encoding: "utf8" });
        return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      },
      gh: this.gh,
      readFile: (abs) => {
        try {
          return readFileSync(abs, "utf8");
        } catch {
          return null;
        }
      },
      writeFile: (abs, c) => writeFileSync(abs, c),
      root,
      sleep: () => void this.sleeps++,
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    };
    return { code: main([...argv, "--repo", "o/n", "--format", "tsv"], deps), out, err };
  }
}

/** Determined status per file from a tsv run. */
function table(r: { out: string[] }): Map<string, string[]> {
  return new Map(
    r.out.slice(1).map((l) => {
      const c = l.split("\t");
      return [c[0] ?? "", c.slice(1)];
    }),
  );
}

const D = (id: string, n: number): string => `specs/${id}-x.delta-${String(n).padStart(2, "0")}.md`;

// One shared history covering D1–D8.
const r = new Repo("shared");
r.commit("parents", {
  "specs/0050-x.md": spec(50, "implemented"),
  "specs/0070-x.md": spec(1700, "approved"),
});
// D4: an implementation that precedes its delta.
r.pr("feat/1800-early", { "src/d4": "1" });
r.pr("spec/0050-x-delta-01", { [D("0050", 1)]: spec(60) }); // D1
r.pr("spec/0050-x-delta-02", { [D("0050", 2)]: spec(1500) }); // D2
r.pr("spec/0070-x-delta-01", { [D("0070", 1)]: spec(1700) }); // D3
r.pr("spec/0050-x-delta-03", { [D("0050", 3)]: spec(70) }); // D3 negative: issue #70 ≠ spec 0070
r.pr("spec/0050-x-delta-04", { [D("0050", 4)]: spec(1800) }); // D4
r.pr("spec/0050-x-delta-05", { [D("0050", 5)]: spec(1900) }); // D5 completed, no PR
r.pr("spec/0050-x-delta-06", { [D("0050", 6)]: spec(1901) }); // D5 not planned
r.pr("spec/0050-x-delta-07", { [D("0050", 7)]: spec(1902) }); // D5 implementation beats archived
r.pr("spec/0050-x-delta-08", { [D("0050", 8)]: spec(2100) }); // D8
r.pr("spec/0050-x-delta-09", { [D("0050", 9)]: spec(2200) }); // D7: implemented on release only
r.pr("docs/60-closing-ref", { "src/d1": "1" }, [60]); // D1
r.pr("feat/1500-ticket-branch", { "src/d2": "1" }); // D2
r.pr("feat/0070-spec-id-branch", { "src/d3": "1" }); // D3
r.pr("feat/1902-late", { "src/d5": "1" }); // D5
r.pr("spec/0050-x-delta-10", { "src/d8a": "1" }, [2100]); // D8: a spec/ head never counts
r.pr("chore/2100-sync-main-20261001", { "src/d8b": "1" }); // D8: a sync head never counts
r.issues.set(1900, { state: "CLOSED", stateReason: "COMPLETED" });
r.issues.set(1901, { state: "CLOSED", stateReason: "NOT_PLANNED" });
r.issues.set(1902, { state: "CLOSED", stateReason: "NOT_PLANNED" });
r.checkout("-b", "release");
r.pr("feat/2200-release-row", { "src/d7": "1" }, [], "release"); // D7
r.pr("spec/0300-rel", { "specs/0300-rel.md": spec(2300, "approved") }, [], "release");
r.pr("feat/2300-rel-impl", { "src/rel": "1" }, [], "release");
r.checkout("main");

describe("R23 rule on main (draft-deltas)", () => {
  const res = r.derive(["--branch", "main", "--scope", "draft-deltas"]);
  const t = table(res);
  test("exits 0 without --check", () => assert.equal(res.code, 0, res.err.join("\n")));
  test("D1 a closing reference implements", () => {
    assert.equal(t.get(D("0050", 1))?.[2], "implemented");
    assert.match(t.get(D("0050", 1))?.[3] ?? "", /#12 \(main\)/);
  });
  test("D2 a ticket-numbered branch implements", () =>
    assert.equal(t.get(D("0050", 2))?.[2], "implemented"));
  test("D3 a spec-id branch resolves through the spec's related-issue at M", () => {
    assert.equal(t.get(D("0070", 1))?.[2], "implemented");
    assert.equal(t.get(D("0050", 3))?.[2], "approved", "feat/0070 must not count for issue #70");
  });
  test("D4 an implementation preceding C_D gives approved, flagged ambiguous", () => {
    assert.equal(t.get(D("0050", 4))?.[2], "approved");
    assert.match(t.get(D("0050", 4))?.[4] ?? "", /ambiguous: #1 precedes or parallels the delta/);
  });
  test("D5 closed as completed with no PR is approved and ambiguous; not planned is archived", () => {
    assert.equal(t.get(D("0050", 5))?.[2], "approved");
    assert.match(t.get(D("0050", 5))?.[4] ?? "", /ambiguous: issue #1900 closed as completed/);
    assert.equal(t.get(D("0050", 6))?.[2], "archived");
    assert.equal(t.get(D("0050", 6))?.[4], "");
  });
  test("D5 a reachable implementation beats archived", () =>
    assert.equal(t.get(D("0050", 7))?.[2], "implemented"));
  test("D8 spec/ and chore/NNNN-sync-main* heads are not implementation evidence", () =>
    assert.equal(t.get(D("0050", 8))?.[2], "approved"));
  test("D7 a release-only implementation does not count on main", () =>
    assert.equal(t.get(D("0050", 9))?.[2], "approved"));
  test("non-delta specs are out of the draft-deltas scope", () =>
    assert.equal(t.has("specs/0070-x.md"), false));
  test("--check exits 1 while candidates remain", () =>
    assert.equal(r.derive(["--branch", "main", "--scope", "draft-deltas", "--check"]).code, 1));
});

describe("R23 rule on the release line", () => {
  test("D6 an implementation merged into main counts on release through reachability", () => {
    const t = table(r.derive(["--branch", "release", "--scope", "draft-deltas"]));
    assert.equal(t.get(D("0050", 1))?.[2], "implemented");
    assert.equal(t.get(D("0050", 9))?.[2], "implemented", "D7 counts on its own line");
  });
  test("release-only keeps only determinations that depend on release-only commits (R25)", () => {
    const res = r.derive(["--branch", "release", "--main-ref", "main", "--scope", "release-only"]);
    assert.equal(res.code, 0, res.err.join("\n"));
    assert.deepEqual([...table(res).keys()].sort(), [D("0050", 9), "specs/0300-rel.md"]);
    assert.equal(table(res).get("specs/0300-rel.md")?.[2], "implemented");
  });
});

describe("D9 merges never regress implemented", () => {
  const m = new Repo("merge");
  m.pr("spec/0050-x-delta-01", { [D("0050", 1)]: spec(3000) });
  m.checkout("-b", "side");
  m.pr("feat/3000-impl", { "src/a": "1" });
  m.checkout("main");
  m.commit("parallel work on main", { "src/b": "1" });
  test("before the merge, main determines approved", () =>
    assert.equal(
      table(m.derive(["--branch", "main", "--scope", "draft-deltas"])).get(D("0050", 1))?.[2],
      "approved",
    ));
  test("the merge result keeps implemented", () => {
    sh(m.dir, "merge", "-q", "--no-ff", "-m", "merge side", "side");
    assert.equal(
      table(m.derive(["--branch", "main", "--scope", "draft-deltas"])).get(D("0050", 1))?.[2],
      "implemented",
    );
  });
});

describe("D10 --apply and wiring faults", () => {
  test("--apply rewrites exactly the status line, preserving quoting", () => {
    const a = new Repo("apply");
    a.pr("spec/0050-x-delta-01", { [D("0050", 1)]: spec(4000, "draft", '"') });
    a.pr("feat/4000-impl", { "src/a": "1" });
    const res = a.derive(["--branch", "HEAD", "--scope", "draft-deltas", "--apply"]);
    assert.equal(res.code, 0, res.err.join("\n"));
    const diff = sh(a.dir, "diff", "-U0", "--no-color")
      .split("\n")
      .filter((l) => /^[-+][^-+]/.test(l));
    assert.deepEqual(diff, ['-status: "draft"', '+status: "implemented"']);
    assert.equal(
      a.derive(["--branch", "HEAD", "--scope", "draft-deltas", "--check"]).code,
      1,
      "evidence is the commit, not the work tree",
    );
    sh(a.dir, "commit", "-qam", "correct");
    assert.equal(a.derive(["--branch", "HEAD", "--scope", "draft-deltas", "--check"]).code, 0);
  });

  test("v1-F4 --apply refuses a work tree whose HEAD is not --branch", () => {
    const res = r.derive(["--branch", "release", "--scope", "draft-deltas", "--apply"]);
    assert.equal(res.code, 2);
    assert.match(res.err.join("\n"), /work tree .* not at --branch release/);
    assert.equal(sh(r.dir, "status", "--porcelain"), "", "nothing written");
  });

  test("v1-F4 --apply --worktree writes into the named work tree when its HEAD matches", () => {
    const wt = path.join(TMP, "release-wt");
    sh(r.dir, "worktree", "add", "-q", "--detach", wt, "release");
    const res = r.derive([
      "--branch",
      "release",
      "--main-ref",
      "main",
      "--scope",
      "release-only",
      "--apply",
      "--worktree",
      wt,
    ]);
    assert.equal(res.code, 0, res.err.join("\n"));
    assert.deepEqual(sh(wt, "diff", "--name-only").split("\n").sort(), [
      D("0050", 9),
      "specs/0300-rel.md",
    ]);
    assert.equal(sh(r.dir, "status", "--porcelain"), "", "the derivation repository is untouched");
  });

  test("--apply refuses a candidate edited in the work tree", () => {
    const a = new Repo("dirty");
    a.pr("spec/0050-x-delta-01", { [D("0050", 1)]: spec(4100) });
    writeFileSync(path.join(a.dir, D("0050", 1)), spec(4100) + "edit\n");
    const res = a.derive(["--branch", "HEAD", "--scope", "draft-deltas", "--apply"]);
    assert.equal(res.code, 2);
    assert.match(res.err.join("\n"), /differs from HEAD/);
  });

  test("v1-F6 a lagging GraphQL count is retried once, then accepted", () => {
    r.totals = [r.prs.length - 1, r.prs.length];
    r.sleeps = 0;
    assert.equal(r.derive(["--branch", "main", "--scope", "draft-deltas"]).code, 0);
    assert.equal(r.sleeps, 1);
  });

  test("v1-F6 a persistent count mismatch fails closed with exit 2", () => {
    r.totals = [r.prs.length + 1];
    r.sleeps = 0;
    const res = r.derive(["--branch", "main", "--scope", "draft-deltas"]);
    r.totals = undefined;
    assert.equal(res.code, 2);
    assert.match(res.err.join("\n"), /incomplete merged-PR record/);
    assert.equal(r.sleeps, 1);
  });

  test("a shallow clone is a wiring fault", () => {
    const clone = path.join(TMP, "shallow");
    spawnSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, clone]);
    const res = r.derive(["--branch", "HEAD", "--scope", "draft-deltas"], clone);
    assert.equal(res.code, 2);
    assert.match(res.err.join("\n"), /shallow clone/);
  });

  test("a failing gh is a wiring fault", () => {
    const a = new Repo("nogh");
    a.gh = () => ({ status: 4, stdout: "", stderr: "gh auth login required" });
    const res = a.derive(["--branch", "HEAD", "--scope", "draft-deltas"]);
    assert.equal(res.code, 2);
    assert.match(res.err.join("\n"), /gh auth login required/);
  });

  test("usage errors exit 2", () => {
    assert.equal(r.derive(["--scope", "draft-deltas"]).code, 2);
    assert.equal(r.derive(["--branch", "HEAD", "--scope", "everything"]).code, 2);
    assert.equal(
      r.derive(["--branch", "HEAD", "--scope", "draft-deltas", "--worktree", "x"]).code,
      2,
    );
  });
});

describe("pure helpers", () => {
  test("implementation-form and sync heads", () => {
    assert.equal(implBranchNumber("feat/1392-agy"), "1392");
    assert.equal(implBranchNumber("docs/1441-x"), undefined);
    assert.equal(implBranchNumber("fix/193-unpadded"), undefined);
    assert.equal(isSyncBranch("chore/1231-sync-main-into-release-2"), true);
    assert.equal(isSyncBranch("feat/1500-sync-main-cleanup"), false);
  });
  test("rank order", () => {
    assert.equal(ranksBelow("draft", "approved"), true);
    assert.equal(ranksBelow("approved", "approved"), false);
    assert.equal(ranksBelow("approved", "archived"), true);
    assert.equal(ranksBelow("superseded", "implemented"), false);
  });
  test("rewriteStatus refuses a frontmatter without status", () =>
    assert.equal(rewriteStatus("---\nid: 1\n---\nstatus: draft\n", "approved"), null));
});
