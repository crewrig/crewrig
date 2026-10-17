// model-ci-tooling-build-ci-cases.test.ts — differential cases of scripts/build-ci.ts
// against scripts/build-ci.sh on synthetic references (spec 0262 requirements 1-4, 8, 20,
// 21, 24): runtimes, cache, cache-guard, env, branch globs, tag-pattern, paths, manual
// and unknown triggers, and drifted-file `--check` runs (verdict, status and stderr outside the diff body; the
// printed hunks are applied to the committed file, never compared by layout: delta-02 h). The shell leg needs bash and yq and is skipped otherwise.

import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REAL_REF, same, sameDrift, SKIP } from "./lib/build-ci-diff.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

/** One portable capability; `extra` is raw YAML under the capability. */
function ref(extra: string, id = "probe"): string {
  const body = extra
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
  return `capabilities:\n  - id: ${id}\n    portability: portable\n${body}\n`;
}
const BASE = "command:\n  - echo hi\ntrigger:\n  - on: push";

describe("build-ci twin: synthetic capabilities", { skip: SKIP }, () => {
  const cases: Record<string, string> = {
    "no runtime": ref(BASE),
    "multi runtime": ref(`requires:\n  runtime: [python@3.12, node@24.1.2]\n${BASE}`),
    "secondary python": ref(`requires:\n  runtime: [node@22, python@3.11]\n${BASE}`),
    "unknown secondary runtime": ref(`requires:\n  runtime: [node@22, go@1]\n${BASE}`),
    "tools and history": ref(
      `requires:\n  runtime: node@22\n  history-depth: full\n  tools: [yq, jq, task, tesseract, python3, markdownlint-cli]\n${BASE}`,
    ),
    "env values": ref(`env:\n  B: 'x "q" \\ y'\n  A: plain\n  C: |\n    two\n    lines\n${BASE}`),
    "cache wraps scripts": ref(
      `cache:\n  files: [a.txt, b/c.txt]\n  env: [X, Y]\ncommand:\n  - bash scripts/t.sh\n  - echo no\n  - |\n    bash scripts/multi.sh\n    second\ntrigger:\n  - on: push`,
    ),
    "cache-guard false": ref(
      `cache:\n  files: [a.txt]\ncache-guard: false\ncommand:\n  - bash scripts/t.sh\ntrigger:\n  - on: push`,
    ),
    "cache-guard empty": ref(
      `cache:\n  files: [a.txt]\ncache-guard:\ncommand:\n  - bash scripts/t.sh\ntrigger:\n  - on: push`,
    ),
    "branch globs": ref(
      `command: [x]\ntrigger:\n  - on: push\n    branches: [main, "release/**", "a/**/b", "feat/x"]\n  - on: pull-request\n    branches: [main]`,
    ),
    "tag pattern": ref(
      `command: [x]\ntrigger:\n  - on: tag\n    tag-pattern: '^v[0-9]+$'\n  - on: tag`,
    ),
    paths: ref(
      `command: [x]\ntrigger:\n  - on: pull-request\n    paths: ["a/**", b.md]\n  - on: scheduled`,
    ),
    "manual triggers": ref(
      `command: [x]\ntrigger:\n  - on: manual\n  - on: manual\n    paths: [a]\n  - on: manual\n    branches: [main]`,
    ),
    "unknown trigger kind": ref(`command: [x]\ntrigger:\n  - on: bogus`),
    "no triggers": ref(`command: [x]\ntrigger: []`),
    "no commands": ref(`trigger:\n  - on: push`),
    "capabilities absent": "foo: 1\n",
    "capabilities a mapping": "capabilities: {a: 1}\n",
    "two jobs": `${ref(BASE, "one")}  - id: two\n    portability: specific\n  - id: three\n    portability: portable\n    command: [y]\n    trigger: [{on: push}]\n`,
  };
  for (const [name, reference] of Object.entries(cases)) {
    test(name, () => same([], reference));
  }
});

describe("build-ci twin: --check drifted files", { skip: SKIP }, () => {
  const lines = fs.readFileSync(path.join(REPO, ".gitlab-ci.yml"), "utf8").split("\n");
  const drifts: Record<string, (l: string[]) => string[]> = {
    "single changed line": (l) => l.map((x, i) => (i === 30 ? `${x} # drift` : x)),
    "deleted block": (l) => [...l.slice(0, 40), ...l.slice(55)],
    "inserted block": (l) => [...l.slice(0, 20), "# a", "# b", "# c", ...l.slice(20)],
    "three separate hunks": (l) =>
      l.map((x, i) => (i === 25 || i === 90 || i === 400 ? `${x}X` : x)),
    "duplicated lines": (l) => [...l.slice(0, 60), l[60]!, l[61]!, ...l.slice(60)],
    "truncated tail": (l) => l.slice(0, 700),
    "appended tail": (l) => [...l, "extra", "extra"],
    "swapped neighbours": (l) => [...l.slice(0, 50), l[51]!, l[50]!, ...l.slice(52)],
    "repeated-line region rewritten": (l) =>
      l.map((x, i) => (i % 7 === 0 && i > 100 && i < 300 ? "" : x)),
  };
  for (const [name, mutate] of Object.entries(drifts)) {
    test(name, () => sameDrift(REAL_REF, mutate(lines).join("\n")));
  }
});
