// build-components-cli-config.test.ts — R7 (configuration grammar, placeholders, canonical_repo)
// of spec 0250 over scripts/lib/build-components/config.ts, and the shell-parity sets of R5
// and R7.
//
// R7's key rule follows the SHELL, not the spec text: the shell took the upper-cased key as the
// tail of `CFG_<KEY>`, so `[A-Za-z0-9_]+` is accepted (`1a = z` builds) where R7 writes
// `[A-Za-z_][A-Za-z0-9_]*`. That spec/shell gap is asserted here as the shell behaves. The twin
// also rejects an array-subscript key (`a[0] = z`) that the shell accepts: a listed small
// difference, asserted as documented. The parity sets need bash and mikefarah yq, run on Linux
// or with CREWRIG_SHELL_PARITY=1, and skip visibly otherwise. The shell functions are read out
// of scripts/build-components.sh itself (awk), never copied.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { parseArgs } from "../lib/build-components/args.ts";
import {
  loadConfig,
  resolvePlaceholders,
  validateCanonicalRepo,
} from "../lib/build-components/config.ts";
import { outputDirLines } from "../lib/build-components/output-dirs.ts";
import { escapeControl } from "../lib/escape-control.ts";
import { BuildFailure, type Config, type Io } from "../lib/build-components/types.ts";
import {
  CONFIG_TEXTS,
  INVALID_REPOS,
  LISTING_TARGETS,
  LISTING_TIER_FORMS,
  VALID_REPOS,
} from "./fixtures/build-components/config-cases.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const temps: string[] = [];
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tmpDir = (): string => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bc-config-")));
  temps.push(dir);
  return dir;
};

interface Loaded {
  readonly config: Config;
  readonly warnings: string[];
}
/** `loadConfig` over a file holding `text` (or no file when `text` is null). */
function load(text: string | null, repoDirSuffix = ""): Loaded {
  const dir = tmpDir();
  if (text !== null) fs.writeFileSync(path.join(dir, "crewrig.config.toml"), text);
  const warnings: string[] = [];
  const io: Io = { out: () => {}, err: (l) => warnings.push(l), errRaw: () => {} };
  return { config: loadConfig(dir + repoDirSuffix, "linux", io), warnings };
}
const pairs = (text: string): string[] =>
  load(text).config.placeholders.map((p) => `${p.key}=${p.value}`);

