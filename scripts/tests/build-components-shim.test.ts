// build-components-shim.test.ts — scripts/build-components.sh, the forwarding shim (spec 0250
// R22, plan step 30; cold-review finding v1-F4: this suite spawns `bash` on purpose, so it is
// POSIX-only and skips where no `bash` exists).
//
// `node` absent: one shell-authored `Error:` line naming node and 24, exit 1, no file written.
// A `node` reporting v20: the floor guard's status and diagnostic, the build not run. A healthy
// node: every argument, the exit status, both output streams, standard input and the
// environment reach the build unchanged, checked twice: against a recording `node` stub (what
// reaches it) and against the real entry (`node scripts/build-components.ts` directly).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { createFixtureTree, REPO } from "./lib/build-fixture-tree.ts";
import { CONFIG, seedMappings, skill } from "./fixtures/build-components/entry-kit.ts";
import { pathWithFakeNode, pathWithoutNode } from "./lib/shim-env.ts";
import { cleanEnv, cleanupAll, makePathDir, which } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const BASH = which("bash");
const SKIP =
  process.platform === "win32"
    ? "SKIP: POSIX-only suite (the shim is Bash)"
    : BASH === null
      ? "SKIP: bash is not installed"
      : false;
const SHIM = path.join(REPO, "scripts", "build-components.sh");

