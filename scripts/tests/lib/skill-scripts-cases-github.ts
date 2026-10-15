// skill-scripts-cases-github.ts — the case tables of the github-actions skill scripts (spec 0258
// R28, plan step 8). One table per script; every case records status, stdout, stderr and files.
//
// `find` lists a directory in directory order, which no golden can pin (deviation (b)): a case
// that scans a directory therefore holds at most ONE file with findings.

import type { SkillCase } from "./skill-scripts-observe.ts";

const SHA40 = "0123456789abcdef0123456789abcdef01234567";
const SHA39 = SHA40.slice(0, 39);
const SHA41 = `${SHA40}8`;
const SHA40_UPPER = SHA40.toUpperCase();

const PINNED = `uses: actions/checkout@${SHA40}`;
const lines = (...rows: string[]): string => `${rows.join("\n")}\n`;
const wf = (...uses: string[]): string =>
  lines("name: ci", "jobs:", "  build:", "    steps:", ...uses.map((u) => `      ${u}`));
const WF_OK = wf(`  ${PINNED}`);
const WF_BAD = wf("  uses: actions/checkout@v4");

const SCRIPT = "github-actions/check-pinned-actions";

function pinned(name: string, c: Omit<SkillCase, "name" | "script">): SkillCase {
  return { name, script: SCRIPT, ...c };
}

/** A single file `wf.yml` holding `body`, scanned by name. */
const file = (name: string, body: string): SkillCase =>
  pinned(name, { args: ["wf.yml"], files: { "wf.yml": body } });

