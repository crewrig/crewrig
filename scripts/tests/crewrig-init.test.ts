// crewrig-init.test.ts — `crewrig init` and the exit wrapper of the framework entry point
// (spec 0314 R10, R14-R17 and R20, as amended by delta-01; spec 0288 R27).
//
// The entry point scripts/crewrig-cli.ts runs from the checkout, which is what the launcher runs from a
// verified version: its templates and catalogs are read from the root above it. The launcher is not
// involved here (crewrig-init-e2e.test.ts runs the two together). Every case runs in a fresh template
// copy under a temporary HOME, with GIT_* scrubbed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { resolveManifest } from "../lib/framework-release/manifest.ts";
import {
  CANONICAL_REPO,
  assertScaffold,
  git,
  runInit,
  templateOnlyDir,
  withOrigin,
} from "./lib/init-scaffold.ts";
import {
  ENTRY_POINT,
  NO_TYPELESS_WARNING,
  REPO,
  runNode,
  snapshot,
  testManifestEntries,
  trackRigs,
  treeList,
  type Rig,
  type RunResult,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const FEEDBACK = "https://github.com/acme/crewrig-config";

/** What the output may legitimately repeat of a rejected value: the fixed usage text. */
function echoes(out: string, value: string): boolean {
  return out.split("https://<host>/<owner>/<repo>").join("").includes(value);
}

/** A refused run writes, changes and deletes nothing in the directory, nor under the home. */
async function assertRefusal(
  rig: Rig,
  dir: string,
  args: readonly string[],
  expected: number,
  options: { env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  const before = snapshot(rig.root);

  const run = await runInit(rig, dir, args, options);

  assert.equal(run.code, expected, run.out);
  assert.deepEqual(snapshot(rig.root), before, "nothing is written, changed or deleted");
  return run;
}

describe("R15-R17: a successful init", () => {
  test("creates exactly the scaffold, with crewrig.config.toml as the build reads it", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    const rootBefore = treeList(rig.root).filter((line) => !line.startsWith("org-1/"));

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK]);

    assert.equal(run.code, 0, run.out);
    assertScaffold(dir, FEEDBACK);
    assert.deepEqual(
      treeList(rig.root).filter((line) => !line.startsWith("org-1/")),
      rootBefore,
      "nothing is written outside the working directory",
    );
  });

  test("accepts exactly the files the template and the forge create (scenario)", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    fs.rmSync(path.join(dir, "crewrig.pin.json"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, "LICENSE"), "licence text\n");

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK]);

    assert.equal(run.code, 0, run.out);
    assertScaffold(dir, FEEDBACK, { template: ["README.md", "crewrig", "LICENSE"] });
    assert.equal(fs.readFileSync(path.join(dir, "LICENSE"), "utf8"), "licence text\n");
  });

  test("leaves an existing .gitignore as it is and adds no entry to it (R17)", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK]);

    assert.equal(run.code, 0, run.out);
    assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), "node_modules\n");
    assert.ok(!fs.existsSync(path.join(dir, "config", "SOUL.md")));
    assert.ok(!fs.existsSync(path.join(dir, "config", "PROFILE.md")));
  });

  test("writes nothing under the home directory", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK]);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(snapshot(rig.home), []);
  });

  test("a second init is refused: init runs once", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    await runInit(rig, dir, ["--feedback-repo", FEEDBACK]);
    const before = snapshot(dir);

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK]);

    assert.equal(run.code, 1, run.out);
    assert.deepEqual(snapshot(dir), before);
  });
});

