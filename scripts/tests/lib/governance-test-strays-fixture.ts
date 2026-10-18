// governance-test-strays-fixture.ts — fixtures of governance-check-test-strays-cases.test.ts
// (spec 0265, row J2, P6). Replaces the helpers of scripts/tests/test-check-test-strays.sh
// (mk_fixture, mk_ci_fixture, count_suites, ok_line).
//
// Every suite file is generated at run time inside a mkdtemp directory; nothing here is a
// committed `test-*.sh`, so check-test-strays and check-test-wiring never see a fixture.
// Nothing here deletes a path it did not create with mkdtemp.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv } from "./governance-sandbox.ts";

/** Git with the developer's global/system config out of the picture. */
function fxgit(cwd: string, args: readonly string[], input?: string): string {
  const res = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    env: childEnv({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    }),
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

/** `<repo>/scripts/tests` with the given suites written into it (mode 0755). */
export function mkSuites(repo: string, files: Readonly<Record<string, string>> = {}): void {
  const dir = path.join(repo, "scripts", "tests");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
  }
}

/** A `test-probe.sh` that touches `sentinel`, then runs a stray command. */
export function probeSuite(repo: string, sentinel: string, withStray = true): void {
  mkSuites(repo, {
    "test-probe.sh": `#!/bin/bash\ntouch '${sentinel}'\n${withStray ? "some-bogus-command\n" : ""}`,
  });
}

/** The exact stdout of a clean run over `n` suites (no trailing newline). */
export function okLine(n: number): string {
  return `OK: ${n} test suites pass the static syntax check; none executed.`;
}

/** Number of `scripts/tests/test-*.sh` in a fixture. */
export function countSuites(repo: string): number {
  return fs
    .readdirSync(path.join(repo, "scripts", "tests"))
    .filter((n) => n.startsWith("test-") && n.endsWith(".sh")).length;
}

/**
 * The CI topology of issue #1401: a bare remote with `main`, `release/x` and an orphan
 * branch, then a feature commit checked out DETACHED with the only local branch deleted.
 * `test-changed.sh` is clean and modified by the feature commit; `test-unchanged.sh` carries
 * a stray and is untouched. `bare` must be a directory outside `repo`.
 */
export function ciTopology(repo: string, bare: string, remote = "origin"): void {
  mkSuites(repo, {
    "test-changed.sh": '#!/bin/bash\necho "version 1"\n',
    "test-unchanged.sh": "#!/bin/bash\nsome-bogus-command\n",
  });
  fxgit(repo, ["init", "-q"]);
  fxgit(repo, ["config", "commit.gpgsign", "false"]);
  fxgit(repo, ["add", "-A"]);
  fxgit(repo, ["commit", "-qm", "base"]);
  fxgit(repo, ["branch", "-M", "main"]);
  fxgit(bare, ["init", "--bare", "-q", bare]);
  fxgit(repo, ["remote", "add", remote, bare]);
  const emptyTree = fxgit(repo, ["mktree"], "");
  const orphan = fxgit(repo, ["commit-tree", "-m", "orphan", emptyTree]);
  fxgit(repo, [
    "push",
    "-q",
    remote,
    "main",
    "HEAD:refs/heads/release/x",
    `${orphan}:refs/heads/orphan`,
  ]);
  mkSuites(repo, { "test-changed.sh": '#!/bin/bash\necho "version 2"\n' });
  fxgit(repo, ["add", "-A"]);
  fxgit(repo, ["commit", "-qm", "feature"]);
  fxgit(repo, ["checkout", "-q", "--detach"]);
  fxgit(repo, ["branch", "-D", "main"]);
}
