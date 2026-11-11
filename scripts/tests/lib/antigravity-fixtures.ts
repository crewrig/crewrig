// antigravity-fixtures.ts — fixture builders shared by the Antigravity
// component tests.
// The builders are ports of write_component / stage_skill / stage_agent of the retired
// test-antigravity-component-install.sh and are also used against the TypeScript twin.

import fs from "node:fs";
import path from "node:path";

import { realTmp } from "./worktree-fixtures.ts";

/**
 * Write one component marker. `body: "canonical"` appends an INDENTED provenance block to the BODY,
 * outside the frontmatter and lexically identical to a real one. The indentation is load-bearing:
 * never simplify it to column 0, or a mutant that drops the frontmatter-exit rule would pass green.
 */
export function writeComponent(
  marker: string,
  name: string,
  prov: boolean,
  body: "plain" | "canonical" = "plain",
): void {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  const lines = ["---", `name: ${name}`, `description: "Fixture component ${name}."`];
  if (prov) {
    lines.push(
      "metadata:",
      "  provenance:",
      '    canonical: "https://github.com/crewrig/crewrig"',
      '    feedback: "https://github.com/crewrig/crewrig"',
      '    version: "1.0.0"',
    );
  }
  lines.push("---", "", `# ${name}`, "", "Fixture body.");
  if (body === "canonical") {
    lines.push(
      "",
      "A user's own notes, quoting what a framework block looks like:",
      "",
      "    metadata:",
      "      provenance:",
      '        canonical: "https://github.com/some-user/their-own-thing"',
      "",
    );
  }
  fs.writeFileSync(marker, lines.join("\n") + "\n");
}

export const stageSkill = (
  root: string,
  name: string,
  prov = true,
  body: "plain" | "canonical" = "plain",
): void => writeComponent(path.join(root, "skills", name, "SKILL.md"), name, prov, body);

export const stageAgent = (
  root: string,
  name: string,
  prov = true,
  body: "plain" | "canonical" = "plain",
): void => writeComponent(path.join(root, "agents", `${name}.md`), name, prov, body);

/** A real-path scratch directory, removed by `cleanupAll` of worktree-fixtures. */
export const scratch = (prefix: string): string => realTmp(prefix);
