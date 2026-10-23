// ci-pre-push-replay.test.ts — mutation-style replay of the build.yml failure classes (spec 0279 R17a).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ci-pre-push-replay.test.ts
// Exit: 0 every row behaves as stated, non-zero otherwise (node:test).
// Finding format: node:test assertion messages naming the row, the exit status and the output.
//
// One mkdtemp copy of the checkout (tracked and staged-or-untracked non-ignored files, working-tree
// content) gets `git init`, a base commit on `main` and a symlinked node_modules; HOME and
// GIT_CONFIG_GLOBAL live in a second mkdtemp directory. Per failure class, a minimal violation is
// committed on a throwaway branch of the copy, then (a) `selectForShas` must SELECT the capability for
// that changeset and (b) `task ci:<id>` alone must exit non-zero with a class-specific marker. The
// control row runs the REAL wrapper once end to end on a benign change (exit 0), so a broken copy
// cannot make a row pass vacuously (plan v2-F4). Every git call uses cwd = the copy, checked to be
// inside the mkdtemp root first; nothing outside it is touched.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { selectForShas } from "../lib/ci-pre-push/select.ts";
import { taskEnv } from "../lib/ci-pre-push/run.ts";
import { git, gitEnv, initRepo, writeRel } from "./lib/governance-git-fixture.ts";
import { REPO, makeSandbox, runEntry, stageNodeModules } from "./lib/governance-sandbox.ts";

interface Row {
  /** Failure class, as analysed on #1761. */
  readonly name: string;
  /** Fast-tier capability id that must be selected and must fail. */
  readonly id: string;
  /** Class-specific marker from the failing tool's own output. */
  readonly marker: RegExp;
  /** Minimal violation, written into the copy. */
  readonly mutate: (copy: string) => void;
  readonly todo?: string;
}

/**
 * A row detects only when the checker's own finding is in the output. A missing tool (markdownlint,
 * oxfmt, oxlint, tsc, js-yaml) also exits non-zero, so it must never count: exit 127 and the
 * not-found messages fail the row outright, whatever the marker says.
 */
const MISSING_TOOL =
  /executable file not found|command not found|is not installed|ERR_MODULE_NOT_FOUND/;
function assertDetected(row: Row, status: number | null, out: string): void {
  assert.notEqual(
    status,
    127,
    `ci:${row.id} exited 127, a missing tool is not a detection:\n${out}`,
  );
  assert.doesNotMatch(out, MISSING_TOOL, `ci:${row.id} ran with a missing tool:\n${out}`);
  assert.notEqual(status, 0, `expected ci:${row.id} to fail:\n${out}`);
  assert.match(out, row.marker, `class marker ${row.marker} missing:\n${out}`);
}

