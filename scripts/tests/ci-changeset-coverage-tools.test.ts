// ci-changeset-coverage-tools.test.ts — the coverage-tools guard of the exhaustive run (spec 0147
// delta-02 R25, R28-R31, issue #1770). Every tool required by a changeset-gated capability of
// ci/ci-capabilities.yml must be required by `changeset-coverage`, the capability that runs them all.
//
// The real reference is read at test time; every failing fixture is an in-memory edit of that text
// (or a document appended to it), so the real file is never mutated. The first case is the guard
// itself: it fails with the finding lines when the real reference is inconsistent and prints the
// counts when it is not. Standard library plus the repo's yq reader, so it runs after `npm ci --omit=dev`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { toolsFindings } from "../lib/ci-changeset-coverage/tools.ts";
import {
  get,
  loadYq,
  render,
  YqAlias,
  YqMap,
  YqSeq,
  type YqNode,
} from "../lib/yq-accessors/index.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");

const COVERAGE_TOOLS = "tools: [yq, jq, task, tesseract]";
/** The two-line `requires` head of changeset-coverage: the runtime line alone is not unique. */
const COVERAGE_REQUIRES = `runtime: [python@3.12, node@24]\n      ${COVERAGE_TOOLS}`;

function line(id: string, tool: string): string {
  return `ci-changeset-coverage-tools: ${id} needs ${tool} but changeset-coverage does not require it`;
}

/** An edit of the real text that must apply exactly once, so a drifting anchor fails loudly. */
function edit(text: string, from: string, to: string): string {
  assert.equal(text.split(from).length, 2, `anchor must occur exactly once: ${from}`);
  return text.replace(from, to);
}

/** The real reference with a gated capability appended (`capabilities` is its last top-level key). */
function withGated(extra: string): string {
  return `${REAL.replace(/\n*$/, "\n")}${extra}`;
}

function deref(n: YqNode): YqNode {
  let cur = n;
  while (cur instanceof YqAlias) cur = cur.target;
  return cur;
}

function capability(id: string): YqNode {
  const caps = deref(get(loadYq(REAL), ["capabilities"]));
  assert.ok(caps instanceof YqSeq);
  const found = caps.items.map(deref).find((c) => {
    const v = deref(get(c, ["id"]));
    return v !== null && render(v) === id;
  });
  assert.ok(found, `capability ${id} exists in the reference`);
  return found;
}

