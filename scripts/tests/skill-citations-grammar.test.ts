// skill-citations-grammar.test.ts — spec 0293 R9, R11, R12: the one definition of a citation
// that both the skill linter and the component build use.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { citations, proseLines, sharedTopic } from "../lib/skill-citations/grammar.ts";

const paths = (text: string, skip = true): string[] => citations(text, skip).map((c) => c.path);

describe("citations", () => {
  test("a path counts in prose, in a code span and in an ordinary code fence", () => {
    assert.deepEqual(
      paths("see references/a.md and `scripts/b.ts`\n```sh\nnode scripts/c.ts\n```\n"),
      ["references/a.md", "scripts/b.ts", "scripts/c.ts"],
    );
  });

  test("a yaml fence, a repo-only block and the frontmatter are not read", () => {
    const text =
      "---\nx: references/front.md\n---\n```yaml\nscripts/y.ts\n```\n<!-- crewrig-repo-only:start -->\nscripts/r.ts\n<!-- crewrig-repo-only:end -->\nscripts/k.ts\n";
    assert.deepEqual(paths(text), ["scripts/k.ts"]);
  });

  test("a placeholder, a glob, a directory mention and a parent segment are not one file", () => {
    assert.deepEqual(
      paths("`scripts/<name>.ts` `scripts/*.ts` the `scripts/` folder references/../x.md"),
      [],
    );
  });

  test("trailing punctuation is trimmed and a leading ./ is dropped", () => {
    assert.deepEqual(paths("Read ./references/a.md, then scripts/b.ts."), [
      "references/a.md",
      "scripts/b.ts",
    ]);
  });

  test("the line number is that of the text scanned", () => {
    assert.equal(citations("a\n\nreferences/a.md\n", false)[0]?.line, 3);
  });

  test("sharedTopic names the topic of a shared path and nothing else", () => {
    assert.equal(sharedTopic("references/shared-friction-reporting.md"), "friction-reporting");
    assert.equal(sharedTopic("references/friction.md"), undefined);
    assert.equal(sharedTopic("references/shared-.md"), undefined);
  });

  test("proseLines drops fences and blanks inline code spans", () => {
    const prose = proseLines("a `code #1234` b\n```\n#5678\n```\nc", false).map((l) => l.text);
    assert.deepEqual(prose, ["a   b", "c"]);
  });
});