const append = (copy: string, rel: string, text: string): void => {
  const file = path.join(copy, rel);
  fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}${text}`);
};

const SPEC_SOURCE = "specs/0279-pre-push-guard.md";
const PARITY_LINE =
  "        run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-agents-size.ts";

const ROWS: readonly Row[] = [
  {
    name: "spec lint violation other than the draft status",
    id: "lint-specs",
    marker: /\[FAIL\] specs\/9998-replay-fixture\.md/,
    mutate: (copy) => {
      const text = fs.readFileSync(path.join(copy, SPEC_SOURCE), "utf8");
      const broken = text
        .replace(/^id: "0279"$/m, 'id: "9998"')
        .replace(/^slug: .*$/m, "slug: replay-fixture")
        .replace(/^complexity: .*\n/m, "");
      writeRel(copy, "specs/9998-replay-fixture.md", broken);
    },
  },
  {
    name: "Markdown lint rule violation",
    id: "lint-markdown",
    marker: /docs\/replay-lint\.md:\d+(?::\d+)? error MD\d{3}\//,
    mutate: (copy) =>
      writeRel(copy, "docs/replay-lint.md", "#Heading without a space\n\n\n\ntext\n"),
  },
  {
    // The `markdown-links` capability only runs the link suite's self-tests; the repository-wide
    // link check of CI (check-markdown-links.ts) runs in `repository-scan`, which is what blocks.
    name: "broken relative Markdown link",
    id: "repository-scan",
    marker: /FAIL: docs\/replay-links\.md:3: .*does-not-exist-replay\.md.*does not exist/,
    mutate: (copy) =>
      writeRel(
        copy,
        "docs/replay-links.md",
        "# Links\n\nSee [nothing](./does-not-exist-replay.md).\n",
      ),
  },
  {
    // check-test-wiring guards `scripts/tests/test-*.sh` scripts (spec 0076): a script named in no
    // CI surface and in no exemption is an orphan. The allowlist entry keeps `ratchet` quiet.
    name: "test not wired in CI",
    id: "test-wiring",
    marker: /FAILED: .*run in no CI workflow[\s\S]*- scripts\/tests\/test-replay-unwired\.sh/,
    mutate: (copy) => {
      writeRel(copy, "scripts/tests/test-replay-unwired.sh", "#!/usr/bin/env bash\nexit 0\n");
      append(copy, "ci/shell-allowlist.txt", "scripts/tests/test-replay-unwired.sh\n");
    },
  },
  {
    // Arm 1 of the parity harness: a `run:` command of a build.yml job that no longer matches the
    // command list of its capability in ci/ci-capabilities.yml.
    name: "CI parity drift between build.yml and the capability file",
    id: "check-ci-parity",
    marker: /DRIFT: capability 'check-agents-size'.*--replay-drift/,
    mutate: (copy) => {
      const file = path.join(copy, ".github/workflows/build.yml");
      const text = fs.readFileSync(file, "utf8");
      assert.ok(text.includes(`${PARITY_LINE}\n`), "the build.yml line to drift was not found");
      fs.writeFileSync(file, text.replace(`${PARITY_LINE}\n`, `${PARITY_LINE} --replay-drift\n`));
    },
  },
  {
    // Hand-edit of a compiled output: `build-components.ts --target all --check` sees the drift.
    name: "built output drift under artifacts/",
    id: "component-drift",
    marker: /DRIFT: .*\.claude\/skills\/developer\/SKILL\.md differs from source/,
    mutate: (copy) => append(copy, ".claude/skills/developer/SKILL.md", "\nreplay drift line\n"),
  },
  {
    name: "unowned tracked file",
    id: "path-ownership",
    marker: /path-ownership: unowned: replay-unowned\/file\.txt: /,
    mutate: (copy) => writeRel(copy, "replay-unowned/file.txt", "no capability owns this\n"),
  },
  {
    name: "TypeScript format and typing",
    id: "lint-typescript",
    marker:
      /typecheck: TS2322: scripts\/replay-bad\.ts:1: |lint-typescript: format: scripts\/replay-bad\.ts: /,
    mutate: (copy) =>
      writeRel(
        copy,
        "scripts/replay-bad.ts",
        'const   x:number   =   "not a number" ;\nexport {x}\n',
      ),
  },
  {
    name: "skill source modified without a version bump",
    id: "check-skill-versions",
    marker: /FAIL artifacts\/core\/skills\/tester\/SKILL\.md .* not bumped/,
    mutate: (copy) => append(copy, "artifacts/core/skills/tester/SKILL.md", "\nreplay change\n"),
  },
];

/** Checkout files, tracked or untracked-but-not-ignored, as the working tree holds them. */
function checkoutFiles(): string[] {
  const listed = spawnSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split("\0").filter((f) => f !== "");
}

describe("ci:pre-push replays the failure classes of the last 60 failed build.yml runs", () => {
  let copy = "";
  let root = "";
  const failed = new Map<string, { status: number | null; out: string }>();

  /** The only git entry of this file: cwd is the copy, proven to be inside the mkdtemp root. */
  const inCopy = (args: readonly string[]): string => {
    assert.ok(copy.startsWith(root + path.sep), `${copy} is not inside ${root}`);
    return git(copy, args);
  };

  const branchFrom = (name: string, mutate: (c: string) => void): string => {
    inCopy(["checkout", "-q", "-f", "-B", name, "main"]);
    mutate(copy);
    inCopy(["add", "-A"]);
    inCopy(["commit", "-q", "-m", `replay ${name}`]);
    return inCopy(["rev-parse", "HEAD"]);
  };

  before(() => {
    root = makeSandbox("ci-pre-push-replay-");
    copy = path.join(root, "tree");
    fs.mkdirSync(copy);
    for (const rel of checkoutFiles()) {
      const from = path.join(REPO, rel);
      if (!fs.lstatSync(from, { throwIfNoEntry: false })?.isFile()) continue;
      const to = path.join(copy, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    // build-components refuses a linked js-yaml: really copy the production closure, link the rest.
    stageNodeModules(copy);
    for (const entry of fs.readdirSync(path.join(REPO, "node_modules"))) {
      const link = path.join(copy, "node_modules", entry);
      if (!fs.existsSync(link)) fs.symlinkSync(path.join(REPO, "node_modules", entry), link);
    }
    initRepo(copy, "main");
    fs.appendFileSync(path.join(copy, ".git/info/exclude"), "node_modules\n");
    inCopy(["add", "-A"]);
    inCopy(["commit", "-q", "-m", "base"]);
  });

  it("control: the real wrapper passes end to end on a benign Markdown edit", () => {
    branchFrom("replay-control", (c) => append(c, "docs/what-is-crewrig.md", "\nControl line.\n"));
    const r = runEntry(path.join(copy, "scripts/ci-pre-push.ts"), {
      cwd: copy,
      env: gitEnv({
        CREWRIG_PRE_PUSH_BASE: "main",
        // Task derives REPO_DIR from $PWD, which a child with another cwd inherits stale.
        PWD: copy,
        CREWRIG_PRE_PUSH_REFS: undefined,
        CREWRIG_PR_DRAFT: undefined,
        FORCE: undefined,
      }),
    });
    const out = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, `the unmutated copy must pass:\n${out}`);
    assert.match(out, /running \d+ check\(s\):.*lint-markdown/, out);
    assert.match(out, /ok\s+lint-markdown/, out);
    assert.doesNotMatch(out, /command not found/, out);
  });

  for (const row of ROWS) {
    it(`${row.name}: ci:${row.id} is selected and fails`, { todo: row.todo }, () => {
      const sha = branchFrom(`replay-${row.id}`, row.mutate);
      const env = gitEnv({ CREWRIG_PRE_PUSH_BASE: "main", PWD: copy });
      const selection = selectForShas(copy, [sha], env);
      assert.ok(
        selection.ids.includes(row.id),
        `${row.id} not selected for this changeset (selected: ${selection.ids.join(", ")})`,
      );
      const res = spawnSync("task", [`ci:${row.id}`], {
        cwd: copy,
        env: taskEnv(row.id, { cwd: copy, baseRef: selection.baseRef, env }) as Record<
          string,
          string
        >,
        encoding: "utf8",
      });
      const out = `${res.stdout}\n${res.stderr}`;
      failed.set(row.id, { status: res.status, out });
      assertDetected(row, res.status, out);
    });
  }

  it("changeset coverage is blocked locally by the static net, the path-ownership capability", () => {
    // Changeset coverage is an exhaustive CI-only net (docs/ci-reference-format.md:314, spec 0251):
    // the same class, a changed file no capability filter owns, is caught by `path-ownership`,
    // whose failing run is the "unowned tracked file" row above (no second 20 s run).
    const unowned = failed.get("path-ownership");
    assert.ok(unowned, "the path-ownership row must have run before this one");
    assert.notEqual(unowned.status, 0, unowned.out);
  });
});