describe("R7 grammar", () => {
  test("key = value lines; keys are upper-cased; the value loses its surrounding quotes", () => {
    assert.deepEqual(pairs('a = 1\nb = "two"\nc=3\n  d   =   "four"  \n'), [
      "A=1",
      "B=two",
      "C=3",
      "D=four",
    ]);
  });

  test("a last line with no line terminator is not read", () => {
    assert.deepEqual(pairs("a = 1\nb = 2"), ["A=1"]);
    assert.deepEqual(pairs("a = 1"), []);
  });

  test("CRLF and LF files parse alike", () => {
    assert.deepEqual(pairs('a = "x"\r\nb = y\r\n'), ["A=x", "B=y"]);
    assert.deepEqual(pairs("a = 1\r\nb = 2\r\n"), pairs("a = 1\nb = 2\n"));
  });

  test("the line splits at the first =: k = v=w= keeps the rest", () => {
    assert.deepEqual(pairs("k = v=w=\n"), ["K=v=w="]);
  });

  test("trailing quote then whitespace: abc-quote-space is abc, abc-space-quote keeps its space", () => {
    assert.deepEqual(pairs('k = abc" \n'), ["K=abc"]);
    assert.deepEqual(pairs('k = abc "\n'), ["K=abc "]);
    assert.deepEqual(pairs('k = ""\nj = "\nl = \t x \t\n'), ["K=", "J=", "L=x"]);
  });

  test("a repeated key keeps its last value and stays in the list once per line", () => {
    const { config } = load("a = 1\nb = 2\na = 3\n");
    assert.deepEqual(
      config.placeholders.map((p) => `${p.key}=${p.value}`),
      ["A=3", "B=2", "A=3"],
    );
    assert.equal(resolvePlaceholders(config, "${A}${B}"), "32");
  });

  test("a line without = registers an empty placeholder; blanks inside a key are removed", () => {
    assert.deepEqual(pairs("foo\n  my key  \n"), ["FOO=", "MYKEY="]);
  });

  test("comments, blank lines and an empty key are skipped", () => {
    assert.deepEqual(pairs("# a = 1\n   # b = 2\n\n   \n = 3\nc = 4\n"), ["C=4"]);
    assert.deepEqual(pairs(""), []);
  });

  test("a key that is not a placeholder name exits 1 and names the line and the key", () => {
    for (const bad of ["[table]", "my-key", "a.b", "a b-c", "k$"]) {
      assert.throws(
        () => load(`ok = 1\n${bad} = v\n`),
        (e: unknown) =>
          e instanceof BuildFailure &&
          e.exitCode === 1 &&
          e.message.startsWith("Error:") &&
          e.message.includes("line 2") &&
          e.message.includes(`'${bad.replace(/\s/g, "")}'`),
        bad,
      );
    }
  });

  test("the shell's key rule, not R7's regex: a digit-first key is accepted (spec/shell gap)", () => {
    assert.deepEqual(pairs("1a = z\n_b = y\n"), ["1A=z", "_B=y"]);
  });

  test("an array-subscript key is rejected here; the shell accepted it (listed difference)", () => {
    assert.throws(() => load("a[0] = z\n"), BuildFailure);
  });

  test("canonical_repo is read from the file, last value winning", () => {
    assert.equal(load('canonical_repo = "https://h/o/r"\n').config.canonicalRepo, "https://h/o/r");
    assert.equal(load("canonical_repo = x\ncanonical_repo = y\n").config.canonicalRepo, "y");
    assert.equal(load("a = 1\n").config.canonicalRepo, "");
  });

  test("a missing file warns on standard error and continues with no placeholder", () => {
    const loaded = load(null);
    assert.deepEqual(loaded.config, { placeholders: [], canonicalRepo: "" });
    assert.equal(loaded.warnings.length, 1);
    assert.match(
      loaded.warnings[0] ?? "",
      /^Warning: .*crewrig\.config\.toml not found — placeholders will be left literal\.$/,
    );
  });

  test("REPO_DIR is joined verbatim: a trailing slash shows in the warning path", () => {
    const loaded = load(null, "/");
    assert.match(loaded.warnings[0] ?? "", /bc-config-[^/]+\/\/crewrig\.config\.toml not found/);
  });

  test("a directory named crewrig.config.toml counts as missing, as [ -f ] did", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "crewrig.config.toml"));
    const warnings: string[] = [];
    loadConfig(dir, "linux", { out: () => {}, err: (l) => warnings.push(l), errRaw: () => {} });
    assert.equal(warnings.length, 1);
  });
});

const config = (...entries: [string, string][]): Config => ({
  placeholders: entries.map(([key, value]) => ({ key, value })),
  canonicalRepo: "",
});

describe("R7 placeholders", () => {
  test("every occurrence is replaced, literally: no character of a value is special", () => {
    const value = "a&b|c\\1$&$1\\\\ ${X}";
    assert.equal(resolvePlaceholders(config(["K", value]), "<${K}>${K}"), `<${value}>${value}`);
  });

  test("keys are substituted one after another in file order", () => {
    assert.equal(resolvePlaceholders(config(["A", "${B}"], ["B", "X"]), "${A}"), "X");
    assert.equal(resolvePlaceholders(config(["B", "X"], ["A", "${B}"]), "${A}"), "${B}");
  });

  test("only ${KEY} in upper case, with braces, is a placeholder", () => {
    const c = config(["K", "v"]);
    assert.equal(
      resolvePlaceholders(c, "${k} $K ${K ${ K} ${KK} ${K}"),
      "${k} $K ${K ${ K} ${KK} v",
    );
  });

  test("an unknown placeholder and an empty config leave the text alone", () => {
    assert.equal(resolvePlaceholders(config(), "${X}"), "${X}");
  });
});

const MALFORMED = "Error: canonical_repo in crewrig.config.toml is malformed: '";
const EXPECTED = "Expected: https://<host>/<owner>/<repo> (no deeper path, no file:// scheme)";
const withRepo = (canonicalRepo: string): Config => ({ placeholders: [], canonicalRepo });