describe("R14: the two refusals exit 1 and write nothing", () => {
  test("an existing crewrig.config.toml is named, and init runs once", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    fs.writeFileSync(path.join(dir, "crewrig.config.toml"), "# mine\n");

    const run = await assertRefusal(rig, dir, ["--feedback-repo", FEEDBACK], 1);

    assert.match(run.out, /crewrig\.config\.toml/);
    assert.match(run.out, /runs once/);
    assert.equal(fs.readFileSync(path.join(dir, "crewrig.config.toml"), "utf8"), "# mine\n");
  });

  test("the first entry other than the template's, in ascending byte order, is named", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    for (const name of ["notes.txt", "a.txt"]) fs.writeFileSync(path.join(dir, name), name);

    const run = await assertRefusal(rig, dir, ["--feedback-repo", FEEDBACK], 1);

    assert.match(run.out, /"a\.txt"/);
    assert.ok(!run.out.includes("notes.txt"));
    assert.match(run.out, /runs once/);
  });

  test("byte order puts B before a, and z before é", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    for (const name of ["a.txt", "B.txt"]) fs.writeFileSync(path.join(dir, name), name);
    const other = templateOnlyDir(rig);
    for (const name of ["é", "z"]) fs.writeFileSync(path.join(other, name), name);

    const upper = await assertRefusal(rig, dir, ["--feedback-repo", FEEDBACK], 1);
    const accent = await assertRefusal(rig, other, ["--feedback-repo", FEEDBACK], 1);

    assert.match(upper.out, /"B\.txt"/);
    assert.match(accent.out, /"z"/);
  });

  for (const entry of [
    "src",
    ".env",
    "package.json",
    "config",
    "artifacts",
    "crewrig.pin.json.bak",
  ]) {
    test(`the entry ${entry} is not part of the template`, async () => {
      const rig = rigs.make();
      const dir = templateOnlyDir(rig);
      if (entry === "src" || entry === "config" || entry === "artifacts")
        fs.mkdirSync(path.join(dir, entry));
      else fs.writeFileSync(path.join(dir, entry), "x");

      const run = await assertRefusal(rig, dir, ["--feedback-repo", FEEDBACK], 1);

      assert.ok(run.out.includes(JSON.stringify(entry)), run.out);
    });
  }

  test("the refusals are decided before git is consulted, and an existing config beats a stray entry", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    fs.writeFileSync(path.join(dir, "crewrig.config.toml"), "# mine\n");
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    const noGit = fs.mkdtempSync(path.join(rig.root, "no-git-"));
    const env = { PATH: noGit, Path: noGit };

    const withConfig = await assertRefusal(rig, dir, [], 1, { env });
    fs.rmSync(path.join(dir, "crewrig.config.toml"));
    const withEntry = await assertRefusal(rig, dir, [], 1, { env });

    assert.match(withConfig.out, /crewrig\.config\.toml/);
    assert.match(withEntry.out, /"a\.txt"/);
  });

  test("a usage error is decided first: code 2 even where the directory would be refused", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    fs.writeFileSync(path.join(dir, "crewrig.config.toml"), "# mine\n");

    await assertRefusal(rig, dir, ["--bogus"], 2);
  });
});

describe("R14: a usage error exits 2 and writes nothing", () => {
  const usage: Array<[string, string[]]> = [
    ["an unknown option", ["--bogus"]],
    ["an unknown option beside a valid one", ["--feedback-repo", FEEDBACK, "--bogus"]],
    ["a missing option value", ["--feedback-repo"]],
    ["the equals form, which is an unknown option", [`--feedback-repo=${FEEDBACK}`]],
    ["a positional argument", ["extra"]],
    ["a short option", ["-f", FEEDBACK]],
  ];
  for (const [name, args] of usage) {
    test(name, async () => {
      const rig = rigs.make();
      const dir = templateOnlyDir(rig);

      await assertRefusal(rig, dir, args, 2);
    });
  }

  test("no command, and an unknown command, are the entry point's own errors with code 2", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    const before = snapshot(rig.root);

    const none = await runNode(rig, ENTRY_POINT, [], { cwd: dir, nodeArgs: [NO_TYPELESS_WARNING] });
    const unknown = await runNode(rig, ENTRY_POINT, ["no-such-command", "--x"], {
      cwd: dir,
      nodeArgs: [NO_TYPELESS_WARNING],
    });

    assert.equal(none.code, 2, none.out);
    assert.match(none.out, /usage|command/i);
    assert.equal(unknown.code, 2, unknown.out);
    assert.match(unknown.out, /no-such-command/);
    assert.deepEqual(snapshot(rig.root), before);
  });
});

