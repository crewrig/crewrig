// Replaces scripts/tests/test-spec-linter.sh (Cases 1-16 and 41-43: spec structure).
// Each case writes one spec into a fresh sandbox and runs the linter as a child process.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HEADINGS,
  newFixture,
  renderSpec,
  runLinter,
  type SpecOpts,
} from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 30_000 };

function lint(file: string, text: string, expected: number): void {
  const fx = newFixture();
  fx.put(file, text);
  const r = runLinter(fx.root, [file]);
  assert.equal(r.status, expected, r.output);
}

const ok = (name: string, file: string, o: SpecOpts, expected: number): void => {
  test(name, T, () => lint(file, renderSpec(o), expected));
};

const FENCE = "```";

describe("spec-linter structure", () => {
  ok("Case 1 — valid spec passes", "0001-happy-path.md", { id: "0001", slug: "happy-path" }, 0);
  ok(
    "Case 2 — missing heading fails",
    "0002-missing-heading.md",
    {
      id: "0002",
      slug: "missing-heading",
      headings: "## Intent\n\n## Requirements\n\n## Out of scope\n\n## Open questions",
    },
    1,
  );
  ok("Case 3 — ID mismatch fails", "0003-id-mismatch.md", { id: "9999", slug: "id-mismatch" }, 1);
  ok(
    "Case 4 — delta spec wrong heading order fails",
    "0004-delta-order.delta-01.md",
    {
      id: "0004",
      slug: "delta-order",
      headings: "## MODIFIED\n\n## ADDED\n\n## REMOVED",
    },
    1,
  );
  ok(
    "Case 5 — max-iterations > 20 fails",
    "0005-max-iterations.md",
    {
      id: "0005",
      slug: "max-iterations",
      extraFm: "max-iterations: 25",
    },
    1,
  );
  ok(
    "Case 6 — status superseded without superseded-by fails",
    "0006-superseded-missing.md",
    {
      id: "0006",
      slug: "superseded-missing",
      status: "superseded",
    },
    1,
  );
  ok(
    "Case 7 — status approved without interaction-mode fails",
    "0007-interaction-missing.md",
    {
      id: "0007",
      slug: "interaction-missing",
      status: "approved",
    },
    1,
  );

  // MD001: header levels should only increase by one level at a time.
  test("Case 8 — markdownlint failure causes exit 1", T, () => {
    const text = `---
id: "0008"
slug: "markdownlint-fail"
status: "draft"
complexity: "standard"
version: 1.0.0
related-issue: 123
---

# Title
### Wrong Level Heading
## Intent
## Requirements
## Scenarios
## Out of scope
## Open questions
`;
    lint("0008-markdownlint-fail.md", text, 1);
  });

  ok(
    "Case 9 — status approved with interaction-mode passes",
    "0009-interaction-present.md",
    {
      id: "0009",
      slug: "interaction-present",
      status: "approved",
      extraFm: "interaction-mode: INTERMEDIATE",
    },
    0,
  );
  ok(
    "Case 10 — status draft without interaction-mode passes",
    "0010-interaction-missing-draft.md",
    {
      id: "0010",
      slug: "interaction-missing-draft",
    },
    0,
  );
  ok(
    "Case 11 — delta spec correct heading order passes",
    "0011-delta-ok.delta-01.md",
    {
      id: "0011",
      slug: "delta-ok",
      headings: "## ADDED\n\n## MODIFIED\n\n## REMOVED",
    },
    0,
  );
  ok(
    "Case 12 — status approved with superseded-by fails",
    "0012-superseded-prohibited.md",
    {
      id: "0012",
      slug: "superseded-prohibited",
      status: "approved",
      extraFm: "interaction-mode: INTERMEDIATE\nsuperseded-by: 0001",
    },
    1,
  );
  ok(
    "Case 13 — non-integer related-issue fails",
    "0013-related-issue-string.md",
    {
      id: "0013",
      slug: "related-issue-string",
      relatedIssue: '"#123"',
    },
    1,
  );
  ok(
    "Case 14 — extra headings allowed after mandatory ones passes",
    "0014-extra-headings.md",
    {
      id: "0014",
      slug: "extra-headings",
      headings: `${HEADINGS}\n\n## Extra Section\n\n### Sub Section`,
    },
    0,
  );
  ok(
    "Case 15 — headings inside code blocks are ignored passes",
    "0015-headings-in-code.md",
    {
      id: "0015",
      slug: "headings-in-code",
      headings: `${HEADINGS}\n\n${FENCE}markdown\n## This heading should be ignored\n${FENCE}`,
    },
    0,
  );
  ok(
    "Case 16 — mandatory heading missing but present in code block fails",
    "0016-mandatory-heading-in-code.md",
    {
      id: "0016",
      slug: "mandatory-heading-in-code",
      headings: `## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n${FENCE}markdown\n## Open questions\n${FENCE}`,
    },
    1,
  );

  ok(
    "Case 41 — leaked tool scaffolding fails",
    "0041-leaked-scaffolding.md",
    {
      id: "0041",
      slug: "leaked-scaffolding",
      headings: `${HEADINGS}\n\n</content>\n</invoke>`,
    },
    1,
  );
  ok(
    "Case 42 — tool scaffolding inside fenced code block passes",
    "0042-fenced-scaffolding.md",
    {
      id: "0042",
      slug: "fenced-scaffolding",
      headings: `## Intent\n\n${FENCE}text\n</content>\n</invoke>\n${FENCE}\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions`,
    },
    0,
  );
  ok(
    "Case 43 — tool scaffolding in inline code span passes",
    "0043-inline-scaffolding.md",
    {
      id: "0043",
      slug: "inline-scaffolding",
      headings:
        "## Intent\n\nRefers to `</content>` and `</invoke>` tags.\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions",
    },
    0,
  );
});
