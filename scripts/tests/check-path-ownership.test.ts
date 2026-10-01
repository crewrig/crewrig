// check-path-ownership.test.ts — tests for the path-ownership check
// (spec 0147 delta-01, R11-R18 and R24, issue #1405).
//
// Two layers, both standard-library only so they run before `npm ci`:
//   - the glob engine (scripts/lib/glob-engine.ts), table-driven: it decides
//     ownership with the CI engines' semantics, not bash `[[ == ]]` (R13);
//   - the real entry point (scripts/check-path-ownership.ts), black-box, run
//     against throwaway `git init` repositories through CREWRIG_REPO_DIR. The
//     fixture holds a minimal ci/ci-capabilities.yml and the exemption lists.
//
// The entry point contract: exit 0 clean, 1 findings, 2 wiring fault. Finding
// lines read `path-ownership: <rule-id>: <path-or-entry>[:<line>]: <message>`
// with rule ids `unowned`, `empty-reason`, `stale-entry`; a redundant entry is a
// `path-ownership: note:` line that never changes the exit code; success prints
// `path-ownership: OK: evaluated <N> tracked files, owned <O>, exempt <E>`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-path-ownership.ts");
const CORE_LIST = "ci/path-ownership-exemptions.txt";
const OVERLAY = "ci/org/path-ownership-exemptions.txt";
const REFERENCE_PATH = "ci/ci-capabilities.yml";

// --- Glob engine (R13) --------------------------------------------------------

type Engine = typeof import("../lib/glob-engine.ts");

/** Loaded lazily so a missing module fails each glob test, not the whole file. */
async function engine(): Promise<Engine> {
  return await import("../lib/glob-engine.ts");
}

/** `[glob, path, expected]`: whether `glob` owns `path` under the engines' semantics. */
const MATCHES: ReadonlyArray<readonly [string, string, boolean]> = [
  // A single `*` does not cross `/` (the delta's "nested file" scenario).
  ["docs/*.md", "docs/page.md", true],
  ["docs/*.md", "docs/nested/page.md", false],
  ["*", "README.md", true],
  ["*", "docs/page.md", false],
  // `**/` matches zero or more directories, so a root-level file is owned.
  ["**/package.json", "package.json", true],
  ["**/package.json", "a/b/c/package.json", true],
  ["**/package.json", "xpackage.json", false],
  ["**/*.md", "CLAUDE.md", true],
  ["**/*.md", "docs/deep/page.md", true],
  ["a/**/b", "a/b", true],
  ["a/**/b", "a/x/y/b", true],
  ["a/**/b", "ab", false],
  ["docs/assets/**/*.png", "docs/assets/logo.png", true],
  ["docs/assets/**/*.png", "docs/assets/x/y/logo.png", true],
  ["docs/assets/**/*.png", "docs/assets/logo.jpg", false],
  // A trailing `**` is everything below; `**` alone is everything.
  ["scripts/**", "scripts/x.ts", true],
  ["scripts/**", "scripts/a/b/c.ts", true],
  ["scripts/**", "scriptsx/y.ts", false],
  ["**", "a/b/c", true],
  // Dotfiles and dot directories are matched (the GitHub filter runs with dot: true).
  ["*", ".env", true],
  ["docs/**", "docs/.hidden/x", true],
  ["**/*.md", ".github/CONTRIBUTING.md", true],
  // The glob is anchored and every regex metacharacter outside the supported forms is literal.
  ["docs/*.md", "x/docs/page.md", false],
  ["a.b", "axb", false],
  ["a$b", "a$b", true],
  ["a|b", "a|b", true],
  ["a|b", "a", false],
];

/** Syntax outside the supported forms: a loud rejection, never a wrong answer (R13, Risk 9). */
const UNSUPPORTED: readonly string[] = [
  "src/{a,b}/**",
  "src/[ab].ts",
  "src/(a|b).ts",
  // i1-F2: `?` and `+` mean different things to different engines; fail closed.
  "a?c",
  "src/?.ts",
  "a+b.txt",
  "a/b+/c",
  "!docs/**",
  "/abs/path",
  "./rel/path",
  // v2-F2: a `**` that is not a whole path segment.
  "docs/**.md",
  "a**",
  "**foo",
  "foo**/bar",
  "a/**b/c",
];

