// provenance-cases.ts — input of build-components-provenance.test.ts (spec 0250 R12, R13, R15):
// `withProvenance` builds a frontmatter around provenance entries.

/** A source whose `metadata.provenance` holds `body` (already indented by four spaces). */
export const withProvenance = (body: string): string =>
  `---\nname: x\nmetadata:\n  provenance:\n${body}\n---\nbody\n`;
