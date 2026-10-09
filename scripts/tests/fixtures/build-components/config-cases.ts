// config-cases.ts — inputs of the configuration suites (spec 0250 R7): `crewrig.config.toml`
// texts that stress the line grammar, and canonical_repo values the validation accepts or
// refuses. Shared by the unit tests and the shell-parity set of build-components-cli-config.test.ts.

/** Config files whose placeholders the twin and the shell must register identically. */
export const CONFIG_TEXTS: readonly string[] = [
  'a = 1\nb = "two"\nc=3\n',
  "a = 1\nb = 2",
  'a = "x"\r\nb = y\r\n',
  "k = v=w=\n",
  'k = abc" \n',
  'k = abc "\n',
  "a = 1\nb = 2\na = 3\n",
  "a\nb = x\n",
  "# a = 1\n  # b = 2\n = 3\nc = 4\n",
  "1a = z\n",
  'a = "\n',
  'a = ""\n',
  'a = " x "\n',
  "a = \t  spaced \t\n",
  "a = \\1 & | $ ${B}\nb = Z\n",
  "a = ${B}\nb = X\n",
  "b = X\na = ${B}\n",
  "",
  "\n\n",
  "   a   =   b  \n",
  "A b = c\n",
  'canonical_repo = "https://h/o/r"\n',
  "k = ${K}\nkey = ${K}!\n",
];

/** canonical_repo values `validate_canonical_repo` accepts (the empty one included). */
export const VALID_REPOS: readonly string[] = [
  "",
  "https://github.com/o/r",
  "https://h/o/r/",
  "https://h:8080/o/r.git",
  "https://h/o/r?x=1",
  "https://é/ü/ö",
];

/** canonical_repo values it refuses. */
export const INVALID_REPOS: readonly string[] = [
  "https://h/o/r//",
  "https://h/o/r/x",
  "http://h/o/r",
  "file:///a/b/c",
  "https://h/o/r ",
  "https://h/o r",
  "https://h/o",
  "https://h//r",
  "https:///o/r",
  "git@github.com:o/r.git",
  "https://h/o/r\t",
];

/** `--target` values of the --list-output-dirs parity matrix (R5). */
export const LISTING_TARGETS: readonly string[] = [
  "all",
  "gemini",
  "claude",
  "copilot",
  "github",
  "antigravity",
  "nope",
  "gemini claude",
  "",
];

/** `--tier` argument forms crossed with every target in that matrix. */
export const LISTING_TIER_FORMS: readonly (readonly string[])[] = [
  [],
  ["--tier", "core"],
  ["--tier", "library"],
  ["--tier", "core", "--tier", "library"],
  ["--tier", "x", "--tier", "core"],
  ["--tier", ""],
  ["--tier", "a b", "--tier", "c"],
];
