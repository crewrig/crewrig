// skill-scripts-cases-github-2.ts — the case table of github-actions/check-secrets-exposure (spec
// 0258 R28, plan step 8). Every case records status, stdout, stderr and files.
//
// `find` lists a directory in directory order, which no golden can pin (deviation (b)): a case
// that scans a directory therefore holds at most ONE file with findings.

import type { SkillCase } from "./skill-scripts-observe.ts";

const SCRIPT = "github-actions/check-secrets-exposure";
const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;
const crlf = (text: string): string => text.replaceAll("\n", "\r\n");

const T = "${{ secrets.TOKEN }}";
const CLEAN = lines("name: ci", "on: push", "jobs:", "  a:", "    steps:", "      - run: make");
/** A workflow with one finding of kind 3, to drop into directory cases. */
const RISKY = lines("name: ci", "jobs:", "  a:", "    steps:", "      - run: set -x");

function secrets(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: SCRIPT, ...c };
}
/** A single file `wf.yml` holding `body`, scanned by name. */
const file = (name: string, body: string): SkillCase =>
  secrets(name, { args: ["wf.yml"], files: { "wf.yml": body } });
/** One line of a `run:` step, scanned by name. */
const run = (name: string, row: string): SkillCase =>
  file(name, lines("jobs:", "  a:", "    steps:", `      - run: ${row}`));
/** The LF and the CRLF twin of one file. */
const twins = (name: string, body: string): SkillCase[] => [
  file(`${name}-lf`, body),
  file(`${name}-crlf`, crlf(body)),
];
const dir = (name: string, files: Record<string, string>, arg = "repo"): SkillCase =>
  secrets(name, { args: [arg], files });

const ENV_SECRET = lines("name: ci", "env:", `  TOKEN: ${T}`, "jobs:", "  a:", "    runs-on: x");

