// provenance-cases.ts — inputs and shell drivers of build-components-provenance.test.ts
// (spec 0250 R12, R13, R15). The drivers read the shell functions out of scripts/build-components.sh
// with awk, so the oracle is never copied; `withProvenance` builds a frontmatter around entries.

const D4 = "../../../../";
const D5 = "../../../../../";

/** A source whose `metadata.provenance` holds `body` (already indented by four spaces). */
export const withProvenance = (body: string): string =>
  `---\nname: x\nmetadata:\n  provenance:\n${body}\n---\nbody\n`;

/** Frontmatters of every edge shape the twin and the shell must render alike. */
export const SYNTHETIC_SOURCES: readonly string[] = [
  withProvenance("    version: 1.0\n    canonical: https://h/o/r\n    feedback: f"),
  withProvenance("    a: 007\n    b: 0x1F\n    c: yes\n    d: false\n    e: 1e3"),
  withProvenance("    a:\n    b: ~\n    c: null"),
  withProvenance('    a: \'say "hi"\'\n    "k k": v\n    b: "x: y"'),
  withProvenance("    note: |\n      one\n      two\n    next: z"),
  withProvenance("    note: >\n      one\n      two\n    next: z"),
  "---\nmetadata:\n  provenance:\n---\nb",
  "---\nmetadata:\n  provenance: {}\n---\nb",
  "---\nname: x\nmetadata: text\n---\nb",
  "---\nname: x\n---\nb",
];

/** Strings the two link rewrites are compared on. */
export const LINK_INPUTS: readonly string[] = [
  `${D4}docs/a ${D4}specs/b`,
  `${D5}docs/a ${D5}specs/b`,
  `../${D5}docs/x`,
  `${D4}docs/${D4}docs/x`,
  "../../../docs/a",
  `${D4}README.md`,
  `a\r\n${D5}docs/x\r\nb`,
  "x",
];

/** `$1` is the script; the rest are source files. Prints block NUL comment NUL per file. */
export const PROV_DRIVER = `set -euo pipefail
eval "$(awk '/^(provenance_block|gemini_provenance_comment|extract_frontmatter)\\(\\) \\{/,/^\\}/' "$1")"
shift
for f in "$@"; do fm="$(extract_frontmatter "$f")"; printf '%s\\0%s\\0' "$(provenance_block "$fm")" "$(gemini_provenance_comment "$fm")"; done`;

/** `$1` is the script, `$2` the content, `$3` the source file. */
export const INJECT_DRIVER = `set -euo pipefail
eval "$(awk '/^(provenance_block|inject_provenance|extract_frontmatter)\\(\\) \\{/,/^\\}/' "$1")"
inject_provenance "$2" "$3"`;
