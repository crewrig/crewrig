// skill-scripts-cases-reviewer-lint.ts — the case tables of `pr-reviewer/lint-json`,
// `lint-markdown` and `lint-python` (spec 0258 R28, plan step 8). The tools a script may reach are
// only what a case links in (`tools`) or stubs: `jq` is linked on purpose, absent otherwise.

import type { SkillCase } from "./skill-scripts-observe.ts";

const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;
const crlf = (text: string): string => text.replaceAll("\n", "\r\n");

// ---------------------------------------------------------------------------------- lint-json

const JSON_ID = "pr-reviewer/lint-json";
type Rest = Omit<SkillCase, "name" | "script">;
const json = (name: string, c: Rest): SkillCase => ({ name, script: JSON_ID, tools: ["jq"], ...c });
/** One file `f.json` holding `body`, linted with jq present. */
const jf = (name: string, body: string): SkillCase =>
  json(name, { args: ["f.json"], files: { "f.json": body } });
/** The same with jq absent: the heuristic alone. */
const jfNoJq = (name: string, body: string): SkillCase => ({
  name,
  script: JSON_ID,
  args: ["f.json"],
  files: { "f.json": body },
});

export const LINT_JSON: readonly SkillCase[] = [
  jf("valid", '{"a":1,"b":[1,2]}\n'),
  jf("invalid-missing-value", '{"a":}\n'),
  jf("invalid-unterminated", '{"a":1\n'),
  jf("invalid-multiline", lines("{", '  "a": 1', '  "b": ', "}")),
  jf("invalid-bare-word", "hello\n"),
  jf("invalid-single-quotes", "{'a':1}\n"),

  // the trailing-comma heuristic: `grep -nE ',\s*[}\]]'`, one line at a time
  jf("comma-array", "[1,2,]\n"),
  jf("comma-object", '{"a":1,}\n'),
  jf("comma-brace-bracket", '[{"a":1,}]\n'),
  jf("comma-brace-bracket-spaced", '[{"a":1, }]\n'),
  jf("comma-brace-bracket-twice", lines('[{"a":1,}]', "[{},]", '[{"b":2,}]')),
  jf("comma-backslash-bracket", '{"a":"x,\\]"}\n'),
  jf("comma-backslash-bracket-spaced", '{"a":"x, \\]"}\n'),
  jf("comma-brace-bracket-in-string", '{"a":",}]"}\n'),
  jf("comma-brace-bracket-crlf", crlf('[{"a":1,}]\n')),
  jf("comma-space-bracket", "[1, ]\n"),
  jf("comma-space-brace", '{"a":1, }\n'),
  jf("comma-tab-bracket", "[1,\t]\n"),
  jf("comma-then-newline-bracket", "[1,\n]\n"),
  jf("comma-nested-and-twice", lines("[", "[1,],", "[2,]", "]")),
  jf("comma-in-string-valid-json", '{"a":",]"}\n'),
  jf("comma-in-string-brace", '{"a":", }"}\n'),
  jf("comma-with-crlf", crlf('[1,]\n{"a":1}\n')),
  jf("comma-last-line-unterminated", "[1,]"),
  jf("comma-nul-byte", "[1,]\u0000\n"),

  // what jq accepts
  jf("empty-file", ""),
  jf("blank-lines-only", "\n\n"),
  jf("two-top-level-values", '{"a":1}\n{"b":2}\n'),
  jf("nan-literal", "nan\n"),
  jf("nan-in-array", "[nan]\n"),
  jf("bom-prefixed", `\u00ef\u00bb\u00bf{"a":1}\n`),
  jf("crlf-valid", crlf('{\n"a":1\n}\n')),
  jf("scalar-top-level", "42\n"),
  jf("big-number", "1e999\n"),

  // arguments
  json("two-files-in-order", {
    args: ["bad.json", "ok.json", "bad2.json"],
    files: { "bad.json": "[1,]\n", "ok.json": "[1]\n", "bad2.json": '{"a":}\n' },
  }),
  json("missing-file", { args: ["missing.json"] }),
  json("directory-argument", { args: ["d"], dirs: ["d"] }),
  json("empty-argument", { args: [""] }),
  json("dash-argument", { args: ["-"] }),
  json("spaces-in-path", { args: ["my file.json"], files: { "my file.json": "[1,]\n" } }),
  json("symlink-argument", {
    args: ["link.json"],
    files: { "real.json": "[1,]\n" },
    links: { "link.json": "real.json" },
  }),
  json("missing-then-valid", { args: ["nope.json", "ok.json"], files: { "ok.json": "{}\n" } }),

  // stdin: no argument reads stdin into mktemp -t lint-json.XXXXXX
  json("stdin-valid", { input: '{"a":1}\n' }),
  json("stdin-invalid", { input: '{"a":}\n' }),
  json("stdin-trailing-comma", { input: "[1,]\n" }),
  json("stdin-empty", { input: "" }),
  json("stdin-not-provided", {}),
  json("stdin-two-comma-lines", { input: "[1,]\n[2,]\n" }),

  // jq absent: one note, then the heuristic alone
  jfNoJq("no-jq-valid", '{"a":1}\n'),
  jfNoJq("no-jq-invalid-no-comma", '{"a":}\n'),
  jfNoJq("no-jq-trailing-comma", "[1,2,]\n"),
  jfNoJq("no-jq-comma-brace-bracket", '[{"a":1,}]\n'),
  { name: "no-jq-stdin", script: JSON_ID, input: "[1,]\n" },
  { name: "no-jq-missing-file", script: JSON_ID, args: ["missing.json"] },
  {
    name: "no-jq-two-files",
    script: JSON_ID,
    args: ["a.json", "b.json"],
    files: { "a.json": "[1,]\n", "b.json": "[1]\n" },
  },
];

