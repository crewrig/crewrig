// toml.ts — the content of crewrig.config.toml (spec 0314 R16): exactly two string keys, a comment above
// each, a line feed after every line. The values are repository URLs, so they need no escaping.

import { CANONICAL_REPO, isRepositoryUrl } from "./plain-url.ts";

export function renderConfig(feedbackRepo: string): string {
  if (!isRepositoryUrl(feedbackRepo)) {
    throw new Error("feedback_repo must be a repository URL");
  }
  return [
    "# canonical_repo: the upstream CrewRig repository that the framework is released from.",
    `canonical_repo = "${CANONICAL_REPO}"`,
    "# feedback_repo: the organization's own repository, which receives feedback on organization-owned components.",
    `feedback_repo = "${feedbackRepo}"`,
    "",
  ].join("\n");
}