export const CHECK_PINNED_ACTIONS: readonly SkillCase[] = [
  // arguments and targets
  pinned("no-argument", {}),
  pinned("two-arguments", { args: ["a.yml", "b.yml"], files: { "a.yml": WF_OK, "b.yml": WF_OK } }),
  pinned("missing-path", { args: ["missing.yml"] }),
  pinned("empty-argument", { args: [""] }),
  pinned("help-flag", { args: ["--help"] }),
  pinned("absolute-path", { args: ["{WORK}/wf.yml"], files: { "wf.yml": WF_BAD } }),
  pinned("spaces-in-path", { args: ["my workflow.yml"], files: { "my workflow.yml": WF_BAD } }),
  pinned("empty-directory", { args: ["empty"], dirs: ["empty"] }),
  file("empty-file", ""),
  file("blank-lines-only", "\n\n  \n"),
  file("single-file-pinned", WF_OK),
  file(
    "single-file-unpinned",
    wf(
      "  uses: actions/checkout@v4",
      "  uses: actions/setup-node@main",
      "  uses: actions/cache",
      `  uses: actions/upload-artifact@${SHA40}`,
    ),
  ),

  // line endings and the last line
  file("lf-unpinned", WF_BAD),
  file("crlf-unpinned", WF_BAD.replaceAll("\n", "\r\n")),
  file("lf-pinned", WF_OK),
  file("crlf-pinned", WF_OK.replaceAll("\n", "\r\n")),
  file("unterminated-last-line", `${WF_OK}      uses: actions/cache@v3`),
  file("unterminated-pinned", `${WF_BAD}      uses: actions/cache@${SHA40}`),

  // directories
  pinned("dir-with-workflows", {
    args: ["repo"],
    files: {
      "repo/.github/workflows/ci.yml": WF_OK,
      "repo/.github/workflows/release.yaml": WF_BAD,
      "repo/other/ignored.yml": WF_BAD,
    },
  }),
  pinned("dir-without-workflows", {
    args: ["repo"],
    files: {
      "repo/a.yml": WF_BAD,
      "repo/sub/b.yaml": WF_OK,
      "repo/notes.txt": "uses: x@v1\n",
    },
  }),
  pinned("dir-nested-workflow", {
    args: ["repo"],
    files: { "repo/.github/workflows/sub/deep.yml": WF_BAD },
  }),
  pinned("dir-all-pinned", {
    args: ["repo"],
    files: { "repo/.github/workflows/ci.yml": WF_OK, "repo/.github/workflows/b.yaml": WF_OK },
  }),
  pinned("dir-trailing-slash", {
    args: ["repo/"],
    files: { "repo/.github/workflows/ci.yml": WF_BAD },
  }),
  pinned("dir-trailing-slash-no-workflows", {
    args: ["repo/"],
    files: { "repo/a.yml": WF_BAD },
  }),
  pinned("dir-uppercase-extension", {
    args: ["repo"],
    files: { "repo/.github/workflows/CI.YML": WF_BAD },
  }),
  pinned("file-uppercase-extension", { args: ["CI.YML"], files: { "CI.YML": WF_BAD } }),

  // symlinks
  pinned("symlink-in-dir", {
    args: ["repo"],
    files: { "repo/.github/workflows/ok.yml": WF_OK, "outside.yml": WF_BAD },
    links: { "repo/.github/workflows/link.yml": "../../../outside.yml" },
  }),
  pinned("symlink-as-target", {
    args: ["link.yml"],
    files: { "real.yml": WF_BAD },
    links: { "link.yml": "real.yml" },
  }),

  // values
  file(
    "quoted-values",
    wf(
      '  uses: "actions/checkout@v4"',
      "  uses: 'actions/setup-node@v4'",
      `  uses: "actions/cache@${SHA40}"`,
      `  uses: 'actions/cache@${SHA40}'`,
      `  uses: "'actions/x@v1'"`,
      '  uses: "actions/y@v1',
    ),
  ),
  file(
    "local-and-docker",
    wf(
      "  uses: ./local",
      "  uses: ./.github/actions/setup@v1",
      "  uses: ../x",
      "  uses: ../x@v1",
      "  uses: docker://alpine:3.20",
      '  uses: "./quoted-local"',
      "  uses: 'docker://alpine'",
    ),
  ),
  file("dot-and-absolute", wf("  uses: .", "  uses: /abs/path@v1", "  uses: .x@v1")),
  file("hex-39", wf(`  uses: actions/checkout@${SHA39}`)),
  file("hex-40", wf(`  uses: actions/checkout@${SHA40}`)),
  file("hex-41", wf(`  uses: actions/checkout@${SHA41}`)),
  file("hex-uppercase", wf(`  uses: actions/checkout@${SHA40_UPPER}`)),
  file(
    "hex-mixed-case",
    wf(`  uses: actions/checkout@${SHA40.slice(0, 20)}${SHA40_UPPER.slice(20)}`),
  ),
  file("hex-non-hex", wf(`  uses: actions/checkout@${SHA40.slice(0, 39)}g`)),
  file("hex-with-suffix", wf(`  uses: actions/checkout@${SHA40}/sub`)),
  file("hex-two-at", wf(`  uses: a@b@${SHA40}`)),
  file(
    "reusable-workflow",
    wf(
      "  uses: org/repo/.github/workflows/build.yml@v1",
      `  uses: org/repo/.github/workflows/build.yml@${SHA40}`,
    ),
  ),
  file("non-ascii-value", wf("  uses: école/x@v1")),

  // the line shape
  file(
    "dash-form",
    lines(
      "steps:",
      "  - uses: actions/checkout@v4",
      "  - name: x",
      "    uses: actions/cache@v3",
      "  -   uses: actions/setup-node@v4",
    ),
  ),
  file(
    "trailing-comment",
    wf(
      "  uses: actions/checkout@v4 # v4",
      `  uses: actions/cache@${SHA40} # v4.1.0`,
      "  uses: actions/x@v1# nospace",
      "  uses: # only a comment",
      "  uses:#glued",
    ),
  ),
  file(
    "misc-forms",
    lines(
      "\tuses: actions/tab@v1",
      "uses:actions/glued@v1",
      "# uses: actions/commented@v1",
      "uses:",
      "uses:    actions/spaced@v1   ",
      "run: echo uses: actions/inline@v1",
      "with:",
      "  uses: actions/nested@v1",
      "USES: actions/upper@v1",
      "uses : actions/spacecolon@v1",
    ),
  ),
  file(
    "many-findings",
    wf(...Array.from({ length: 12 }, (_, i) => `  uses: actions/step${i}@v${i}`)),
  ),
];
