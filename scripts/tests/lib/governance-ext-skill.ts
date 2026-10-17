// governance-ext-skill.ts — extension SKILL.md fixture renderer shared by the version-bump suites
// (spec 0265, row J2, P5). The version lives on the crewrig-provenance carrier (first body line).
//
// API: render(version, extra?) -> SKILL.md text; an empty `version` renders version="".

const CANON = "https://github.com/crewrig/crewrig";

/** An extension SKILL.md whose version lives on the first-body-line carrier. */
export function render(version: string, extra = ""): string {
  const carrier = `<!-- crewrig-provenance: version="${version}" canonical="${CANON}" feedback="${CANON}" -->`;
  const head = "---\nname: example\ndescription: Example extension skill fixture.\n---\n";
  return `${head}${carrier}\n\n# Example\n\nBody.\n${extra === "" ? "" : `${extra}\n`}`;
}
