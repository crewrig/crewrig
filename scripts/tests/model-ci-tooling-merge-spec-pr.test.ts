// merge-spec-pr.test.ts — differential test of scripts/merge-spec-pr.ts against
// scripts/merge-spec-pr.sh. A stub `gh` (generated at runtime, never the real one)
// records its argv; both entries run with identical inputs under LC_ALL=C.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "merge-spec-pr.ts");
const SHELL = path.join(SCRIPTS, "merge-spec-pr.sh");
const tmp = mkdtempSync(path.join(tmpdir(), "merge-spec-pr-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const bin = path.join(tmp, "bin");
const argvLog = path.join(tmp, "gh-argv.log");
mkdirSync(bin);
writeFileSync(
  path.join(bin, "gh"),
  `${"#"}!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvLog}"; done\nprintf 'gh-out\\n'\nprintf 'gh-err\\n' >&2\nexit 7\n`,
);
chmodSync(path.join(bin, "gh"), 0o755);

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

let n = 0;
function repo(branch: string, spec?: { file: string; status: string }): string {
  const dir = path.join(tmp, `repo${n++}`);
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  mkdirSync(path.join(dir, "specs"));
  const body = spec ? `---\nid: 1\nstatus: ${spec.status}\n---\nbody\n` : "placeholder\n";
  writeFileSync(path.join(dir, "specs", spec?.file ?? "x.md"), body);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  argv: string;
}

function run(cmd: string, args: string[], cwd: string): Run {
  rmSync(argvLog, { force: true });
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  let argv = "";
  try {
    argv = readFileSync(argvLog, "utf8");
  } catch {
    argv = "";
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, argv };
}

const ts = (cwd: string, extra: string[]) =>
  run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...extra], cwd);
const sh = (cwd: string, extra: string[]) => run("bash", [SHELL, ...extra], cwd);

const cases: Array<{ name: string; dir: () => string; expect: number; argv?: string }> = [
  {
    name: "draft spec is refused",
    dir: () => repo("spec/0001-foo", { file: "0001-foo.md", status: "draft" }),
    expect: 1,
    argv: "",
  },
  {
    name: "approved spec delegates",
    dir: () => repo("spec/0001-foo", { file: "0001-foo.md", status: "approved" }),
    expect: 7,
    argv: "pr\nmerge\n--squash\n--auto\n--delete-branch\n",
  },
  {
    name: "delta branch maps -delta-N to .delta-N (draft)",
    dir: () => repo("spec/0001-foo-delta-02", { file: "0001-foo.delta-02.md", status: "draft" }),
    expect: 1,
    argv: "",
  },
  {
    name: "missing spec file warns and delegates",
    dir: () => repo("spec/0009-none"),
    expect: 7,
    argv: "pr\nmerge\n--squash\n--auto\n--delete-branch\n",
  },
  {
    name: "non-spec branch delegates",
    dir: () => repo("feat/x"),
    expect: 7,
    argv: "pr\nmerge\n--squash\n--auto\n--delete-branch\n",
  },
];

describe("merge-spec-pr.ts", () => {
  for (const c of cases) {
    it(c.name, () => {
      const dir = c.dir();
      const extra = ["--auto", "--delete-branch"];
      const t = ts(dir, extra);
      assert.equal(t.status, c.expect);
      assert.equal(t.argv, c.argv);
      if (process.platform === "win32") return;
      const s = sh(dir, extra);
      assert.deepEqual(t, s);
    });
  }
});