/** Values that are no repository URL: R19's rejected-input table and the delta-01 shapes. */
const REJECTED_REPOSITORIES = [
  "ftp://h",
  "https://",
  "https://u:p@h/x",
  "https://h/a b",
  'https://h/"',
  "https://h/a\\b",
  "https://h/r?x=1",
  "https://h/r#f",
  "https://h/a\nb",
  "https://github.com/acme/cfg\n",
  "not a url",
  "https://github.com",
  "https://github.com/",
  "https://github.com/acme",
  "https://github.com/acme/cfg/sub",
  "http://github.com/acme/cfg",
  "https://h",
  "https://h/a",
  "https://h/a/b/c",
  "https://github.com/acme/cfg//",
  "https://github.com/acme/cfg?x=1",
  "git@github.com:acme/cfg.git",
  "ssh://git@github.com/acme/cfg.git",
  "file:///srv/git/cfg",
  "/srv/git/cfg",
  "",
];

describe("R14: --feedback-repo takes a repository URL only", () => {
  for (const value of REJECTED_REPOSITORIES) {
    test(`${JSON.stringify(value)} exits 2 with nothing written and the value never printed`, async () => {
      const rig = rigs.make();
      const dir = templateOnlyDir(rig);

      const run = await assertRefusal(rig, dir, ["--feedback-repo", value], 2);

      assert.ok(value === "" || !echoes(run.out, value), `the value is echoed: ${run.out}`);
    });
  }

  const accepted: Array<[string, string, string]> = [
    ["a repository URL", FEEDBACK, FEEDBACK],
    [
      "a value with .git/ (the / goes first, then .git)",
      "https://github.com/acme/cfg.git/",
      "https://github.com/acme/cfg",
    ],
    ["a value with .git", "https://github.com/acme/cfg.git", "https://github.com/acme/cfg"],
    [
      "a value with a trailing slash",
      "https://github.com/acme/cfg/",
      "https://github.com/acme/cfg",
    ],
    [
      "only one .git suffix is removed",
      "https://github.com/acme/cfg.git.git",
      "https://github.com/acme/cfg.git",
    ],
    [
      "another host, with its case kept",
      "https://Git.Example.com/Acme/Cfg",
      "https://Git.Example.com/Acme/Cfg",
    ],
    ["canonical_repo, a conscious choice", CANONICAL_REPO, CANONICAL_REPO],
    ["canonical_repo with .git/", `${CANONICAL_REPO}.git/`, CANONICAL_REPO],
  ];
  for (const [name, value, written] of accepted) {
    test(`accepts ${name}`, async () => {
      const rig = rigs.make();
      const dir = templateOnlyDir(rig);

      const run = await runInit(rig, dir, ["--feedback-repo", value]);

      assert.equal(run.code, 0, run.out);
      assertScaffold(dir, written);
    });
  }

  test("an explicit value beats the origin, and git is not consulted", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    withOrigin(rig, dir, CANONICAL_REPO);
    const noGit = fs.mkdtempSync(path.join(rig.root, "no-git-"));

    const run = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], {
      env: { PATH: noGit, Path: noGit },
    });

    assert.equal(run.code, 0, run.out);
    assertScaffold(dir, FEEDBACK);
  });
});