interface Out {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function bash(shim: string, args: readonly string[], env: NodeJS.ProcessEnv, input = ""): Out {
  const res = spawnSync(BASH ?? "bash", [shim, ...args], { env, input, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Every path under `dir`, sorted. */
function listing(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

/** A PATH whose `node` is a recorder: the floor guard runs on the real Node.js, the build is replaced. */
function pathWithRecordingNode(): NodeJS.ProcessEnv {
  const links: Record<string, string> = {};
  for (const name of ["dirname", "cat", "env"]) links[name] = which(name) ?? name;
  const bin = makePathDir({
    links,
    scripts: {
      node: [
        `case "$1" in *node-floor-guard.js) exec "${process.execPath}" "$@";; esac`,
        `printf 'argv:%s\\n' "$@"`,
        `echo "pid:$$"`,
        `printf 'env:%s|%s\\n' "$SHIM_PROBE" "$REPO_DIR"`,
        `echo "recorder-stderr" >&2`,
        `exit "\${STUB_EXIT:-0}"`,
      ].join("\n"),
    },
  });
  return cleanEnv({ PATH: bin });
}

describe("a node absent from the search path", { skip: SKIP }, () => {
  test("one shell-authored Error: line naming node and 24, exit 1, nothing written", () => {
    const root = createFixtureTree({ deps: "none" });
    const before = listing(root.root);
    const res = bash(SHIM, ["--target", "claude"], { ...pathWithoutNode(), REPO_DIR: root.root });
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr.split("\n").filter((l) => l !== "").length, 1, res.stderr);
    assert.match(res.stderr, /^Error: .*\bnode\b.*\b24\b/);
    assert.deepEqual(listing(root.root), before);
  });
});

describe("a node below the floor", { skip: SKIP }, () => {
  test("the floor guard's status and diagnostic; the build does not run; nothing is created", () => {
    const root = createFixtureTree({ deps: "none" });
    const before = listing(root.root);
    const env = { ...pathWithFakeNode("v20.11.1"), REPO_DIR: root.root };
    const res = bash(SHIM, ["--target", "claude"], env);
    assert.notEqual(res.status, 0);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr.split("\n").filter((l) => l !== "").length, 1, res.stderr);
    assert.match(res.stderr, /requires Node\.js >= 24/);
    assert.match(res.stderr, /v20\.11\.1/);
    assert.deepEqual(listing(root.root), before, "the build did not run");
  });
});

describe("a healthy node: what reaches the build, and what comes back", { skip: SKIP }, () => {
  const probe = (args: readonly string[], extra: NodeJS.ProcessEnv = {}, input = ""): Out =>
    bash(SHIM, args, { ...pathWithRecordingNode(), SHIM_PROBE: "probe-value", ...extra }, input);

  test("every argument reaches the entry, in order, unchanged", () => {
    const args = ["--target", "claude", "with space", "", "--tier=*", "$HOME", "it's"];
    const res = probe(args, { REPO_DIR: "/r" });
    const lines = res.stdout.split("\n");
    assert.match(lines[0] ?? "", /^argv:.*scripts\/build-components\.ts$/);
    assert.deepEqual(
      lines.slice(1, 1 + args.length),
      args.map((a) => `argv:${a}`),
    );
  });

  test("no argument: the entry gets none", () => {
    const lines = probe([], { REPO_DIR: "/r" }).stdout.split("\n");
    assert.equal(lines.filter((l) => l.startsWith("argv:")).length, 1);
  });

  test("REPO_DIR and another variable reach the entry", () => {
    assert.match(
      probe(["x"], { REPO_DIR: "/some/root" }).stdout,
      /^env:probe-value\|\/some\/root$/m,
    );
  });

  test("the entry's exit status and both streams come back unchanged", () => {
    const res = probe(["x"], { REPO_DIR: "/r", STUB_EXIT: "7" });
    assert.equal(res.status, 7);
    assert.equal(res.stderr, "recorder-stderr\n");
    assert.match(res.stdout, /^argv:/);
  });

  test("the build replaces the shell (exec): same process id, no wrapper left", () => {
    const env = { ...pathWithRecordingNode(), REPO_DIR: "/r", SHIM_PROBE: "p" };
    const res = spawnSync(
      BASH ?? "bash",
      ["-c", 'echo "shell:$$"; exec "$1" "$2" x', "w", BASH ?? "bash", SHIM],
      {
        env,
        encoding: "utf8",
      },
    );
    const shell = /^shell:(\d+)$/m.exec(res.stdout)?.[1];
    assert.ok(shell !== undefined, res.stdout);
    assert.match(res.stdout, new RegExp(`^pid:${shell}$`, "m"));
  });

  test("standard input is left unread for the caller", () => {
    const env = { ...pathWithRecordingNode(), REPO_DIR: "/r", SHIM_PROBE: "p" };
    const res = spawnSync(
      BASH ?? "bash",
      ["-c", 'bash "$1" --x >/dev/null 2>&1; cat', "wrapper", SHIM],
      { env, input: "left-for-the-caller\n", encoding: "utf8" },
    );
    assert.equal(res.stdout, "left-for-the-caller\n");
  });
});

describe("against the real entry on a fixture tree", { skip: SKIP }, () => {
  const tree = createFixtureTree();
  tree.config(CONFIG);
  tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
  seedMappings(tree);
  const viaShim = (args: readonly string[]): Out =>
    bash(tree.resolve("scripts/build-components.sh"), args, cleanEnv({ REPO_DIR: tree.root }));

  test("--list-output-dirs prints the entry's lines", () => {
    const args = ["--list-output-dirs", "--target", "claude"];
    const direct = tree.run(args);
    const shim = viaShim(args);
    assert.equal(direct.status, 0, direct.stderr);
    assert.notEqual(direct.stdout, "");
    assert.deepEqual(shim, direct);
  });

  test("--check on a tree that matches: same status and streams", () => {
    assert.equal(tree.run(["--target", "claude"]).status, 0);
    assert.deepEqual(
      viaShim(["--check", "--target", "claude"]),
      tree.run(["--check", "--target", "claude"]),
    );
  });

  test("a malformed canonical_repo: same status, empty stdout, same diagnostic", () => {
    tree.write("crewrig.config.toml", 'canonical_repo = "file:///x"\n');
    const direct = tree.run(["--target", "claude"]);
    assert.equal(direct.status, 1);
    assert.match(direct.stderr, /^Error: canonical_repo in crewrig\.config\.toml is malformed/);
    assert.deepEqual(viaShim(["--target", "claude"]), direct);
  });
});

describe("the shim's place in the repository", () => {
  test("ci/shell-allowlist.txt still lists the shim and has not grown", () => {
    const now = fs.readFileSync(path.join(REPO, "ci/shell-allowlist.txt"), "utf8").split("\n");
    assert.ok(now.includes("scripts/build-components.sh"), "the shim is still on the allowlist");
    const head = spawnSync("git", ["show", "HEAD:ci/shell-allowlist.txt"], {
      cwd: REPO,
      encoding: "utf8",
    });
    if (head.status !== 0) return;
    const was = new Set(head.stdout.split("\n"));
    assert.deepEqual(
      now.filter((l) => !was.has(l)),
      [],
      "the list is shrink-only",
    );
  });

  test("the shim is executable in the index (mode 100755)", { skip: SKIP }, () => {
    const res = spawnSync("git", ["ls-files", "-s", "scripts/build-components.sh"], {
      cwd: REPO,
      encoding: "utf8",
    });
    assert.match(res.stdout, /^100755 /);
  });
});