describe("glob-engine", () => {
  for (const [glob, file, expected] of MATCHES) {
    test(`${JSON.stringify(glob)} ${expected ? "owns" : "does not own"} ${JSON.stringify(file)}`, async () => {
      const { globToRegExp } = await engine();
      assert.equal(globToRegExp(glob).test(file), expected);
    });
  }

  for (const glob of UNSUPPORTED) {
    test(`${JSON.stringify(glob)} is rejected with UnsupportedGlobError`, async () => {
      const { globToRegExp, UnsupportedGlobError } = await engine();
      assert.throws(() => globToRegExp(glob), UnsupportedGlobError);
    });
  }
});

// --- Fixture repositories -------------------------------------------------------

type Tree = Record<string, string>;

interface Trigger {
  on: "pull-request" | "push" | "scheduled" | "manual";
  paths?: string[];
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** The environment minus anything that would leak the caller's git state or base ref. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "CI_BASE_REF",
    "BASE_REF",
    "CI_MERGE_REQUEST_TARGET_BRANCH_SHA",
    "CI_COMMIT_BEFORE_SHA",
    "CREWRIG_REPO_DIR",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
  ]) {
    delete env[key];
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

function git(dir: string, ...args: string[]): void {
  const res = spawnSync(
    "git",
    ["-C", dir, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args],
    { encoding: "utf8", env: cleanEnv({}) },
  );
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
}

function write(dir: string, tree: Tree): void {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** A capability list in the reference's shape; globs are JSON-quoted (valid YAML). */
function reference(caps: Record<string, Trigger[]>): string {
  const lines = ["capabilities:"];
  for (const [id, triggers] of Object.entries(caps)) {
    lines.push(`  - id: ${id}`, "    trigger:");
    for (const t of triggers) {
      lines.push(`      - on: ${t.on}`);
      if (t.on === "pull-request" || t.on === "push") lines.push("        branches: [main]");
      if (t.paths !== undefined) {
        lines.push("        paths:");
        for (const p of t.paths) lines.push(`          - ${JSON.stringify(p)}`);
      }
    }
    lines.push("    command:", '      - "true"');
  }
  return `${lines.join("\n")}\n`;
}

/** `ci/**` owns the reference and the lists; `docs/**` and `**\/package.json` are a second owner. */
const BASE_CAPS: Record<string, Trigger[]> = {
  ci: [{ on: "pull-request", paths: ["ci/**"] }],
  docs: [
    { on: "pull-request", paths: ["docs/**", "**/package.json"] },
    { on: "push", paths: ["docs/**", "**/package.json"] },
  ],
  always: [{ on: "pull-request" }, { on: "push" }],
};

/** Tracked: reference + two docs files + LICENSE exempted. N=5 (ci x2, docs/a.md, package.json, LICENSE). */
const BASE_TREE: Tree = {
  "docs/a.md": "a\n",
  "package.json": "{}\n",
  LICENSE: "license\n",
  [CORE_LIST]: "# header\nLICENSE\tlicense text, no check reads it\n",
};

interface FixtureOptions {
  caps?: Record<string, Trigger[]>;
  /** Written verbatim as the reference, overriding `caps`. */
  rawReference?: string;
  /** Written but not `git add`ed. */
  untracked?: Tree;
  /** Skip the commit: files are only staged. */
  noCommit?: boolean;
}

/** A repository holding `tree` plus the reference; `ci/path-ownership-exemptions.txt` comes from the tree. */
function repo(tree: Tree = BASE_TREE, opts: FixtureOptions = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "path-ownership-"));
  temps.push(dir);
  git(dir, "init", "-q", "-b", "main");
  const ref = opts.rawReference ?? reference(opts.caps ?? BASE_CAPS);
  write(dir, { [REFERENCE_PATH]: ref, ...tree });
  git(dir, "add", "-A");
  if (opts.noCommit !== true) git(dir, "commit", "-q", "-m", "fixture");
  if (opts.untracked) write(dir, opts.untracked);
  return dir;
}

interface Run {
  status: number | null;
  all: string;
}

/** Run the real entry point against `dir`, from a neutral working directory. */
function check(dir: string, env: Record<string, string> = {}): Run {
  const res = spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: cleanEnv({ CREWRIG_REPO_DIR: dir, ...env }),
  });
  return { status: res.status, all: `${res.stdout}${res.stderr}` };
}