describe("R14: feedback_repo from the origin remote", () => {
  const accepted: Array<[string, string, string]> = [
    ["a repository URL", FEEDBACK, FEEDBACK],
    ["a URL with .git/", "https://github.com/acme/cfg.git/", "https://github.com/acme/cfg"],
    [
      "a URL on another host",
      "https://gitlab.example.com/acme/cfg",
      "https://gitlab.example.com/acme/cfg",
    ],
    [
      "a similar name that is not canonical_repo",
      "https://github.com/crewrig/crewrig-config",
      "https://github.com/crewrig/crewrig-config",
    ],
    [
      "an scp-style GitHub origin with .git (converted)",
      "git@github.com:acme/cfg.git",
      "https://github.com/acme/cfg",
    ],
    [
      "an scp-style GitHub origin without .git (converted)",
      "git@github.com:acme/cfg",
      "https://github.com/acme/cfg",
    ],
    [
      "an origin whose output ends with CRLF",
      "https://github.com/acme/cfg\r",
      "https://github.com/acme/cfg",
    ],
  ];
  for (const [name, origin, written] of accepted) {
    test(`${name} is written as ${written}`, async () => {
      const rig = rigs.make();
      const dir = templateOnlyDir(rig);
      withOrigin(rig, dir, origin);

      const run = await runInit(rig, dir);

      assert.equal(run.code, 0, run.out);
      assertScaffold(dir, written);
    });
  }

  const refused: Array<[string, string]> = [
    ["canonical_repo", "https://github.com/crewrig/crewrig"],
    ["canonical_repo with .git", "https://github.com/crewrig/crewrig.git"],
    ["canonical_repo with a trailing slash", "https://github.com/crewrig/crewrig/"],
    ["canonical_repo with .git/", "https://github.com/crewrig/crewrig.git/"],
    ["canonical_repo with an upper-case scheme and host", "HTTPS://GitHub.com/crewrig/crewrig"],
    [
      "canonical_repo with an upper-case scheme and host, .git/",
      "HTTPS://GitHub.com/crewrig/crewrig.git/",
    ],
    ["canonical_repo over http", "http://github.com/crewrig/crewrig"],
    ["canonical_repo on www.github.com in any case", "https://www.github.com/CrewRig/CrewRig"],
    ["canonical_repo in scp style", "git@github.com:crewrig/crewrig.git"],
    ["canonical_repo in scp style, any case", "git@github.com:CrewRig/CrewRig"],
    ["credentials with a password", "https://user:s3cret@github.com/acme/cfg"],
    ["credentials with a token", "https://tok3n@github.com/acme/cfg"],
    ["a bare host", "https://github.com"],
    ["a deeper path", "https://github.com/acme/cfg/sub"],
    ["the scheme http", "http://github.com/acme/cfg"],
    ["an scp-style repository with a slash in the name", "git@github.com:acme/team/cfg.git"],
    ["an scp-style repository with an empty name", "git@github.com:acme/"],
    ["an scp-style repository with an empty owner", "git@github.com:/cfg"],
    ["an scp-style form on another host", "git@gitlab.com:acme/cfg.git"],
    ["an ssh URL", "ssh://git@github.com/acme/cfg.git"],
    ["a query string", "https://github.com/acme/cfg?x=1"],
    ["a trailing space (other whitespace is not removed)", "https://github.com/acme/cfg "],
    ["a local path", "/srv/git/cfg"],
    ["a file URL", "file:///srv/git/cfg"],
  ];
  for (const [name, origin] of refused) {
    test(`${name} is treated as absent: code 2 asking for --feedback-repo`, async () => {
      const rig = rigs.make();
      const dir = templateOnlyDir(rig);
      withOrigin(rig, dir, origin);

      const run = await assertRefusal(rig, dir, [], 2);

      assert.match(run.out, /--feedback-repo/);
      assert.ok(!/s3cret|tok3n/.test(run.out), `a credential is printed: ${run.out}`);
    });
  }

  test("no git repository is absent", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);

    const run = await assertRefusal(rig, dir, [], 2);

    assert.match(run.out, /--feedback-repo/);
  });

  test("a repository with no origin is absent, even with another remote", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    git(rig, dir, ["init", "-q"]);
    git(rig, dir, ["remote", "add", "upstream", FEEDBACK]);

    await assertRefusal(rig, dir, [], 2);
  });

  test("a failing git command (a .git that is not a repository) is absent", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    fs.mkdirSync(path.join(dir, ".git"));

    await assertRefusal(rig, dir, [], 2);
  });

  test("git not installed is absent", async () => {
    const rig = rigs.make();
    const dir = templateOnlyDir(rig);
    withOrigin(rig, dir, FEEDBACK);
    const noGit = fs.mkdtempSync(path.join(rig.root, "no-git-"));

    const run = await assertRefusal(rig, dir, [], 2, { env: { PATH: noGit, Path: noGit } });

    assert.match(run.out, /--feedback-repo/);
  });
});