describe("R7 canonical_repo", () => {
  test("absent, empty and well-formed values pass", () => {
    for (const repo of VALID_REPOS)
      assert.doesNotThrow(() => validateCanonicalRepo(withRepo(repo)), repo);
  });

  test("anything else exits 1 with the two-line message", () => {
    for (const repo of INVALID_REPOS) {
      assert.throws(
        () => validateCanonicalRepo(withRepo(repo)),
        (e: unknown) =>
          e instanceof BuildFailure &&
          e.exitCode === 1 &&
          e.message === `${MALFORMED}${escapeControl(repo)}'\n${EXPECTED}`,
        JSON.stringify(repo),
      );
    }
  });
});

const noShell = parityGate();
const SCRIPT = path.join(REPO, "scripts", "build-components.sh");
/** The shell's three config functions, read out of the oracle, run in a strict shell. */
const DRIVER = `set -euo pipefail
eval "$(awk '/^(load_crewrig_config|resolve_placeholders|validate_canonical_repo)\\(\\) \\{/,/^\\}/' "$1")"
CFG_KEYS=""
load_crewrig_config
[ "$2" = validate ] && validate_canonical_repo
content="$(cat)"; resolve_placeholders "$content"; echo; echo "KEYS:[$CFG_KEYS]"`;
function shell(
  toml: string,
  mode: string,
): { status: number | null; stdout: string; stderr: string } {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "crewrig.config.toml"), toml);
  return spawnSync("bash", ["-c", DRIVER, "bash", SCRIPT, mode], {
    input: "${A}|${B}|${C}|${K}|${KEY}|${CANONICAL_REPO}",
    encoding: "utf8",
    env: { ...process.env, REPO_DIR: dir, LC_ALL: "C" },
  });
}

describe("shell parity: configuration", { skip: noShell ?? false }, () => {
  test("placeholder resolution and registered keys equal the shell's", () => {
    for (const toml of CONFIG_TEXTS) {
      const sh = shell(toml, "load");
      assert.equal(sh.status, 0, JSON.stringify(toml));
      const { config: c } = load(toml);
      const keys = c.placeholders.map((p) => ` ${p.key}`).join("");
      const text = `${resolvePlaceholders(c, "${A}|${B}|${C}|${K}|${KEY}|${CANONICAL_REPO}")}\nKEYS:[${keys}]\n`;
      assert.equal(text, sh.stdout, JSON.stringify(toml));
    }
  });

  test("a key that is not an identifier aborts the shell, and fails the build with status 1", () => {
    for (const toml of ["[table]\na = 1\n", "my-key = 1\n", "a.b = 1\n"]) {
      assert.notEqual(shell(toml, "load").status, 0, JSON.stringify(toml));
      assert.throws(() => load(toml), { exitCode: 1 });
    }
  });

  test("the listed difference: the shell accepts a[0] = z", () => {
    assert.equal(shell("a[0] = z\n", "load").status, 0);
  });

  test("canonical_repo validation: same verdict and the same two lines on standard error", () => {
    for (const repo of [...VALID_REPOS, ...INVALID_REPOS]) {
      const sh = shell(`canonical_repo = ${repo}\n`, "validate");
      const c = load(`canonical_repo = ${repo}\n`).config;
      let twin = "";
      try {
        validateCanonicalRepo(c);
      } catch (e) {
        twin = `${(e as Error).message}\n`;
      }
      assert.equal(twin, sh.stderr, JSON.stringify(repo));
      assert.equal(sh.status === 0, twin === "", JSON.stringify(repo));
    }
  });
});

describe("shell parity: --list-output-dirs", { skip: noShell ?? false }, () => {
  for (const target of LISTING_TARGETS) {
    test(`--target ${JSON.stringify(target)} under every tier form`, () => {
      const dir = tmpDir();
      for (const tierArgs of LISTING_TIER_FORMS) {
        const args = ["--list-output-dirs", "--target", target, ...tierArgs];
        const sh = spawnSync("bash", [SCRIPT, ...args], {
          encoding: "utf8",
          env: { ...process.env, REPO_DIR: dir, LC_ALL: "C" },
        });
        const parsed = parseArgs(args);
        assert.ok(parsed.ok);
        assert.equal(sh.status, 0, `${JSON.stringify(args)}: ${sh.stderr}`);
        assert.equal(
          `${outputDirLines(parsed.opts).join("\n")}\n`,
          sh.stdout,
          JSON.stringify(args),
        );
      }
    });
  }
});
