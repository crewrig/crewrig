// check-ratchet.test.ts — black-box tests for scripts/check-ratchet.ts (spec 0238 R1-R3).
//
// Every fixture is a throwaway `git init` repository under os.tmpdir(): the
// base state is committed on `main`, the pull-request state on `feature`, and
// the real entry point runs against it through CREWRIG_REPO_DIR. Standard
// library only, so it runs before `npm ci`, like the ratchet itself.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-ratchet.ts");
const SHELL_LIST = "ci/shell-allowlist.txt";
const JS_BASELINE = "ci/js-baseline.txt";
const JS_EXCEPTIONS = "ci/js-exceptions.txt";

/** Repository-relative path to content; `null` deletes the path. */
type Tree = Record<string, string | null>;

interface Run {
  status: number | null;
  out: string;
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** The environment minus anything that would leak the caller's git or base ref. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of ["BASE_REF", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

function git(dir: string, ...args: string[]): void {
  const res = spawnSync(
    "git",
    ["-C", dir, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args],
    { encoding: "utf8", env: cleanEnv({}) },
  );
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
}

function commit(dir: string, tree: Tree): void {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(dir, rel);
    if (content === null) {
      fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "fixture");
}

const BASE: Tree = {
  "README.md": "fixture\n",
  "specs/0001-demo.md": "# demo\n",
  "scripts/old.sh": "#!/usr/bin/env bash\necho old\n",
  "scripts/zeta.sh": "#!/usr/bin/env bash\necho zeta\n",
  "lib/legacy.js": "module.exports = 1;\n",
  "tools/legacy.py": "print('legacy')\n",
  [SHELL_LIST]: "# header\nscripts/old.sh\nscripts/zeta.sh\n",
  [JS_BASELINE]: "# header\nlib/legacy.js\n",
  [JS_EXCEPTIONS]: "# header\n",
};

/** A fixture repository: `base` committed on `main`, then `branch` on `feature`. */
function repo(branch: Tree = {}, base: Tree = BASE): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-test-")));
  temps.push(dir);
  git(dir, "init", "-q", "-b", "main");
  commit(dir, base);
  git(dir, "checkout", "-q", "-b", "feature");
  commit(dir, branch);
  return dir;
}

/** Run the ratchet; `baseRef` enables the diff arms (none by default: no remote exists). */
function ratchet(dir: string, opts: { baseRef?: string; write?: boolean } = {}): Run {
  const extra: Record<string, string> = { CREWRIG_REPO_DIR: dir };
  if (opts.baseRef !== undefined) extra.BASE_REF = opts.baseRef;
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK, ...(opts.write ? ["--write"] : [])],
    { cwd: dir, env: cleanEnv(extra), encoding: "utf8" },
  );
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

/** The finding line for `rule` at `where`, failing the test when it is absent. */
function findingLine(run: Run, rule: string, where: string): string {
  const prefix = `ratchet: ${rule}: ${where}: `;
  const line = run.out.split("\n").find((l) => l.startsWith(prefix));
  assert.ok(line !== undefined, `expected '${prefix}...' in:\n${run.out}`);
  return line;
}

function expectFinding(run: Run, rule: string, where: string): string {
  assert.equal(run.status, 1, run.out);
  return findingLine(run, rule, where);
}

function expectClean(run: Run): void {
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /^ratchet: OK /m);
}

function entries(dir: string, rel: string): string[] {
  return fs
    .readFileSync(path.join(dir, rel), "utf8")
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#"));
}

describe("spec 0238 ratchet scenarios", () => {
  test("an unrelated pull request passes and leaves the lists unchanged", () => {
    const dir = repo({ "docs/note.md": "unrelated\n" });
    expectClean(ratchet(dir, { baseRef: "main" }));
    assert.equal(fs.readFileSync(path.join(dir, SHELL_LIST), "utf8"), BASE[SHELL_LIST]);
    assert.equal(fs.readFileSync(path.join(dir, JS_BASELINE), "utf8"), BASE[JS_BASELINE]);
  });

  test("a new shell script left off the allowlist fails as shell-unlisted", () => {
    const dir = repo({ "scripts/check-new-thing.sh": "#!/usr/bin/env bash\n" });
    expectFinding(
      ratchet(dir, { baseRef: "main" }),
      "shell-unlisted",
      "scripts/check-new-thing.sh",
    );
  });

  test("a new shell script added directly to the allowlist fails as shell-entry-added", () => {
    const dir = repo({
      "scripts/check-new-thing.sh": "#!/usr/bin/env bash\n",
      [SHELL_LIST]: "# header\nscripts/check-new-thing.sh\nscripts/old.sh\nscripts/zeta.sh\n",
    });
    const run = ratchet(dir, { baseRef: "main" });
    assert.match(
      expectFinding(run, "shell-entry-added", `${SHELL_LIST}:2`),
      /'scripts\/check-new-thing\.sh'/,
    );
    assert.doesNotMatch(run.out, /shell-unlisted/);
  });

  test("an entry whose script was removed fails as shell-stale-entry", () => {
    const dir = repo({ "scripts/old.sh": null });
    const line = expectFinding(ratchet(dir), "shell-stale-entry", `${SHELL_LIST}:2`);
    assert.match(line, /'scripts\/old\.sh'/);
  });

  test("a disallowed new .mjs fails as js-unlisted, naming the permitted exceptions", () => {
    const dir = repo({ "lib/helper.mjs": "export const x = 1;\n" });
    const line = expectFinding(ratchet(dir), "js-unlisted", "lib/helper.mjs");
    assert.match(line, /node-floor-guard/);
    assert.match(line, /tool-config/);
  });

  test("an added Python file without a mempalace import fails as py-no-mempalace", () => {
    const dir = repo({ "tools/new.py": "import os\nprint(os.getcwd())\n" });
    expectFinding(ratchet(dir, { baseRef: "main" }), "py-no-mempalace", "tools/new.py");
  });
});