// ----------------------------------------------------------------------------- lint-markdown

const MD_ID = "pr-reviewer/lint-markdown";
const md = (name: string, c: Rest): SkillCase => ({ name, script: MD_ID, ...c });
const mdFiles = { "a.md": "# a\n", "b.md": "# b\n" };
/** `markdownlint` stubbed with `body` after its argv log line. */
const mdStub = (name: string, body: string, args: readonly string[] = ["a.md"]): SkillCase =>
  md(name, { args, files: mdFiles, stubs: { markdownlint: body } });

export const LINT_MARKDOWN: readonly SkillCase[] = [
  md("no-files", {}),
  md("no-files-with-tool", { stubs: { markdownlint: "exit 1\n" } }),
  md("tool-absent", { args: ["a.md"], files: mdFiles }),
  md("tool-absent-no-file-check", { args: ["missing.md"] }),
  mdStub("pass-silent", "exit 0\n"),
  mdStub("pass-with-output-discarded", "echo noise\necho warn >&2\nexit 0\n"),
  mdStub("fail-stdout-only", "echo 'a.md:1 MD041 first line'\nexit 1\n"),
  mdStub("fail-stderr-only", "echo 'boom' >&2\nexit 1\n"),
  mdStub("fail-mixed-streams", "echo one\necho two >&2\necho three\necho four >&2\nexit 1\n"),
  mdStub("fail-trailing-newlines-trimmed", "printf 'x\\n\\n\\n'\nexit 1\n"),
  mdStub("fail-leading-and-inner-blank-lines-kept", "printf '\\n\\nx\\n\\ny\\n'\nexit 1\n"),
  mdStub("fail-trailing-spaces-kept", "printf 'x  \\n'\nexit 1\n"),
  mdStub("fail-no-output", "exit 1\n"),
  mdStub("fail-no-final-newline", "printf 'x'\nexit 1\n"),
  mdStub("fail-exit-2", "echo broke\nexit 2\n"),
  mdStub("fail-exit-127", "echo broke\nexit 127\n"),
  mdStub("fail-crlf-output", "printf 'x\\r\\ny\\r\\n'\nexit 1\n"),
  mdStub("fail-only-blank-line", "printf '\\n'\nexit 1\n"),
  mdStub("fail-two-files", "echo issues\nexit 1\n", ["a.md", "b.md"]),
  mdStub("argv-pass-through", "exit 0\n", ["--fix", "a.md", "dir with space/b.md", ""]),
  mdStub("missing-file-still-passed", "exit 0\n", ["missing.md"]),
];

// ------------------------------------------------------------------------------- lint-python

const PY_ID = "pr-reviewer/lint-python";
const py = (name: string, c: Rest): SkillCase => ({ name, script: PY_ID, ...c });
const PRINT = 'print("hi")\n';
/** One file `a.py`, no linter on the path: only the bare-print pass runs. */
const pyBare = (name: string, body: string): SkillCase =>
  py(name, { args: ["a.py"], files: { "a.py": body } });
const ruffOut = "echo 'a.py:1:1: F401 unused import'\nexit 1\n";

