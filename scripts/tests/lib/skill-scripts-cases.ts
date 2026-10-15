// skill-scripts-cases.ts — every script of the oracle with its case table: the one list the test
// and the golden regeneration tool both walk. A script gets a table in the chunk that adds it.

import { GITHUB_CHECK_SECRETS_EXPOSURE } from "./skill-scripts-cases-github-2.ts";
import { SIMULATE_WORKFLOW } from "./skill-scripts-cases-github-flow.ts";
import { LINT_WORKFLOW, SIMULATE_JOB } from "./skill-scripts-cases-github-sim.ts";
import { CHECK_PINNED_ACTIONS } from "./skill-scripts-cases-github.ts";
import { CHECK_PINNED_IMAGES } from "./skill-scripts-cases-gitlab-images.ts";
import { CHECK_SECRETS_EXPOSURE } from "./skill-scripts-cases-gitlab-secrets.ts";
import { LINT_JSON, LINT_MARKDOWN, LINT_PYTHON } from "./skill-scripts-cases-reviewer-lint.ts";
import { LINT_SKILL } from "./skill-scripts-cases-reviewer-skill.ts";
import type { SkillCase } from "./skill-scripts-observe.ts";

export interface ScriptCases {
  /** `<skill>/<script>`. */
  readonly script: string;
  readonly cases: readonly SkillCase[];
}

export const SCRIPTS: readonly ScriptCases[] = [
  { script: "github-actions/check-pinned-actions", cases: CHECK_PINNED_ACTIONS },
  { script: "github-actions/check-secrets-exposure", cases: GITHUB_CHECK_SECRETS_EXPOSURE },
  { script: "github-actions/lint-workflow", cases: LINT_WORKFLOW },
  { script: "github-actions/simulate-job", cases: SIMULATE_JOB },
  { script: "github-actions/simulate-workflow", cases: SIMULATE_WORKFLOW },
  { script: "gitlab-ci/check-pinned-images", cases: CHECK_PINNED_IMAGES },
  { script: "gitlab-ci/check-secrets-exposure", cases: CHECK_SECRETS_EXPOSURE },
  { script: "pr-reviewer/lint-json", cases: LINT_JSON },
  { script: "pr-reviewer/lint-markdown", cases: LINT_MARKDOWN },
  { script: "pr-reviewer/lint-python", cases: LINT_PYTHON },
  { script: "pr-reviewer/lint-skill", cases: LINT_SKILL },
];
