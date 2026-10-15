// skill-scripts-cases.ts — every script of the oracle with its case table: the one list the test
// and the golden regeneration tool both walk. A script gets a table in the chunk that adds it.

import { CHECK_PINNED_ACTIONS } from "./skill-scripts-cases-github.ts";
import type { SkillCase } from "./skill-scripts-observe.ts";

export interface ScriptCases {
  /** `<skill>/<script>`. */
  readonly script: string;
  readonly cases: readonly SkillCase[];
}

export const SCRIPTS: readonly ScriptCases[] = [
  { script: "github-actions/check-pinned-actions", cases: CHECK_PINNED_ACTIONS },
];