export const LINT_PYTHON: readonly SkillCase[] = [
  py("no-files", {}),
  py("no-files-with-tools", { stubs: { ruff: "exit 1\n", flake8: "exit 1\n" } }),

  // static analysis: ruff, else flake8, else a note
  py("ruff-pass", { args: ["a.py"], files: { "a.py": "x = 1\n" }, stubs: { ruff: "exit 0\n" } }),
  py("ruff-fail", { args: ["a.py"], files: { "a.py": "x = 1\n" }, stubs: { ruff: ruffOut } }),
  py("ruff-fail-stderr", {
    args: ["a.py"],
    files: { "a.py": "x = 1\n" },
    stubs: { ruff: "echo out\necho err >&2\nexit 1\n" },
  }),
  py("ruff-fail-trailing-newlines-trimmed", {
    args: ["a.py"],
    files: { "a.py": "x = 1\n" },
    stubs: { ruff: "printf 'x\\n\\n\\n'\nexit 1\n" },
  }),
  py("ruff-pass-bare-print", {
    args: ["a.py"],
    files: { "a.py": PRINT },
    stubs: { ruff: "exit 0\n" },
  }),
  py("ruff-fail-and-bare-print", {
    args: ["a.py"],
    files: { "a.py": PRINT },
    stubs: { ruff: ruffOut },
  }),
  py("ruff-wins-over-flake8", {
    args: ["a.py"],
    files: { "a.py": "x = 1\n" },
    stubs: { ruff: "exit 0\n", flake8: "echo flake\nexit 1\n" },
  }),
  py("flake8-pass", {
    args: ["a.py"],
    files: { "a.py": "x = 1\n" },
    stubs: { flake8: "exit 0\n" },
  }),
  py("flake8-fail", {
    args: ["a.py"],
    files: { "a.py": "x = 1\n" },
    stubs: { flake8: "echo 'a.py:1:1: E999 broken'\nexit 1\n" },
  }),
  py("flake8-fail-and-bare-print", {
    args: ["a.py"],
    files: { "a.py": PRINT },
    stubs: { flake8: "echo 'a.py:1:1: E999 broken'\nexit 1\n" },
  }),
  py("neither-tool-clean", { args: ["a.py"], files: { "a.py": "x = 1\n" } }),
  py("neither-tool-bare-print", { args: ["a.py"], files: { "a.py": PRINT } }),
  py("argv-to-linter", {
    args: ["a.py", "my dir/b.py", "-x"],
    files: { "a.py": "x = 1\n", "my dir/b.py": "y = 2\n" },
    stubs: { ruff: "exit 0\n" },
  }),

  // the `*test*|*tests*` case: a substring of the whole path, so a lot is skipped
  py("path-latest", { args: ["latest.py"], files: { "latest.py": PRINT } }),
  py("path-contest", { args: ["contest.py"], files: { "contest.py": PRINT } }),
  py("path-test-prefix", { args: ["test_a.py"], files: { "test_a.py": PRINT } }),
  py("path-tests-directory", { args: ["tests/a.py"], files: { "tests/a.py": PRINT } }),
  py("path-test-in-directory-name", {
    args: ["src/attest/a.py"],
    files: { "src/attest/a.py": PRINT },
  }),
  py("path-uppercase-test-not-skipped", { args: ["TEST.py"], files: { "TEST.py": PRINT } }),
  py("path-test-only-in-cwd", {
    args: ["a.py"],
    cwd: "test-dir",
    files: { "test-dir/a.py": PRINT },
  }),
  py("path-test-in-absolute-prefix", {
    args: ["{WORK}/test-area/a.py"],
    files: { "test-area/a.py": PRINT },
  }),
  py("mixed-files-order", {
    args: ["b.py", "tests/c.py", "a.py"],
    files: { "a.py": PRINT, "b.py": PRINT, "tests/c.py": PRINT },
  }),

  // the bare-print pattern: `^\s*print\(`
  pyBare("print-at-start", "print(1)\n"),
  pyBare("print-indented-spaces", "def f():\n    print(1)\n"),
  pyBare("print-indented-tab", "def f():\n\tprint(1)\n"),
  pyBare("print-space-before-paren", "print (1)\n"),
  pyBare("print-after-code", "x = 1; print(1)\n"),
  pyBare("print-in-comment", "# print(1)\n"),
  pyBare("print-prefixed-name", "reprint(1)\nprint_x(1)\nself.print(1)\n"),
  pyBare("print-in-string", 'x = "print(1)"\n'),
  pyBare("print-multiple-lines", lines("print(1)", "x = 2", "  print(2)", "print(3)")),
  pyBare("print-crlf", crlf("x = 1\nprint(1)\n")),
  pyBare("print-unterminated-last-line", "x = 1\nprint(1)"),
  pyBare("print-multi-statement-line", "print(1); print(2)\n"),
  pyBare("print-with-form-feed-indent", "\fprint(1)\n"),
  pyBare("print-empty-file", ""),

  // files that are not regular: skipped silently in the second pass only
  py("missing-file-no-linter", { args: ["missing.py"] }),
  py("missing-file-with-ruff", { args: ["missing.py"], stubs: { ruff: "exit 0\n" } }),
  py("directory-argument", { args: ["d"], dirs: ["d"] }),
  py("missing-then-print", { args: ["missing.py", "a.py"], files: { "a.py": PRINT } }),
  py("symlink-argument", {
    args: ["link.py"],
    files: { "real.py": PRINT },
    links: { "link.py": "real.py" },
  }),
];