export const GITHUB_CHECK_SECRETS_EXPOSURE: readonly SkillCase[] = [
  // arguments and targets
  secrets("no-argument", {}),
  secrets("two-arguments", { args: ["a.yml", "b.yml"], files: { "a.yml": CLEAN, "b.yml": CLEAN } }),
  secrets("missing-path", { args: ["missing.yml"] }),
  secrets("empty-argument", { args: [""] }),
  secrets("absolute-path", { args: ["{WORK}/wf.yml"], files: { "wf.yml": RISKY } }),
  secrets("spaces-in-path", { args: ["my wf.yml"], files: { "my wf.yml": RISKY } }),
  secrets("empty-directory", { args: ["empty"], dirs: ["empty"] }),
  file("empty-file", ""),
  file("blank-lines-only", "\n\n  \n"),
  file("clean-file", CLEAN),
  file("unterminated-clean", `${CLEAN}      - run: make`),
  file("unterminated-finding", `${CLEAN}      - run: set -x`),
  file("unterminated-env-secret", `env:\n  TOKEN: ${T}`),
  file("unterminated-echo", `echo ${T}`),
  file("file-uppercase-extension", RISKY),
  secrets("file-uppercase-name", { args: ["CI.YML"], files: { "CI.YML": RISKY } }),
  file(
    "many-findings",
    lines(...Array.from({ length: 12 }, (_, i) => `      - run: set -x # ${i}`)),
  ),

  // directories
  dir("dir-with-workflows", {
    "repo/.github/workflows/ci.yml": RISKY,
    "repo/other/ignored.yml": RISKY,
  }),
  dir("dir-without-workflows", { "repo/a.yml": RISKY, "repo/notes.txt": "set -x\n" }),
  dir("dir-nested-workflow", { "repo/.github/workflows/sub/deep.yml": RISKY }),
  dir("dir-all-clean", {
    "repo/.github/workflows/ci.yml": CLEAN,
    "repo/.github/workflows/b.yaml": CLEAN,
  }),
  dir("dir-one-risky-one-clean", {
    "repo/.github/workflows/ci.yml": CLEAN,
    "repo/.github/workflows/release.yaml": RISKY,
  }),
  dir("dir-trailing-slash", { "repo/.github/workflows/ci.yml": RISKY }, "repo/"),
  dir("dir-trailing-slash-no-workflows", { "repo/a.yml": RISKY }, "repo/"),
  secrets("dir-empty-workflows-dir", { args: ["repo"], dirs: ["repo/.github/workflows"] }),
  dir("dir-github-without-workflows", { "repo/.github/x.yml": RISKY }),
  dir("dir-uppercase-extension", { "repo/.github/workflows/CI.YML": RISKY }),
  dir("dir-only-non-yaml", { "repo/.github/workflows/readme.md": "set -x\n" }),
  secrets("dir-symlink-ignored", {
    args: ["repo"],
    files: { "repo/.github/workflows/ok.yml": CLEAN, "outside.yml": RISKY },
    links: { "repo/.github/workflows/link.yml": "../../../outside.yml" },
  }),
  secrets("symlink-as-target", {
    args: ["link.yml"],
    files: { "real.yml": RISKY },
    links: { "link.yml": "real.yml" },
  }),

  // 1. echo of a secret
  run("echo-plain", `echo ${T}`),
  run("echo-quoted", `echo "${T}"`),
  run("echo-no-space-in-braces", "echo ${{secrets.TOKEN}}"),
  run("echo-extra-spaces", "echo    ${{     secrets.TOKEN }}"),
  run("echo-tab", `echo\t${T}`),
  run("echo-after-text", `echo token=${T} done`),
  run("echo-chained", `echo hi && echo ${T}`),
  run("echo-two-secrets-one-line", "echo ${{ secrets.A }} ${{ secrets.B }}"),
  run("echo-glued-to-brace", `echo${T}`),
  run("echo-not-the-first-word", `cat ${T} # echo`),
  run("echo-prefix-word", `xecho ${T}`),
  run("echo-uppercase", `ECHO ${T}`),
  run("echo-comment", `# echo ${T}`),
  run("echo-printf", `printf ${T}`),
  run("echo-github-context", "echo ${{ github.token }}"),
  run("echo-nested-context", "echo ${{ env.secrets.TOKEN }}"),
  run("echo-variable", "echo $TOKEN"),
  file("echo-secret-on-next-line", lines("run: echo", `  ${T}`)),
  ...twins("echo-secret", lines("jobs:", `      - run: echo ${T}`)),

  // 2. a workflow-level env
  ...twins("env-secret", ENV_SECRET),
  file("env-no-secret", lines("env:", "  A: 1", "jobs:", "  a:", "    runs-on: x")),
  file("env-var-reference", lines("env:", "  A: ${{ vars.A }}", "  B: ${{ github.token }}")),
  file("env-second-env-line", lines("env:", "  A: 1", "env:", `  TOKEN: ${T}`)),
  file("env-second-env-after-report", lines("env:", `  A: ${T}`, "env:", `  B: ${T}`)),
  file("env-closed-by-key", lines("env:", "  A: 1", "jobs:", "  a:", "    env:", `      T: ${T}`)),
  file("env-job-env-only", lines("jobs:", "  a:", "    env:", `      T: ${T}`)),
  file("env-comment-indented", lines("env:", `  # ${T}`, "jobs:")),
  file("env-comment-column-zero", lines("env:", `# ${T}`, "jobs:")),
  file("env-comment-does-not-close", lines("env:", "# note", "  A: 1", `  B: ${T}`)),
  file("env-blank-line-inside", lines("env:", "", "  A: 1", "", `  B: ${T}`)),
  file("env-trailing-spaces", lines("env:   ", `  A: ${T}`)),
  file("env-inline-map", lines(`env: { A: ${T} }`, "jobs:")),
  file("env-secret-on-env-line", lines(`env: ${T}`, "jobs:")),
  file("env-indented", lines("  env:", `    A: ${T}`)),
  file("env-two-secrets", lines("env:", `  A: ${T}`, `  B: ${T}`)),
  file("env-secret-before-env", lines(`A: ${T}`, "env:", "  B: 1")),
  file("env-secret-after-close", lines("env:", "  A: 1", "jobs:", `  a: ${T}`)),
  file("env-no-space-secrets", lines("env:", "  A: ${{secrets.A}}")),
  file("env-and-echo-same-line", lines("env:", `  A: echo ${T}`)),
  file("env-eof-immediately", "env:"),
  file("env-then-set-x", lines("env:", "  A: set -x")),

  // 3. set -x / set +x
  run("set-minus-x", "set -x"),
  run("set-plus-x", "set +x"),
  run("set-x-at-end-of-line", "echo hi; set -x"),
  run("set-x-end-of-file", "set -x"),
  run("set-x-extra-spaces", "set    -x"),
  run("set-x-tab", "set\t-x"),
  run("set-x-then-more", "set -x -e"),
  run("set-x-twice", "set -x; set +x"),
  run("set-x-semicolon", "set -x; make"),
  run("set-x-in-quotes", `bash -c "set -x"`),
  run("set-x-prefixed-by-dash", "-set -x"),
  run("set-x-prefixed-by-letter", "xset -x"),
  run("set-x-prefixed-by-underscore", "_set -x"),
  run("set-x-prefixed-by-digit", "1set -x"),
  run("set-xe", "set -xe"),
  run("set-ex", "set -ex"),
  run("set-o-xtrace", "set -o xtrace"),
  run("set-uppercase", "SET -x"),
  run("set-without-flag", "set x"),
  run("set-minus-xy", "set -x y"),
  ...twins("set-x-eol", lines("jobs:", "      - run: set -x")),

  // 4. toJSON(secrets)
  run("tojson-plain", "echo ${{ toJSON(secrets) }}"),
  run("tojson-inner-spaces", "echo ${{ toJSON( secrets ) }}"),
  run("tojson-trailing-space", "echo ${{ toJSON(secrets ) }}"),
  run("tojson-leading-space", "echo ${{ toJSON( secrets) }}"),
  run("tojson-outer-space", "echo ${{ toJSON (secrets) }}"),
  run("tojson-field", "echo ${{ toJSON(secrets.TOKEN) }}"),
  run("tojson-other-context", "echo ${{ toJSON(github) }}"),
  run("tojson-lowercase", "echo ${{ tojson(secrets) }}"),
  run("tojson-twice-one-line", "a=toJSON(secrets) b=toJSON(secrets)"),
  file("tojson-env-value", lines("jobs:", "  a:", "    env:", "      ALL: ${{ toJSON(secrets) }}")),
  ...twins("tojson", lines("jobs:", "      - run: x=${{ toJSON(secrets) }}")),

  // several findings
  run("three-on-one-line", `echo ${T} && set -x && x=toJSON(secrets)`),
  run("echo-and-set-x", `echo ${T}; set +x`),
  file(
    "all-four-kinds",
    lines("env:", `  A: ${T}`, "jobs:", `      - run: echo ${T} && set -x && x=toJSON(secrets)`),
  ),
  ...twins(
    "mixed-kinds",
    lines(
      "env:",
      `  A: ${T}`,
      "jobs:",
      "      - run: set +x",
      "      - run: echo ${{ toJSON(secrets) }}",
    ),
  ),
];
