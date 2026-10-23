// Tests for scripts/check-taskfile-commands.ts and its libraries (spec 0266 R13).
//
// Allowed on purpose: node, npm, npx, git, gh/glab/tea, claude/gemini/copilot/agy, pipx/python
// (the MemPalace exception), task, and docker (the e2e harness already spawns it).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { load } from "js-yaml";
import { parseExemptions } from "../lib/taskfile-command-exemption-file.ts";
import { findForbidden, forbiddenIn } from "../lib/taskfile-commands.ts";

const mirrors = path.resolve(import.meta.dirname, "..", "check-skill-mirrors.ts");
const checker = path.resolve(import.meta.dirname, "..", "check-taskfile-commands.ts");
const realRoot = path.resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];

function makeRoot(taskfile: string, exemptions: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), "taskfile-commands-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  writeFileSync(path.join(root, "Taskfile.yml"), taskfile);
  writeFileSync(
    path.join(root, "scripts", "lib", "taskfile-command-exemptions.json"),
    JSON.stringify(exemptions),
  );
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", checker], {
    encoding: "utf8",
    env: { ...process.env, CREWRIG_REPO_DIR: root },
  });
}

const entry = (task: string, command: string) => ({
  task,
  command,
  owner: "I2",
  issue: "#1339",
  reason: "test",
});

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("forbiddenIn", () => {
  it("flags every forbidden utility at command position", () => {
    for (const name of ["jq", "yq", "awk", "sed", "grep", "mktemp", "curl", "ln", "lsof", "ss"]) {
      assert.deepEqual(forbiddenIn(`${name} --version`), [name], name);
    }
    assert.deepEqual(forbiddenIn("test -x node_modules/.bin/tsc"), ["test"]);
    assert.deepEqual(forbiddenIn("command -v yq"), ["command -v"]);
  });

  it("flags bash, sh and any .sh path", () => {
    assert.deepEqual(forbiddenIn("bash {{.REPO_DIR}}/scripts/x.sh"), [".sh", "bash"]);
    assert.deepEqual(forbiddenIn("sh -c 'echo hi'"), ["sh"]);
    assert.deepEqual(forbiddenIn("./scripts/run.sh"), [".sh"]);
  });

  it("finds a utility after a pipe, a separator or a command substitution", () => {
    assert.deepEqual(forbiddenIn("git ls-files | grep ts"), ["grep"]);
    assert.deepEqual(forbiddenIn('val="$(yq eval x)"'), ["yq"]);
    assert.deepEqual(forbiddenIn("npm ci && jq . a.json"), ["jq"]);
  });

  it("allows the cross-platform toolchain, including docker", () => {
    const allowed = [
      "node scripts/check.ts",
      "npm ci",
      "npx --no-install markdownlint --version",
      "git status",
      "gh pr list",
      "glab mr list",
      "tea pulls",
      "claude --version",
      "gemini --version",
      "copilot --version",
      "agy --version",
      "pipx install mempalace",
      "python -m mempalace",
      "task lint-ts",
      "docker build -t image .",
      "docker image inspect image",
    ];
    for (const text of allowed) {
      assert.deepEqual(forbiddenIn(text), [], text);
    }
  });

  it("ignores comments, quoted program text and words that merely contain a utility name", () => {
    assert.deepEqual(forbiddenIn("# grep the output\nnode a.ts"), []);
    assert.deepEqual(forbiddenIn("node a.ts 'sed -i x'"), []);
    assert.deepEqual(forbiddenIn("echo grep awk"), []);
    assert.deepEqual(forbiddenIn("node scripts/check-bash.ts"), []);
  });
});

describe("findForbidden", () => {
  it("reads cmd, cmds, defer, preconditions, status and sh vars", () => {
    const doc = load(`
tasks:
  a: { cmd: "jq ." }
  b: { cmds: ["node x.ts", { cmd: "awk 1" }, { defer: "sed p" }, { task: a }] }
  c: { preconditions: [{ sh: "yq --version", msg: m }, "curl x"] }
  d: { status: ["test -f x"], vars: { V: { sh: "mktemp" } } }
  e: { cmd: "node ok.ts" }
`);
    assert.deepEqual(
      findForbidden(doc).map((f) => `${f.task}:${f.command}`),
      ["a:jq", "b:awk", "b:sed", "c:yq", "c:curl", "d:test", "d:mktemp"],
    );
  });
});

describe("parseExemptions", () => {
  it("rejects missing fields, a bad issue and duplicates", () => {
    assert.deepEqual(parseExemptions('{"exemptions":[{"task":"t"}]}').problems.length, 1);
    const bad = { ...entry("t", "bash"), issue: "1339" };
    assert.match(parseExemptions(JSON.stringify({ exemptions: [bad] })).problems[0] ?? "", /issue/);
    const dup = JSON.stringify({ exemptions: [entry("t", "bash"), entry("t", "bash")] });
    assert.match(parseExemptions(dup).problems[0] ?? "", /duplicates/);
    assert.equal(parseExemptions("nope").problems.length, 1);
  });
});

