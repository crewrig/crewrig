// windows-model-ci-tooling-spec-id.test.ts — the cross-system proof of check-spec-id-reserved.ts
// and reserve-spec-id.ts (spec 0262 R21-R23). The cases run from PowerShell on Windows on scratch
// git repos with a scratch bare remote made by git (no network); off Windows they run from the
// default shell so the file also passes in Linux CI. Interpreters are resolved from the PARENT
// PATH before the child PATH is narrowed. The `windows-model-ci-tooling` job runs every
// `windows-model-ci-tooling-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  WIN,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPEC = `---\nid: "0777"\nslug: x\nstatus: draft\nrelated-issue: 881\n---\n\nbody\n`;

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

/** A scratch work repo plus a scratch bare remote `origin`; `withSpec` adds specs/0777-x.md. */
function withBox<T>(withSpec: boolean, body: (work: string, root: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-model-ci-tooling-")),
  );
  try {
    const bare = path.join(root, "bare.git");
    const work = path.join(root, "work");
    fs.mkdirSync(bare);
    fs.mkdirSync(path.join(work, "specs"), { recursive: true });
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(work, "init", "-q", "-b", "main");
    git(work, "config", "user.email", "t@example.com");
    git(work, "config", "user.name", "t");
    fs.writeFileSync(path.join(work, "specs", "0001-a.md"), `---\nid: "0001"\nslug: a\n---\n`);
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "base");
    git(work, "remote", "add", "origin", bare);
    git(work, "push", "-q", "origin", "main");
    git(work, "fetch", "-q", "origin");
    if (withSpec) {
      git(work, "checkout", "-q", "-b", "spec/0777-x");
      fs.writeFileSync(path.join(work, "specs", "0777-x.md"), SPEC);
      git(work, "add", ".");
      git(work, "commit", "-q", "-m", "spec");
    }
    return body(work, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Directory of `git`, resolved from the parent PATH (the child PATH is narrowed). */
function gitDir(): string[] {
  const r = spawnSync(WIN ? "where" : "which", ["git"], { encoding: "utf8" });
  const first = r.status === 0 ? r.stdout.split(/\r?\n/)[0] : undefined;
  return first ? [path.dirname(first)] : [];
}

function run(tool: string, args: string[], work: string, root: string): Run {
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-model-ci-tooling-spec-id: ${tool}: ${interpreters.notes.join("; ")}`);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  return spawnEntry({
    entry: `${tool} ${args.join(" ")}`,
    script: path.join(repo, "scripts", `${tool}.ts`),
    args,
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      CREWRIG_REPO_DIR: work,
      // Outside CI the origin must be stated; empty values count as unset, so an ambient CI
      // marker cannot turn the override inadmissible.
      CREWRIG_SPEC_ID_ORIGIN: "fork",
      CI: "",
      GITHUB_ACTIONS: "",
      GITLAB_CI: "",
      CI_MERGE_REQUEST_SOURCE_PROJECT_PATH: "",
      CI_PROJECT_PATH: "",
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "",
      BASE_REF: "",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    },
    home: root,
    bin,
    cwd: work,
    extraPath: gitDir(),
    interpreters,
  });
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n");

describe("windows model-ci-tooling: spec-id twins", () => {
  it("check-spec-id-reserved reports an unsecured id with a verdict and exit 0 (fork origin)", () => {
    withBox(true, (work, root) => {
      const r = run("check-spec-id-reserved", ["origin/main"], work, root);
      expectStatus(r, 0);
      const err = lf(r.err + r.out);
      assert.match(err, /Specs added or renamed by this change: 1/, why(r, "scanned the spec"));
      assert.match(err, /id '0777' was never secured/, why(r, "names the unsecured id"));
      assert.match(err, /bash scripts\/reserve-spec-id\.sh --id 0777 --issue 881/, why(r, "fix"));
    });
  });

  it("check-spec-id-reserved with no spec in the change exits 0 and blames nothing", () => {
    withBox(false, (work, root) => {
      const r = run("check-spec-id-reserved", ["origin/main"], work, root);
      expectStatus(r, 0);
      assert.doesNotMatch(lf(r.err + r.out), /never secured/, why(r, "no finding"));
    });
  });

  it("check-spec-id-reserved refuses an unresolvable base as a wiring fault, status 2", () => {
    withBox(true, (work, root) => {
      const r = run("check-spec-id-reserved", ["nosuchremote/main"], work, root);
      expectStatus(r, 2);
      assert.equal(r.out, "", why(r, "nothing on stdout"));
    });
  });

  it("reserve-spec-id --offline allocates the next id, marks it unsecured, status 3", () => {
    withBox(false, (work, root) => {
      const r = run("reserve-spec-id", ["--issue", "901", "--offline"], work, root);
      expectStatus(r, 3);
      assert.equal(lf(r.out), "0002\nunsecured-id: true\n", why(r, "id then the mark"));
      assert.match(lf(r.err), /--offline/, why(r, "states why"));
      assert.match(lf(r.err), /reserve-spec-id\.sh --id 0002/, why(r, "remediation"));
    });
  });
});
