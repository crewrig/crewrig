// glob-engine.ts — the path matcher behind scripts/check-path-ownership.ts
// (spec 0147 delta-01 R13).
//
// Standard library only, no I/O. It implements exactly these forms and fails
// closed (UnsupportedGlobError) on everything else, so a future `{a,b}`,
// `[x]`, `?` or `+` in a `paths:` list is a loud wiring fault, never a wrong
// answer:
//
//   *        any run of characters inside one path segment (never crosses `/`)
//   **/      zero or more whole directories (`a/**/b` matches `a/b` and `a/x/y/b`)
//   /**      a trailing `**`: everything below the prefix (`dir/**` owns `dir/x`
//            and `dir/x/y`); a lone `**` matches every path
//
// A `**` is only valid as a whole path segment. Dotfiles are matched like any
// other name. The two R13 rules (`*` stops at `/`; `**/` matches zero or more
// directories) are the engines' own semantics; the trailing-`**` form is
// cross-checked against `picomatch` (the GitHub path-filter engine), and
// equivalence with GitLab `changes:` matching is an assumption, not a claim.
//
// `?` and `+` are rejected because engines disagree on them: `picomatch` reads
// `?` as one character, but GitHub's native workflow-level `on.*.paths` matcher
// is recalled to give `?` (zero or one of the preceding character) and `+` (one
// or more) regex-like meaning. That recollection is an assumption to verify
// against GitHub's filter documentation; the rejection makes it moot until then.

/** Thrown for a glob outside the supported forms; the entry point maps it to exit 2. */
export class UnsupportedGlobError extends Error {
  glob: string;
  why: string;
  constructor(glob: string, why: string, where?: string) {
    super(`${where === undefined ? "" : `${where}: `}unsupported glob '${glob}': ${why}`);
    this.name = "UnsupportedGlobError";
    this.glob = glob;
    this.why = why;
  }
}

const UNSUPPORTED_CHARS = /[{}[\]()\\?+]/;
const REGEX_META = /[.^$|]/g;

/** Regex source for one non-`**` segment. */
function segmentSource(segment: string): string {
  let out = "";
  for (const ch of segment) {
    if (ch === "*") out += "[^/]*";
    else out += ch.replace(REGEX_META, "\\$&");
  }
  return out;
}

/** Compile a glob to an anchored RegExp, or throw UnsupportedGlobError. */
export function globToRegExp(glob: string): RegExp {
  if (glob === "") throw new UnsupportedGlobError(glob, "empty glob");
  const bad = UNSUPPORTED_CHARS.exec(glob);
  if (bad !== null)
    throw new UnsupportedGlobError(glob, `'${bad[0]}' is not a supported glob character`);
  if (glob.startsWith("!")) throw new UnsupportedGlobError(glob, "negation is not supported");
  if (glob.startsWith("/") || glob.startsWith("./"))
    throw new UnsupportedGlobError(
      glob,
      "a glob is repository-relative; drop the leading '/' or './'",
    );
  const segments = glob.split("/");
  let source = "";
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === "")
      throw new UnsupportedGlobError(glob, "empty path segment (doubled or trailing '/')");
    if (segment === "**") {
      // Trailing `**`: everything below the prefix. Otherwise zero or more directories.
      source += last ? (i === 0 ? "[\\s\\S]*" : "[\\s\\S]+") : "(?:[\\s\\S]*/)?";
      return;
    }
    if (segment.includes("**"))
      throw new UnsupportedGlobError(glob, "'**' must be a whole path segment");
    source += segmentSource(segment) + (last ? "" : "/");
  });
  return new RegExp(`^${source}$`);
}