describe("check-taskfile-commands", () => {
  const dirty = "tasks:\n  t:\n    cmd: bash x.sh\n";

  it("passes on the real repository", () => {
    const res = run(realRoot);
    assert.equal(res.status, 0, res.stderr);
  });

  it("fails on a non-exempt forbidden command and names the task", () => {
    const res = run(makeRoot(dirty, { exemptions: [] }));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /task 't' uses forbidden command 'bash'/);
    assert.match(res.stderr, /'\.sh'/);
  });

  it("passes when every forbidden command is exempted", () => {
    const res = run(makeRoot(dirty, { exemptions: [entry("t", "bash"), entry("t", ".sh")] }));
    assert.equal(res.status, 0, res.stderr);
  });

  it("fails on a stale exemption", () => {
    const clean = "tasks:\n  t:\n    cmd: node x.ts\n";
    const res = run(makeRoot(clean, { exemptions: [entry("t", "bash")] }));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /stale exemption: task 't' no longer uses 'bash'/);
  });

  it("fails when the Taskfile is missing", () => {
    const root = makeRoot(dirty, { exemptions: [] });
    rmSync(path.join(root, "Taskfile.yml"));
    assert.equal(run(root).status, 2);
  });

  it("exits 2 with a stderr message when an included file is unreadable", () => {
    const root = makeRoot("version: '3'\nincludes:\n  x: ./taskfiles/x.yml\n", { exemptions: [] });
    const res = run(root);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unreadable: taskfiles\/x\.yml/);
  });
});

describe("check-taskfile-commands over a split tree (spec 0278 R15)", () => {
  const splitRoot = (lint: string, usage: string, exemptions: unknown = { exemptions: [] }) => {
    const root = makeRoot(
      [
        "version: '3'",
        "includes:",
        "  lint:",
        "    taskfile: ./taskfiles/lint.yml",
        "    flatten: true",
        "  usage: ./taskfiles/usage.yml",
        "",
      ].join("\n"),
      exemptions,
    );
    mkdirSync(path.join(root, "taskfiles"), { recursive: true });
    writeFileSync(path.join(root, "taskfiles", "lint.yml"), lint);
    writeFileSync(path.join(root, "taskfiles", "usage.yml"), usage);
    return root;
  };
  const clean = "version: '3'\ntasks:\n  price:\n    cmd: node x.ts\n";

  it("passes a clean split-shaped tree", () => {
    const res = run(splitRoot(clean, clean));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /OK \(0 exemption\(s\)\)/);
  });

  it("fails a jq planted in a flattened included file and names the task and command", () => {
    const planted = "version: '3'\ntasks:\n  lint-md:\n    cmd: jq . a.json\n";
    const res = run(splitRoot(planted, clean));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /task 'lint-md' uses forbidden command 'jq'/);
  });

  it("fails a jq planted in a namespaced included file under its effective name", () => {
    const planted = "version: '3'\ntasks:\n  price:\n    cmds:\n      - jq . a.json\n";
    const res = run(splitRoot(clean, planted));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /task 'usage:price' uses forbidden command 'jq'/);
  });

  it("matches an exemption written with the effective name", () => {
    const planted = "version: '3'\ntasks:\n  price:\n    cmd: jq . a.json\n";
    const res = run(splitRoot(clean, planted, { exemptions: [entry("usage:price", "jq")] }));
    assert.equal(res.status, 0, res.stderr);
  });
});

describe("check-skill-mirrors (the node replacement of the skill:check task)", () => {
  const skill = (name: string, version: boolean) =>
    `---\nname: ${name}\n${version ? "metadata:\n  provenance:\n    version: 1.0.0\n" : ""}---\nbody\n`;

  function mirrorRoot(withVersion: boolean): string {
    const root = mkdtempSync(path.join(tmpdir(), "skill-mirrors-"));
    roots.push(root);
    for (const dir of [".claude", ".gemini", ".github"]) {
      mkdirSync(path.join(root, dir, "skills", "x"), { recursive: true });
      writeFileSync(path.join(root, dir, "skills", "x", "SKILL.md"), skill("x", withVersion));
    }
    return root;
  }

  function runMirrors(root: string, ...args: string[]) {
    return spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", mirrors, ...args],
      { encoding: "utf8", env: { ...process.env, CREWRIG_REPO_DIR: root } },
    );
  }

  it("passes a complete mirror set and names the component", () => {
    const res = runMirrors(mirrorRoot(true), "x");
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^x: OK across/);
  });

  it("fails a mirror that lacks the provenance version, with a remediation line", () => {
    const res = runMirrors(mirrorRoot(false), "x");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /missing or empty YAML field metadata\.provenance\.version/);
    assert.match(res.stderr, /Remediation: rebuild with/);
  });

  it("fails an asymmetric agent mirror set", () => {
    const root = mirrorRoot(true);
    mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
    writeFileSync(path.join(root, ".claude", "agents", "x.md"), skill("x", true));
    const res = runMirrors(root, "x");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /asymmetric — present on 1\/3 paths/);
  });

  it("exits 2 without a name", () => {
    assert.equal(runMirrors(mirrorRoot(true)).status, 2);
  });
});