/** The entry point with the files of manifest.txt only, in a directory the test may spoil. */
function copyVersionRoot(rig: Rig): string {
  const root = rig.newDir("version");
  for (const file of resolveManifest(REPO, testManifestEntries())) {
    const target = path.join(root, ...file.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.abs, target);
  }
  return path.join(root, "scripts", "crewrig-cli.ts");
}

describe("R20: a failure of init leaves nothing behind", () => {
  test("an incomplete version fails before the first write with code 1, and a rerun succeeds", async () => {
    const rig = rigs.make();
    const entry = copyVersionRoot(rig);
    const template = path.join(entry, "..", "..", "config", "TOOLS.md.template");
    const kept = fs.readFileSync(template);
    fs.rmSync(template);
    const dir = templateOnlyDir(rig);
    const before = snapshot(dir);

    const failed = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], { entry });
    const afterFailure = snapshot(dir);
    fs.writeFileSync(template, kept);
    const again = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], { entry });

    assert.equal(failed.code, 1, failed.out);
    assert.deepEqual(afterFailure, before, "nothing is created");
    assert.equal(again.code, 0, again.out);
    assertScaffold(dir, FEEDBACK, { source: path.join(entry, "..", "..") });
  });

  test("a write failure midway removes everything this run created, and a rerun is a first run", async (t) => {
    const rig = rigs.make();
    const entry = copyVersionRoot(rig);
    const level = path.join(entry, "..", "..", "config", "level");
    const names = fs
      .readdirSync(level)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const last = path.join(level, names[names.length - 1] ?? "");
    const mode = fs.statSync(last).mode;
    fs.chmodSync(last, 0o000);
    try {
      try {
        fs.readFileSync(last);
        t.skip(
          `a file with mode 000 is still readable here (root or Windows), so no write can be made to fail`,
        );
        return;
      } catch {
        // unreadable, as the case needs
      }
      const dir = templateOnlyDir(rig);
      const before = snapshot(dir);

      const failed = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], { entry });

      assert.equal(failed.code, 1, failed.out);
      assert.ok(failed.out.length > 0);
      assert.deepEqual(snapshot(dir), before, "every file and directory of the run is removed");
      assert.ok(
        !fs.existsSync(path.join(dir, "crewrig.config.toml")),
        "the config is written last, so it was never there",
      );

      fs.chmodSync(last, mode);
      const again = await runInit(rig, dir, ["--feedback-repo", FEEDBACK], { entry });

      assert.equal(again.code, 0, again.out);
      assertScaffold(dir, FEEDBACK, { source: path.join(entry, "..", "..") });
    } finally {
      fs.chmodSync(last, mode);
    }
  });
});

describe("R10: the exit wrapper of the entry point (plan v3-F3)", () => {
  /** Run `runEntry` from scripts/lib/crewrig-cli/exit.ts around `body`, in a child process. */
  async function wrapped(body: string): Promise<RunResult> {
    const rig = rigs.make();
    const script = path.join(rig.newDir("wrapper"), "run.mjs");
    const exit = pathToFileURL(path.join(REPO, "scripts", "lib", "crewrig-cli", "exit.ts")).href;
    fs.writeFileSync(
      script,
      `import { runEntry } from ${JSON.stringify(exit)};\nrunEntry(${body});\n`,
    );
    return runNode(rig, script, [], { nodeArgs: [NO_TYPELESS_WARNING], timeoutMs: 20_000 });
  }

  test("a main that throws exits 1, and says why", async () => {
    const run = await wrapped("() => { throw new Error('boom'); }");

    assert.equal(run.code, 1, run.out);
    assert.match(run.stderr, /boom/);
  });

  test("a main that rejects exits 1", async () => {
    const run = await wrapped("async () => { throw new Error('later'); }");

    assert.equal(run.code, 1, run.out);
    assert.match(run.stderr, /later/);
  });

  test("a main that never settles exits 1, not 0 and not 13", async () => {
    const run = await wrapped("() => new Promise(() => {})");

    assert.equal(run.code, 1, run.out);
  });

  for (const code of [0, 2, 3]) {
    test(`a main that resolves ${code} exits ${code}`, async () => {
      const run = await wrapped(`async () => ${code}`);

      assert.equal(run.code, code, run.out);
    });
  }
});
