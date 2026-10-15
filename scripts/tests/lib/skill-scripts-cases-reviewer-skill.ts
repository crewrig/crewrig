// skill-scripts-cases-reviewer-skill.ts — the case table of `pr-reviewer/lint-skill` (spec 0258
// R28, plan steps 5 and 8). Two legs share one table, told apart by the case name prefix:
//
//   `fallback-*`  no `yq` on the PATH: the whole-file grep and awk fallback. Runs live on every
//                 Linux host and may never be absent (skill-scripts-yaml-leg.test.ts fails then).
//   `yaml-*`      `yq` linked in (`tools` carries it): the frontmatter is parsed. Runs live where
//                 `yq` is on the host (the golden container carries Go `yq` v4.44.3) and is
//                 skipped with a named reason elsewhere (see skill-scripts-oracle.test.ts).
//
// A base commit is built with `SkillCase.git`: the base content sits in `base/` and is committed
// as `SKILL.md` through `--work-tree=base`, so the head file in `work/` can differ from it. The
// author and dates are fixed by the harness and no output carries an object id.

import type { SkillCase } from "./skill-scripts-observe.ts";

const ID = "pr-reviewer/lint-skill";
type Rest = Omit<SkillCase, "name" | "script">;
const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;
const crlf = (text: string): string => text.replaceAll("\n", "\r\n");

const KEYS = {
  name: ["name: demo"],
  description: ["description: A demo."],
  license: ["license: MIT"],
  compatibility: ["compatibility: all"],
  version: ["metadata:", "  provenance:", "    version: 1.0.0"],
};
const BODY = ["", "# Title", "", "Some body."];

/** A SKILL.md: all five keys unless one is `omit`ted, `version` replacing the version line. */
function skill(opts: { omit?: keyof typeof KEYS; version?: string; body?: string[] } = {}): string {
  const rows = (Object.keys(KEYS) as (keyof typeof KEYS)[])
    .filter((k) => k !== opts.omit)
    .flatMap((k) => KEYS[k]);
  const fm = rows.map((r) =>
    opts.version === undefined ? r : r.replace(/1\.0\.0$/, opts.version),
  );
  return lines("---", ...fm, "---", ...(opts.body ?? BODY));
}
const GIT = ["git"];
const YQ = ["git", "yq"];

/** Commands that leave `SKILL.md` (or `paths`) committed from `base/` and `origin/main` set. */
const repo = (paths: readonly string[] = ["SKILL.md"], refs: readonly string[] = ["origin/main"]) =>
  [
    ["init", "-q", "-b", "main"],
    ["--work-tree=base", "add", ...paths],
    ["commit", "-q", "-m", "base"],
    ...refs.map((r) => [
      "update-ref",
      r.includes("/") ? `refs/remotes/${r}` : `refs/heads/${r}`,
      "HEAD",
    ]),
  ] as const;

const fb = (name: string, c: Rest): SkillCase => ({
  name: `fallback-${name}`,
  script: ID,
  tools: GIT,
  ...c,
});
const ya = (name: string, c: Rest): SkillCase => ({
  name: `yaml-${name}`,
  script: ID,
  tools: YQ,
  ...c,
});
const fbOne = (name: string, body: string, c: Rest = {}): SkillCase =>
  fb(name, { args: ["SKILL.md"], files: { "SKILL.md": body }, ...c });
const yaOne = (name: string, body: string, c: Rest = {}): SkillCase =>
  ya(name, { args: ["SKILL.md"], files: { "SKILL.md": body }, ...c });
/** A head file `SKILL.md` against a base `base/SKILL.md`, committed as `origin/main`. */
const against = (head: string, base: string, c: Rest = {}): Rest => ({
  args: ["SKILL.md"],
  files: { "SKILL.md": head, "base/SKILL.md": base },
  git: repo(),
  ...c,
});

const REQUIRED = Object.keys(KEYS) as (keyof typeof KEYS)[];

