// governance-skill-fixture.ts — skill and command source renderers for the skill-versions
// suites (spec 0265, row J2, P5). The version lives in `metadata.provenance.version`.
//
// API: renderSkill(version, extra?), renderCommand(version, extra?) -> source text.

const wrap = (head: string, version: string, title: string, body: string, extra: string): string =>
  `---\n${head}metadata:\n  provenance:\n    version: "${version}"\n---\n\n# ${title}\n\n${body}\n` +
  (extra === "" ? "" : `\n${extra}\n`);

export function renderSkill(version: string, extra = ""): string {
  const head = "name: example\ndescription: Example skill used as a test fixture.\n";
  return wrap(head, version, "Example", "Body.", extra);
}

export function renderCommand(version: string, extra = ""): string {
  const head =
    "name: example-cmd\ndescription: Example command used as a test fixture.\ntype: command\n";
  return wrap(head, version, "Example Command", "Prompt body.", extra);
}