describe("shell-file detection", () => {
  test("an extension-less file with a #!/usr/bin/env bash shebang qualifies", () => {
    const dir = repo({ "bin/tool": "#!/usr/bin/env bash\necho tool\n" });
    expectFinding(ratchet(dir), "shell-unlisted", "bin/tool");
  });

  test("a #!/bin/sh shebang qualifies", () => {
    const dir = repo({ "bin/posix": "#!/bin/sh\necho posix\n" });
    expectFinding(ratchet(dir), "shell-unlisted", "bin/posix");
  });

  test("a #!/usr/bin/env node shebang does not qualify", () => {
    expectClean(ratchet(repo({ "bin/cli": "#!/usr/bin/env node\nconsole.log(1)\n" })));
  });

  test("a .sh under the built-copy tree .claude/ is exempt", () => {
    expectClean(ratchet(repo({ ".claude/hooks/built.sh": "#!/usr/bin/env bash\n" })));
  });
});

describe("list hygiene and JavaScript exceptions", () => {
  test("an out-of-order allowlist fails as list-unsorted", () => {
    const dir = repo({ [SHELL_LIST]: "# header\nscripts/zeta.sh\nscripts/old.sh\n" });
    expectFinding(ratchet(dir, { baseRef: "main" }), "list-unsorted", `${SHELL_LIST}:3`);
  });

  const unjustified: Array<[string, string]> = [
    ["no category", "see 0001"],
    ["an unknown category", "build-helper 0001 convenient"],
    ["no spec citation", "tool-config mandated by the tool"],
    ["a non-existent spec", "tool-config 0999 mandated by the tool"],
  ];
  for (const [label, reason] of unjustified) {
    test(`an exception with ${label} fails as js-exception-unjustified`, () => {
      const dir = repo({
        "lib/tool.config.js": "module.exports = {};\n",
        [JS_EXCEPTIONS]: `# header\nlib/tool.config.js\t${reason}\n`,
      });
      expectFinding(ratchet(dir), "js-exception-unjustified", `${JS_EXCEPTIONS}:2`);
    });
  }

  test("an exception with a category and an existing spec passes", () => {
    const dir = repo({
      "lib/tool.config.js": "module.exports = {};\n",
      [JS_EXCEPTIONS]: "# header\nlib/tool.config.js\ttool-config 0001 mandated by the tool\n",
    });
    expectClean(ratchet(dir, { baseRef: "main" }));
  });
});

describe("Python and base-ref diff arms", () => {
  test("an added Python file using `from mempalace.x import y` passes", () => {
    const dir = repo({ "tools/bound.py": "from mempalace.mcp_server import tool_get_drawer\n" });
    expectClean(ratchet(dir, { baseRef: "main" }));
  });

  test("a non-mempalace Python file renamed into place fails as py-no-mempalace", () => {
    const dir = repo({ "tools/legacy.py": null, "tools/renamed.py": "print('legacy')\n" });
    expectFinding(ratchet(dir, { baseRef: "main" }), "py-no-mempalace", "tools/renamed.py");
  });

  test("an explicit BASE_REF that resolves nowhere is a wiring fault (exit 2)", () => {
    const run = ratchet(repo(), { baseRef: "no-such-branch" });
    assert.equal(run.status, 2, run.out);
    assert.match(run.out, /^ratchet: error: BASE_REF 'no-such-branch'/m);
  });
});

describe("--write", () => {
  test("never grows an existing list: a branch-added entry is dropped, a deleted file too", () => {
    const dir = repo({
      "scripts/zeta.sh": null,
      "scripts/new.sh": "#!/usr/bin/env bash\n",
      "lib/new.js": "module.exports = 2;\n",
      [SHELL_LIST]: "# header\nscripts/new.sh\nscripts/old.sh\nscripts/zeta.sh\n",
      [JS_BASELINE]: "# header\nlib/legacy.js\nlib/new.js\n",
    });
    const run = ratchet(dir, { baseRef: "main", write: true });
    assert.equal(run.status, 0, run.out);
    assert.deepEqual(entries(dir, SHELL_LIST), ["scripts/old.sh"]);
    assert.deepEqual(entries(dir, JS_BASELINE), ["lib/legacy.js"]);
    findingLine(ratchet(dir, { baseRef: "main" }), "shell-unlisted", "scripts/new.sh");
  });

  test("bootstraps the full computed set when the base has no list", () => {
    const base: Tree = {
      ...BASE,
      "bin/tool": "#!/bin/sh\n",
      ".claude/hooks/built.sh": "#!/usr/bin/env bash\n",
      ".github/built.js": "module.exports = 0;\n",
      [SHELL_LIST]: null,
      [JS_BASELINE]: null,
    };
    const dir = repo({}, base);
    const run = ratchet(dir, { baseRef: "main", write: true });
    assert.equal(run.status, 0, run.out);
    assert.deepEqual(entries(dir, SHELL_LIST), ["bin/tool", "scripts/old.sh", "scripts/zeta.sh"]);
    assert.deepEqual(entries(dir, JS_BASELINE), ["lib/legacy.js"]);
  });
});