const SKILL_CASES: readonly SkillCase[] = [
  // ----------------------------------------------------------------- line fallback (no yq)
  { name: "fallback-no-files", script: ID },
  fb("no-files-note-not-printed", {}),
  fbOne("complete", skill()),
  fb("note-printed-once", {
    args: ["a.md", "b.md", "c.md"],
    files: { "a.md": skill(), "b.md": skill(), "c.md": skill() },
  }),
  fbOne("empty-file", ""),
  ...REQUIRED.map((k) => fbOne(`missing-${k}`, skill({ omit: k }))),
  fbOne("missing-two", skill({ omit: "license" }).replace("name: demo\n", "")),
  fbOne("key-empty-value", skill().replace("license: MIT", "license:")),
  fbOne("key-trailing-space-only", skill().replace("license: MIT", "license: ")),
  fbOne("key-indented-anywhere", skill().replace("license: MIT", "      license: MIT")),
  fbOne("key-in-comment-not-matched", skill().replace("license: MIT", "# license: MIT")),
  fbOne("key-glued-value", skill().replace("license: MIT", "license:MIT")),
  fbOne("key-prefix-not-matched", skill().replace("license: MIT", "x-license: MIT")),
  fbOne("body-line-satisfies-key", skill({ omit: "license", body: [...BODY, "license: x"] })),
  fbOne("body-line-satisfies-name", skill({ omit: "name", body: [...BODY, "  name: body"] })),
  fbOne(
    "key-without-frontmatter",
    lines("name: a", "description: b", "license: c", "compatibility: d", "version: 1"),
  ),
  fbOne("version-leaf-anywhere", skill({ omit: "version", body: [...BODY, "version: 9"] })),
  fbOne("crlf-complete", crlf(skill())),
  fbOne("crlf-missing-key", crlf(skill({ omit: "license" }))),
  fbOne("unterminated-last-line", skill().trimEnd()),
  fb("missing-file", { args: ["missing/SKILL.md"] }),
  fb("directory-argument", { args: ["d"], dirs: ["d"] }),
  fb("missing-then-valid", { args: ["missing.md", "SKILL.md"], files: { "SKILL.md": skill() } }),
  fb("two-files-mixed", {
    args: ["a.md", "b.md"],
    files: { "a.md": skill({ omit: "name" }), "b.md": skill({ omit: "description" }) },
  }),
  fb("empty-argument", { args: [""] }),
  fb("spaces-in-path", { args: ["my skill/SKILL.md"], files: { "my skill/SKILL.md": skill() } }),

  // not a repository, a bad ref: silently no base version
  fbOne("no-repository-default-base", skill()),
  fbOne("no-repository-explicit-base", skill(), { env: { BASE_REF: "main" } }),
  fb("bad-base-ref", { ...against(skill(), skill()), env: { BASE_REF: "no-such-ref" } }),
  fb("bad-base-ref-empty", { ...against(skill(), skill()), env: { BASE_REF: "" } }),

  // the base is read from BASE_REF (default origin/main); the version is the first `version:` line
  fb("base-same-version", against(skill(), skill())),
  fb("base-bumped", against(skill({ version: "1.0.1" }), skill())),
  fb("base-older-head-lower", against(skill({ version: "0.9.0" }), skill())),
  fb("base-no-blob", {
    args: ["SKILL.md"],
    files: { "SKILL.md": skill(), "base/OTHER.md": skill() },
    git: repo(["OTHER.md"]),
  }),
  fb("base-explicit-ref-same", {
    ...against(skill(), skill(), { git: repo(["SKILL.md"], ["release"]) }),
    env: { BASE_REF: "release" },
  }),
  fb("base-explicit-ref-bumped", {
    ...against(skill({ version: "2.0.0" }), skill(), { git: repo(["SKILL.md"], ["release"]) }),
    env: { BASE_REF: "release" },
  }),
  fb("base-default-ref-absent", {
    ...against(skill(), skill(), { git: repo(["SKILL.md"], ["release"]) }),
  }),
  fb("base-head-version-empty", against(skill({ omit: "version" }), skill({ omit: "version" }))),
  fb("base-head-empty-base-set", against(skill({ omit: "version" }), skill())),
  fb("base-head-set-base-empty", against(skill(), skill({ omit: "version" }))),
  fb(
    "base-missing-key-and-same-version",
    against(skill({ omit: "license" }), skill({ omit: "license" })),
  ),
  fb(
    "base-version-quotes-stripped",
    against(skill({ version: '"1.0.0"' }), skill({ version: "1.0.0" })),
  ),
  fb(
    "base-version-single-quotes-kept",
    against(skill({ version: "'1.0.0'" }), skill({ version: "1.0.0" })),
  ),
  fb(
    "base-version-spaces-stripped",
    against(skill({ version: '" 1.0.0 "' }), skill({ version: "1.0.0" })),
  ),
  fb(
    "base-version-field-two-only",
    against(skill({ version: "1.0.0 extra" }), skill({ version: "1.0.0 other" })),
  ),
  fb(
    "base-version-comment-ignored",
    against(skill({ version: "1.0.0 # c" }), skill({ version: "1.0.0" })),
  ),
  fb(
    "base-version-glued-colon-empty",
    against(skill().replace("version: 1.0.0", "version:1.0.0"), skill()),
  ),
  fb(
    "base-first-version-line-wins",
    against(skill().replace("name: demo", "version: 3\nname: demo"), skill()),
  ),
  fb(
    "base-body-version-only",
    against(
      skill({ omit: "version", body: [...BODY, "version: 7"] }),
      skill({ omit: "version", body: [...BODY, "version: 7"] }),
    ),
  ),
  fb(
    "base-api-version-not-matched",
    against(skill().replace("name: demo", "api_version: 4\nname: demo"), skill()),
  ),
  fb("base-crlf-head", against(crlf(skill()), skill())),
  fb("base-crlf-both", against(crlf(skill()), crlf(skill()))),
  fb("base-two-files-one-stale", {
    args: ["a/SKILL.md", "b/SKILL.md"],
    files: {
      "a/SKILL.md": skill(),
      "b/SKILL.md": skill({ version: "2.0.0" }),
      "base/a/SKILL.md": skill(),
      "base/b/SKILL.md": skill(),
    },
    git: repo(["a/SKILL.md", "b/SKILL.md"]),
  }),
  fb("base-nested-path", {
    args: ["skills/x/SKILL.md"],
    files: { "skills/x/SKILL.md": skill(), "base/skills/x/SKILL.md": skill() },
    git: repo(["skills/x/SKILL.md"]),
  }),
  fb("base-dot-slash-path", { ...against(skill(), skill()), args: ["./SKILL.md"] }),
  fb("base-absolute-path", { ...against(skill(), skill()), args: ["{WORK}/SKILL.md"] }),
  fb("base-from-subdirectory", {
    args: ["SKILL.md"],
    cwd: "sub",
    files: { "sub/SKILL.md": skill(), "base/sub/SKILL.md": skill() },
    git: repo(["sub/SKILL.md"]),
  }),

  // ------------------------------------------------------------------- frontmatter (yq)
  ya("no-files", {}),
  yaOne("complete", skill()),
  ...REQUIRED.map((k) => yaOne(`missing-${k}`, skill({ omit: k }))),
  yaOne("empty-file", ""),
  yaOne("body-only-license-reported", skill({ omit: "license", body: [...BODY, "license: x"] })),
  yaOne("body-colons-do-not-matter", skill({ body: ["", "key: : [", "  - a: b: c", "\t\tx: y"] })),
  yaOne("version-float", skill({ version: "1.0" })),
  yaOne("version-false", skill({ version: "false" })),
  yaOne("version-true", skill({ version: "true" })),
  yaOne("version-null-tilde", skill({ version: "~" })),
  yaOne("version-null-word", skill({ version: "null" })),
  yaOne("version-empty-quotes", skill({ version: '""' })),
  yaOne("version-zero", skill({ version: "0" })),
  yaOne("version-quoted", skill({ version: '"1.0.0"' })),
  yaOne("license-false", skill().replace("license: MIT", "license: false")),
  yaOne("license-zero", skill().replace("license: MIT", "license: 0")),
  yaOne("license-list", skill().replace("license: MIT", "license: [a, b]")),
  yaOne("license-empty-map", skill().replace("license: MIT", "license: {}")),
  yaOne("metadata-scalar", skill({ omit: "version" }).replace("---\n\n", "metadata: x\n---\n\n")),
  yaOne("unclosed-frontmatter", lines("---", ...Object.values(KEYS).flat(), "", "# body")),
  yaOne(
    "unclosed-frontmatter-body-breaks-yaml",
    lines("---", ...Object.values(KEYS).flat(), "# body", "a: ["),
  ),
  yaOne("no-frontmatter", lines("# Title", "", "name: x")),
  yaOne("leading-blank-line", `\n${skill()}`),
  yaOne("frontmatter-only-dashes", lines("---", "---", "name: x")),
  yaOne("invalid-yaml", lines("---", "name: [unclosed", "---", "body")),
  yaOne("invalid-yaml-tab-indent", lines("---", "metadata:", "\tprovenance: 1", "---")),
  yaOne("second-document-ignored", `${skill()}---\nname: other\n---\n`),
  yaOne("crlf-complete", crlf(skill())),
  yaOne("crlf-missing-key", crlf(skill({ omit: "name" }))),
  yaOne("trailing-space-delimiters", skill().replace(/^---$/gm, "---  ")),
  yaOne(
    "delimiter-with-text-not-closing",
    lines("---", ...Object.values(KEYS).flat(), "--- x", "---", "body"),
  ),
  ya("missing-file", { args: ["missing.md"] }),
  ya("directory-argument", { args: ["d"], dirs: ["d"] }),
  ya("two-files-mixed", {
    args: ["a.md", "b.md"],
    files: { "a.md": skill({ omit: "name" }), "b.md": skill() },
  }),

  // base version, parsed rather than split
  ya("base-same-version", against(skill(), skill())),
  ya("base-bumped", against(skill({ version: "1.0.1" }), skill())),
  ya("base-version-quoted-vs-bare", against(skill({ version: '"1.0.0"' }), skill())),
  ya("base-version-single-quoted-vs-bare", against(skill({ version: "'1.0.0'" }), skill())),
  ya("base-version-float-same", against(skill({ version: "1.0" }), skill({ version: "1.0" }))),
  ya("base-version-with-comment", against(skill({ version: "1.0.0 # c" }), skill())),
  ya("base-version-spaces", against(skill({ version: '" 1.0.0 "' }), skill({ version: "1.0.0" }))),
  ya("base-head-false-base-set", against(skill({ version: "false" }), skill())),
  ya("base-head-empty-base-empty", against(skill({ omit: "version" }), skill({ omit: "version" }))),
  ya(
    "base-body-version-ignored",
    against(
      skill({ omit: "version", body: [...BODY, "version: 7"] }),
      skill({ omit: "version", body: [...BODY, "version: 7"] }),
    ),
  ),
  ya("base-crlf-both", against(crlf(skill()), crlf(skill()))),
  ya("base-no-blob", {
    args: ["SKILL.md"],
    files: { "SKILL.md": skill(), "base/OTHER.md": skill() },
    git: repo(["OTHER.md"]),
  }),
  ya("base-explicit-ref-same", {
    ...against(skill(), skill(), { git: repo(["SKILL.md"], ["release"]) }),
    env: { BASE_REF: "release" },
  }),
  ya("base-bad-ref", { ...against(skill(), skill()), env: { BASE_REF: "no-such-ref" } }),
];

/**
 * Deviation (d), spec 0258 R31: with no `js-yaml` reachable the entry prints its own one-line
 * note in place of the shell's `yq` note, so every fallback case that reaches the note carries an
 * overlay golden. The YAML leg prints no note and matches the shell's goldens.
 */
export const LINT_SKILL: readonly SkillCase[] = SKILL_CASES.map((c) =>
  c.name.startsWith("fallback-") && c.name !== "fallback-no-files" ? { ...c, deviation: "d" } : c,
);