const OK_LINE = /path-ownership: OK: evaluated (\d+) tracked files, owned (\d+), exempt (\d+)/;

function counts(run: Run): [number, number, number] {
  const m = OK_LINE.exec(run.all);
  assert.ok(m, `no OK line in:\n${run.all}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// --- The entry point -----------------------------------------------------------

describe("check-path-ownership: ownership (R13, R15, R18)", () => {
  test("a tree where every file is owned or exempt exits 0 and prints evaluated/owned/exempt", () => {
    const r = check(repo());
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [5, 4, 1]);
  });

  test("a new file with no owner fails, names the file and both remedies", () => {
    const file = "config/launchd/com.example.new.plist";
    const r = check(repo({ ...BASE_TREE, [file]: "plist\n" }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, new RegExp(`path-ownership: unowned: ${file.replaceAll(".", "\\.")}`));
    assert.match(r.all, /paths:/, "remedy 1: extend a capability's paths:");
    assert.match(r.all, /ci\/path-ownership-exemptions\.txt/, "remedy 2: the exemption list");
    assert.match(
      r.all,
      /github/i,
      "remedy 1 also tells the author to mirror the GitHub path filter",
    );
    assert.doesNotMatch(r.all, /path-ownership: OK/);
  });

  test("every unowned file is listed, owned files are not", () => {
    const r = check(repo({ ...BASE_TREE, "src/one.txt": "1\n", "src/two.txt": "2\n" }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: src\/one\.txt/);
    assert.match(r.all, /unowned: src\/two\.txt/);
    assert.doesNotMatch(r.all, /unowned: docs\/a\.md/);
  });

  test("declaring the glob in a capability's pull-request paths: makes the same tree pass", () => {
    const tree = { ...BASE_TREE, "config/launchd/com.example.new.plist": "plist\n" };
    assert.equal(check(repo(tree)).status, 1);
    const caps = {
      ...BASE_CAPS,
      launchd: [{ on: "pull-request" as const, paths: ["config/launchd/**"] }],
    };
    const r = check(repo(tree, { caps }));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [6, 5, 1]);
  });

  test("adding a reasoned exemption makes the same tree pass", () => {
    const tree = {
      ...BASE_TREE,
      "config/launchd/com.example.new.plist": "plist\n",
      [CORE_LIST]: "LICENSE\tlicense text\nconfig/launchd/*.plist\ttemplate, no check reads it\n",
    };
    const r = check(repo(tree));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [6, 4, 2]);
  });

  test("a single * does not own a nested file (engine semantics, not bash)", () => {
    const caps = { ...BASE_CAPS, md: [{ on: "pull-request" as const, paths: ["notes/*.md"] }] };
    const tree = { ...BASE_TREE, "notes/top.md": "t\n", "notes/nested/page.md": "n\n" };
    const r = check(repo(tree, { caps }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: notes\/nested\/page\.md/);
    assert.doesNotMatch(r.all, /unowned: notes\/top\.md/);
  });

  test("a **/ glob owns a root-level file, including the four root *.md files at the engines", () => {
    const caps = { ...BASE_CAPS, md: [{ on: "pull-request" as const, paths: ["**/*.md"] }] };
    const tree = {
      ...BASE_TREE,
      "AGENTS.org.md": "a\n",
      "CLAUDE.md": "c\n",
      "deep/dir/x.md": "x\n",
    };
    const r = check(repo(tree, { caps }));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [8, 7, 1]);
  });

  test("ownership is the union over capabilities, whatever their branches or ids", () => {
    const caps = {
      ...BASE_CAPS,
      one: [{ on: "pull-request" as const, paths: ["src/a/**"] }],
      two: [{ on: "pull-request" as const, paths: ["src/b/**"] }],
    };
    const tree = { ...BASE_TREE, "src/a/x": "x\n", "src/b/y": "y\n" };
    const r = check(repo(tree, { caps }));
    assert.equal(r.status, 0, r.all);
  });

  test("a paths: set on a push-only trigger confers no ownership", () => {
    const caps = { ...BASE_CAPS, deploy: [{ on: "push" as const, paths: ["communication/**"] }] };
    const r = check(repo({ ...BASE_TREE, "communication/index.html": "<p>\n" }, { caps }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: communication\/index\.html/);
  });

  test("a push paths: does not leak into a pull-request trigger of the same capability", () => {
    const caps = {
      ...BASE_CAPS,
      mixed: [
        { on: "pull-request" as const, paths: ["a/**"] },
        { on: "push" as const, paths: ["b/**"] },
      ],
    };
    const r = check(repo({ ...BASE_TREE, "a/x": "x\n", "b/y": "y\n" }, { caps }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: b\/y/);
    assert.doesNotMatch(r.all, /unowned: a\/x/);
  });

  test("a capability with no paths: filter runs on every change and owns nothing", () => {
    const r = check(repo({ ...BASE_TREE, "src/x.ts": "x\n" }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: src\/x\.ts/);
  });

  test("scheduled and manual triggers confer no ownership", () => {
    const caps = {
      ...BASE_CAPS,
      exhaustive: [{ on: "scheduled" as const }, { on: "manual" as const, paths: ["src/**"] }],
    };
    const r = check(repo({ ...BASE_TREE, "src/x.ts": "x\n" }, { caps }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: src\/x\.ts/);
  });

  test("only tracked files are evaluated: an untracked file is ignored", () => {
    const r = check(repo(BASE_TREE, { untracked: { "src/untracked.ts": "u\n" } }));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [5, 4, 1]);
  });

  test("paths with spaces and non-ASCII characters are evaluated verbatim", () => {
    const ok = check(repo({ ...BASE_TREE, "docs/my file é.md": "x\n" }));
    assert.equal(ok.status, 0, ok.all);
    const bad = check(repo({ ...BASE_TREE, "src/my file é.ts": "x\n" }));
    assert.equal(bad.status, 1, bad.all);
    assert.match(bad.all, /unowned: src\/my file é\.ts/);
  });
});

describe("check-path-ownership: exemption lists (R14, R16, R17, R24)", () => {
  test("an entry with an empty reason fails and names the entry", () => {
    const tree = { ...BASE_TREE, [CORE_LIST]: "LICENSE\t\n" };
    const r = check(repo(tree));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /path-ownership: empty-reason: .*LICENSE/);
  });

  test("a whitespace-only reason is empty", () => {
    const r = check(repo({ ...BASE_TREE, [CORE_LIST]: "LICENSE\t   \n" }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /empty-reason: .*LICENSE/);
  });

  test("a line without a TAB has no reason: it fails and names the entry", () => {
    const r = check(repo({ ...BASE_TREE, [CORE_LIST]: "LICENSE no tab here\n" }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /empty-reason: .*LICENSE/);
  });

  test("a stale entry (matches no tracked file) fails and names the entry", () => {
    const tree = {
      ...BASE_TREE,
      [CORE_LIST]: "LICENSE\tlicense\nremoved/file.txt\tdeleted long ago\n",
    };
    const r = check(repo(tree));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /path-ownership: stale-entry: .*removed\/file\.txt/);
    assert.doesNotMatch(r.all, /stale-entry: .*LICENSE/);
  });

  test("an entry matching only an untracked file is stale", () => {
    const tree = { ...BASE_TREE, [CORE_LIST]: "LICENSE\tlicense\nsrc/later.ts\tnot committed\n" };
    const r = check(repo(tree, { untracked: { "src/later.ts": "x\n" } }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /stale-entry: .*src\/later\.ts/);
  });

  test("an empty reason and a stale entry are two named findings in one run", () => {
    const tree = { ...BASE_TREE, [CORE_LIST]: "LICENSE\t\nremoved/file.txt\tgone\n" };
    const r = check(repo(tree));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /empty-reason: .*LICENSE/);
    assert.match(r.all, /stale-entry: .*removed\/file\.txt/);
  });

  test("a redundant entry (every match also owned) is reported without failing, and counts as owned", () => {
    const tree = {
      ...BASE_TREE,
      [CORE_LIST]: "LICENSE\tlicense\ndocs/a.md\tbelongs in paths: really\n",
    };
    const r = check(repo(tree));
    assert.equal(r.status, 0, r.all);
    assert.match(r.all, /path-ownership: note: .*docs\/a\.md/);
    assert.deepEqual(counts(r), [5, 4, 1]);
  });

  test("an exemption glob follows the engine semantics: a single * does not exempt a nested file", () => {
    const tree = {
      ...BASE_TREE,
      "config/x.template": "x\n",
      "config/sub/y.template": "y\n",
      [CORE_LIST]: "LICENSE\tlicense\nconfig/*.template\ttemplates, no check reads them\n",
    };
    const r = check(repo(tree));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: config\/sub\/y\.template/);
    assert.doesNotMatch(r.all, /unowned: config\/x\.template/);
  });

  test("two entries matching the same unowned file count it exempt once", () => {
    const tree = {
      ...BASE_TREE,
      "a/x": "x\n",
      [CORE_LIST]: "LICENSE\tl\na/*\tfirst\na/x\tsecond\n",
    };
    const r = check(repo(tree));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [6, 4, 2]);
  });

  test("blank lines and # comments are ignored", () => {
    const tree = {
      ...BASE_TREE,
      [CORE_LIST]: "\n# a comment\n\n   \nLICENSE\tlicense\n# trailing\n",
    };
    const r = check(repo(tree));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [5, 4, 1]);
  });

  test("a CRLF list is accepted: CRLF blank and comment lines are ignored", () => {
    const tree = { ...BASE_TREE, [CORE_LIST]: "# header\r\n\r\nLICENSE\tlicense\r\n\r\n# end\r\n" };
    const r = check(repo(tree));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [5, 4, 1]);
  });

  test("a CRLF line with an empty reason is still an empty reason", () => {
    const r = check(repo({ ...BASE_TREE, [CORE_LIST]: "LICENSE\t\r\n" }));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /empty-reason: .*LICENSE/);
  });

  test("a CRLF entry glob is not polluted by the carriage return", () => {
    const tree = { ...BASE_TREE, [CORE_LIST]: "LICENSE\tlicense\r\nsrc/*\tx\r\n", "src/f": "f\n" };
    const r = check(repo(tree));
    assert.equal(r.status, 0, r.all);
  });
});

describe("check-path-ownership: org overlay (R24)", () => {
  const overlayTree = (overlay: string): Tree => ({
    ...BASE_TREE,
    "AGENTS.org.md": "org\n",
    [OVERLAY]: overlay,
  });

  test("an adopter's file is exempted in the overlay with the core list untouched", () => {
    const r = check(repo(overlayTree("AGENTS.org.md\tadopter rules, no check reads them\n")));
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [7, 5, 2]);
  });

  test("without the overlay entry the same file is unowned", () => {
    const r = check(repo(overlayTree("# nothing yet\n")));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: AGENTS\.org\.md/);
  });

  test("an absent overlay is not an error", () => {
    const r = check(repo());
    assert.equal(r.status, 0, r.all);
  });

  test("the overlay follows the same hygiene rules: empty reason", () => {
    const r = check(repo(overlayTree("AGENTS.org.md\t\n")));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /empty-reason: .*AGENTS\.org\.md/);
    assert.match(r.all, /ci\/org\/path-ownership-exemptions\.txt/);
  });

  test("the overlay follows the same hygiene rules: stale entry", () => {
    const r = check(repo(overlayTree("AGENTS.org.md\torg rules\nonly-in-overlay.txt\tgone\n")));
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /stale-entry: .*only-in-overlay\.txt/);
  });

  test("the overlay may be CRLF", () => {
    const r = check(repo(overlayTree("# adopter\r\nAGENTS.org.md\torg rules\r\n")));
    assert.equal(r.status, 0, r.all);
  });
});

describe("check-path-ownership: wiring faults exit 2 (not 1)", () => {
  test("a missing reference", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "path-ownership-"));
    temps.push(dir);
    git(dir, "init", "-q", "-b", "main");
    write(dir, { "README.md": "x\n" });
    git(dir, "add", "-A");
    const r = check(dir);
    assert.equal(r.status, 2, r.all);
  });

  test("malformed YAML in the reference", () => {
    const r = check(repo(BASE_TREE, { rawReference: "capabilities: [unclosed\n  - id: x: y:\n" }));
    assert.equal(r.status, 2, r.all);
  });

  test("a reference without a capabilities list", () => {
    const r = check(repo(BASE_TREE, { rawReference: "something: else\n" }));
    assert.equal(r.status, 2, r.all);
  });

  const cases: ReadonlyArray<readonly [string, string]> = [
    ["a brace set", "src/{a,b}/**"],
    ["a character class", "src/[ab].ts"],
    ["a group", "src/(a).ts"],
    ["a question mark (i1-F2)", "src/?.ts"],
    ["a plus sign (i1-F2)", "src/a+.ts"],
    ["a negation", "!docs/**"],
    ["a leading slash", "/docs/**"],
    ["a leading ./", "./docs/**"],
    ["a ** that is not a whole segment (v2-F2): suffix", "docs/**.md"],
    ["a ** that is not a whole segment (v2-F2): prefix", "a**"],
    ["a ** that is not a whole segment (v2-F2): glued to a name", "**foo"],
  ];
  for (const [label, glob] of cases) {
    test(`${label} in a paths: set (${glob})`, () => {
      const caps = { ...BASE_CAPS, bad: [{ on: "pull-request" as const, paths: [glob] }] };
      const r = check(repo(BASE_TREE, { caps }));
      assert.equal(r.status, 2, r.all);
      assert.ok(r.all.includes(glob), `the message names the glob ${glob}:\n${r.all}`);
    });
  }

  test("an unsupported glob in the core exemption list", () => {
    const r = check(repo({ ...BASE_TREE, [CORE_LIST]: "LICENSE\tlicense\nsrc/[ab].ts\treason\n" }));
    assert.equal(r.status, 2, r.all);
  });

  test("an unsupported glob in the overlay", () => {
    const r = check(repo({ ...BASE_TREE, [OVERLAY]: "docs/**.md\treason\n" }));
    assert.equal(r.status, 2, r.all);
  });

  test("a * or ** that is a whole segment is not a fault", () => {
    const caps = {
      ...BASE_CAPS,
      ok: [
        {
          on: "pull-request" as const,
          paths: ["src/*/gen/**", "src/**/leaf.ts", "src/*.ts"],
        },
      ],
    };
    const tree = {
      ...BASE_TREE,
      "src/m/gen/a/b": "x\n",
      "src/leaf.ts": "x\n",
      "src/a.ts": "x\n",
      "src/p.ts": "x\n",
    };
    const r = check(repo(tree, { caps }));
    assert.equal(r.status, 0, r.all);
  });
});

describe("check-path-ownership: no base ref, no diff, no remote (R12)", () => {
  const GARBAGE = {
    CI_BASE_REF: "not-a-ref",
    BASE_REF: "refs/heads/does-not-exist",
    CI_COMMIT_BEFORE_SHA: "0".repeat(40),
    CI_MERGE_REQUEST_TARGET_BRANCH_SHA: "1234567890abcdef1234567890abcdef12345678",
  };

  test("the verdict and output are identical with garbage base variables (clean tree)", () => {
    const dir = repo();
    const plain = check(dir);
    const noisy = check(dir, GARBAGE);
    assert.equal(plain.status, 0, plain.all);
    assert.equal(noisy.status, plain.status);
    assert.equal(noisy.all, plain.all);
  });

  test("the verdict and output are identical with garbage base variables (findings)", () => {
    const dir = repo({ ...BASE_TREE, "src/x.ts": "x\n" });
    const plain = check(dir);
    const noisy = check(dir, GARBAGE);
    assert.equal(plain.status, 1, plain.all);
    assert.match(plain.all, /unowned: src\/x\.ts/);
    assert.equal(noisy.status, plain.status);
    assert.equal(noisy.all, plain.all);
  });

  test("a repository with no remote and a single commit is evaluated in full", () => {
    const dir = repo({ ...BASE_TREE, "src/x.ts": "x\n" });
    assert.equal(gitRemoteCount(dir), 0);
    const r = check(dir, GARBAGE);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: src\/x\.ts/);
  });

  test("a repository with no commit at all (files only staged) is evaluated in full", () => {
    const r = check(repo(BASE_TREE, { noCommit: true }), GARBAGE);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(counts(r), [5, 4, 1]);
  });

  test("a file already unowned in an old commit is still reported: nothing is diffed", () => {
    const dir = repo({ ...BASE_TREE, "src/old.ts": "x\n" });
    write(dir, { "docs/b.md": "b\n" });
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "second");
    const r = check(dir);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /unowned: src\/old\.ts/);
  });
});

function gitRemoteCount(dir: string): number {
  const res = spawnSync("git", ["-C", dir, "remote"], { encoding: "utf8", env: cleanEnv({}) });
  return res.stdout.split("\n").filter((l) => l.trim() !== "").length;
}