describe("ci-changeset-coverage-tools: the guard", () => {
  test("the real reference is consistent, and the counts are printed", (t) => {
    const { findings, gated, tools } = toolsFindings(REAL);
    assert.deepEqual(findings, [], findings.join("\n"));
    assert.ok(gated > 0 && tools > 0, "something was evaluated");
    t.diagnostic(
      `ci-changeset-coverage-tools: ${gated} gated capabilities, ${tools} tools evaluated`,
    );
  });

  test("removing task from changeset-coverage names cli-matrix-fresh and check-taskfile-tree", () => {
    const text = edit(REAL, COVERAGE_TOOLS, "tools: [yq, jq, tesseract]");
    const { findings } = toolsFindings(text);
    assert.ok(findings.includes(line("cli-matrix-fresh", "task")), findings.join("\n"));
    assert.ok(findings.includes(line("check-taskfile-tree", "task")), findings.join("\n"));
    assert.ok(
      findings.every(
        (f) =>
          f.endsWith(" needs task but changeset-coverage does not require it") ||
          !f.includes(" needs task "),
      ),
    );
  });

  test("a gated capability that gains tesseract is named with the tool", () => {
    const base = edit(REAL, COVERAGE_TOOLS, "tools: [yq, jq, task]");
    const text = `${base.replace(/\n*$/, "\n")}
  - id: new-ocr-check
    changeset-gated: true
    requires:
      tools: [tesseract]
    command:
      - echo ocr
`;
    const { findings } = toolsFindings(text);
    assert.ok(findings.includes(line("new-ocr-check", "tesseract")), findings.join("\n"));
    assert.ok(findings.includes(line("figure-labels", "tesseract")), findings.join("\n"));
  });

  test("a gated command invoking task is covered through its own declared tool", () => {
    const text = edit(
      withGated(`
  - id: docs-build
    changeset-gated: true
    requires:
      tools: [task]
    command:
      - task docs:build
`),
      COVERAGE_TOOLS,
      "tools: [yq, jq, tesseract]",
    );
    assert.ok(toolsFindings(text).findings.includes(line("docs-build", "task")));
  });

  test("a python@* runtime of changeset-coverage provides python3", () => {
    const gated = `
  - id: python-check
    changeset-gated: true
    requires:
      tools: [python3]
    command:
      - python3 -V
`;
    assert.deepEqual(toolsFindings(withGated(gated)).findings, []);
    const noPython = edit(
      withGated(gated),
      COVERAGE_REQUIRES,
      `runtime: node@24\n      ${COVERAGE_TOOLS}`,
    );
    assert.deepEqual(toolsFindings(noPython).findings, [line("python-check", "python3")]);
  });

  test("scalar and list forms of requires.tools and requires.runtime are both read", () => {
    const text = `capabilities:
  - id: changeset-coverage
    requires:
      runtime: python@3.12
      tools: yq
  - id: scalar-tool
    changeset-gated: true
    requires:
      tools: jq
  - id: list-tool
    changeset-gated: true
    requires:
      tools: [yq, python3]
  - id: not-gated
    requires:
      tools: [task]
`;
    assert.deepEqual(toolsFindings(text), {
      findings: [line("scalar-tool", "jq")],
      gated: 2,
      tools: 3,
    });
  });

  test("the guard reads the document it is given: jq missing, then present", () => {
    const without = edit(REAL, COVERAGE_TOOLS, "tools: [yq, task, tesseract]");
    const failing = toolsFindings(without).findings;
    assert.ok(
      failing.length > 0 && failing.every((f) => f.includes(" needs jq ")),
      failing.join("\n"),
    );
    assert.deepEqual(toolsFindings(REAL).findings, []);
  });

  test("finding lines have the exact form, one per capability and tool, in reference order", () => {
    const text = edit(REAL, COVERAGE_TOOLS, "tools: [yq]");
    const { findings } = toolsFindings(text);
    assert.ok(findings.length > 0);
    for (const f of findings) {
      assert.match(
        f,
        /^ci-changeset-coverage-tools: \S+ needs \S+ but changeset-coverage does not require it$/,
      );
    }
    assert.equal(new Set(findings).size, findings.length, "no duplicate finding");
    const order = (id: string) => REAL.indexOf(`- id: ${id}\n`);
    const ids = findings.map((f) => f.split(" ")[1] ?? "");
    const positions = ids.map(order);
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
  });

  test("the guard cannot be skipped: changeset-coverage-test is unfiltered, ungated and runs this file", () => {
    const cap = capability("changeset-coverage-test");
    const triggers = deref(get(cap, ["trigger"]));
    assert.ok(triggers instanceof YqSeq);
    const byEvent = new Map<string, YqNode>();
    for (const raw of triggers.items) {
      const trig = deref(raw);
      const on = deref(get(trig, ["on"]));
      assert.ok(on !== null && !(on instanceof YqMap) && !(on instanceof YqSeq));
      byEvent.set(render(on), trig);
      assert.equal(get(trig, ["paths"]), null, `${render(on)} trigger has no paths: filter`);
    }
    assert.ok(byEvent.has("pull-request"), "pull-request trigger");
    assert.ok(byEvent.has("push"), "push trigger");
    const gated = deref(get(cap, ["changeset-gated"]));
    assert.ok(gated === null || render(gated) !== "true", "not changeset-gated");
    const commands = deref(get(cap, ["command"]));
    assert.ok(commands instanceof YqSeq);
    const texts = commands.items.map((c) => render(deref(c)));
    assert.ok(
      texts.some((c) => c.includes("--test scripts/tests/ci-changeset-coverage-tools.test.ts")),
      "a command runs this test file",
    );
  });
});
