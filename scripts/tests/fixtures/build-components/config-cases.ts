// config-cases.ts — inputs of the configuration suites (spec 0250 R7):
// canonical_repo values the validation accepts or refuses, used by build-components-cli-config.test.ts.

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
