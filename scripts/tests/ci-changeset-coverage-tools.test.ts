// ci-changeset-coverage-tools.test.ts — the coverage-tools guard of the exhaustive run (spec 0147
// delta-02 R25, R28-R31, issue #1770; delta-03 R35-R37, issue #1825). Every tool required by a
// changeset-gated capability of ci/ci-capabilities.yml must be required by `changeset-coverage`, the
// capability that runs them all, and every gated `requires.install` must rank no higher than the
// install `changeset-coverage` performs (`none` < `omit-dev` < `install` = `ci`, unknown above all).
//
// The real reference is read at test time; every failing fixture is an in-memory edit of that text
// (or a document appended to it, or a small synthetic document), so the real file is never mutated.
// The first case is the guard itself: it fails with the finding lines when the real reference is
// inconsistent and prints the counts when it is not. Standard library plus the repo's yq reader and
// the GitLab generator's `installLines` (node:fs/node:path only), so it runs after `npm ci --omit=dev`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { installLines } from "../lib/build-ci/tools.ts";
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
function withGated(extra: string, base: string = REAL): string {
  return `${base.replace(/\n*$/, "\n")}${extra}`;
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

/** The R36 install finding line. */
function inst(id: string, value: string, performed: string): string {
  return `ci-changeset-coverage-tools: ${id} needs requires.install ${value} but changeset-coverage installs only ${performed}`;
}

function installOnly(findings: readonly string[]): string[] {
  return findings.filter((f) => f.includes(" needs requires.install "));
}

const OMIT_DEV = "npm ci --omit=dev --workspaces=false";

/**
 * The span of changeset-coverage's `command:` list in `text`, found from the unique `requires.tools`
 * line (a bare `npm ci` or `--omit=dev` line occurs several times in the reference). The list runs
 * from the first `      - ` / `      #` line after the next `    command:` line to the first other line.
 */
function coverageCommandSpan(text: string): { start: number; end: number; entries: string[] } {
  assert.equal(
    text.split(COVERAGE_TOOLS).length,
    2,
    `anchor must occur exactly once: ${COVERAGE_TOOLS}`,
  );
  const head = "\n    command:\n";
  const at = text.indexOf(head, text.indexOf(COVERAGE_TOOLS));
  const nextCap = text.indexOf("\n  - id: ", text.indexOf(COVERAGE_TOOLS));
  assert.ok(at > 0 && (nextCap < 0 || at < nextCap), "changeset-coverage has a command: list");
  const start = at + head.length;
  let end = start;
  const entries: string[] = [];
  while (end < text.length) {
    const eol = text.indexOf("\n", end);
    const ln = text.slice(end, eol < 0 ? text.length : eol);
    if (!/^ {6}(- |#)/.test(ln)) break;
    if (ln.startsWith("      - ")) entries.push(ln.slice(8));
    end = eol < 0 ? text.length : eol + 1;
  }
  return { start, end, entries };
}

/** `text` with changeset-coverage's `command:` list replaced by `entries` (comments dropped). */
function withCoverageCommands(text: string, entries: readonly string[]): string {
  const { start, end } = coverageCommandSpan(text);
  return `${text.slice(0, start)}${entries.map((e) => `      - ${e}\n`).join("")}${text.slice(end)}`;
}

/** changeset-coverage's non-install commands: every entry after its first (the provisioning line). */
const COVERAGE_TAIL = coverageCommandSpan(REAL).entries.slice(1);

/** `text` with gated capability `id`'s `requires.install: omit-dev` set to `value`. */
function withInstall(text: string, id: string, value: string): string {
  const from = text.indexOf(`\n  - id: ${id}\n`);
  assert.ok(from >= 0 && text.indexOf(`\n  - id: ${id}\n`, from + 1) < 0, `${id} occurs once`);
  const next = text.indexOf("\n  - id: ", from + 1);
  const to = next < 0 ? text.length : next;
  const block = edit(
    text.slice(from, to),
    "\n      install: omit-dev\n",
    `\n      install: ${value}\n`,
  );
  return `${text.slice(0, from)}${block}${text.slice(to)}`;
}

/** Copy (b): changeset-coverage's first command back to the production install (pre-delta-03). */
const COPY_B = withCoverageCommands(REAL, [OMIT_DEV, ...COVERAGE_TAIL]);

/** The four gated capabilities that need dev dependencies, in reference order (delta-03). */
function theFour(performed: string): string[] {
  return [
    inst("path-ownership-selftest", "ci", performed),
    inst("host-safety-selftest", "ci", performed),
    inst("lint-typescript-selftest", "ci", performed),
    inst("lint-specs-selftest", "install", performed),
  ];
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

describe("ci-changeset-coverage-tools: the install half (delta-03 R35-R37)", () => {
  test("the real reference yields no install finding", () => {
    const { findings } = toolsFindings(REAL);
    assert.deepEqual(installOnly(findings), [], findings.join("\n"));
  });

  test("a production install as the first command names the four capabilities with omit-dev", () => {
    assert.deepEqual(toolsFindings(COPY_B).findings, theFour("omit-dev"));
  });

  test("a production install after npm ci downgrades the run: the last provisioning line wins", () => {
    const text = withCoverageCommands(REAL, ["npm ci", OMIT_DEV, ...COVERAGE_TAIL]);
    assert.deepEqual(toolsFindings(text).findings, theFour("omit-dev"));
  });

  test("no provisioning line and no requires.install names the four capabilities with none", () => {
    const { findings } = toolsFindings(withCoverageCommands(REAL, COVERAGE_TAIL));
    for (const f of theFour("none")) assert.ok(findings.includes(f), findings.join("\n"));
    // Every gated omit-dev capability now ranks above none too; all name `none` as performed.
    assert.ok(
      findings.every((f) => f.endsWith(" but changeset-coverage installs only none")),
      findings.join("\n"),
    );
  });

  test("a gated capability raising omit-dev to ci is named at its reference position", () => {
    const text = withInstall(COPY_B, "check-plan-review", "ci");
    assert.deepEqual(toolsFindings(text).findings, [
      ...theFour("omit-dev"),
      inst("check-plan-review", "ci", "omit-dev"),
    ]);
  });

  test("ci and install rank equal: each satisfies the other", () => {
    assert.ok(
      !toolsFindings(REAL).findings.some((f) => f.includes(" lint-specs-selftest needs ")),
      "install is satisfied by a performed npm ci",
    );
    const text = withCoverageCommands(REAL, ["npm install", ...COVERAGE_TAIL]);
    assert.deepEqual(
      toolsFindings(text).findings,
      [],
      "ci is satisfied by a performed npm install",
    );
  });

  test("an omitted requires.install ranks as none, and a gated command's own npm ci is not counted", () => {
    const text = `capabilities:
  - id: changeset-coverage
    command:
      - node scripts/ci-changeset-coverage.ts
  - id: omitted-key
    changeset-gated: true
    command:
      - echo omitted
  - id: self-installing
    changeset-gated: true
    command:
      - npm ci
      - echo self
  - id: production
    changeset-gated: true
    requires:
      install: omit-dev
`;
    assert.deepEqual(toolsFindings(text).findings, [inst("production", "omit-dev", "none")]);
  });

  test("with no provisioning command, changeset-coverage's own requires.install is the performed install", () => {
    const migrated = (value: string) =>
      edit(
        withCoverageCommands(REAL, COVERAGE_TAIL),
        COVERAGE_TOOLS,
        `${COVERAGE_TOOLS}\n      install: ${value}`,
      );
    assert.deepEqual(toolsFindings(migrated("ci")).findings, []);
    assert.deepEqual(toolsFindings(migrated("omit-dev")).findings, theFour("omit-dev"));
  });

  test("an unknown requires.install value fails closed, prototype keys included", () => {
    const values = ["full", "constructor", "__proto__", "toString"];
    const text = withGated(
      values
        .map(
          (v, i) => `
  - id: unknown-${i}
    changeset-gated: true
    requires:
      install: ${v}
`,
        )
        .join(""),
    );
    assert.deepEqual(
      toolsFindings(text).findings,
      values.map((v, i) => inst(`unknown-${i}`, v, "ci")),
    );
  });

  test("an empty requires.install value prints as <empty> and keeps the R36 form", () => {
    const text = withGated(`
  - id: empty-install
    changeset-gated: true
    requires:
      install: ""
`);
    const { findings } = toolsFindings(text);
    assert.deepEqual(findings, [inst("empty-install", "<empty>", "ci")]);
    assert.match(
      findings[0] ?? "",
      /^ci-changeset-coverage-tools: \S+ needs requires\.install \S+ but changeset-coverage installs only \S+$/,
    );
  });

  test("the guard reads the document it is given: npm ci, then the production install", () => {
    assert.deepEqual(installOnly(toolsFindings(REAL).findings), []);
    assert.deepEqual(installOnly(toolsFindings(COPY_B).findings), theFour("omit-dev"));
  });

  test("install lines have the exact form, follow every tool line, in reference order", () => {
    const { findings } = toolsFindings(edit(COPY_B, COVERAGE_TOOLS, "tools: [yq]"));
    const installs = installOnly(findings);
    const toolLines = findings.filter((f) => !installs.includes(f));
    assert.ok(installs.length > 0 && toolLines.length > 0, findings.join("\n"));
    assert.deepEqual(findings, [...toolLines, ...installs], "tool findings come first");
    for (const f of installs) {
      assert.match(
        f,
        /^ci-changeset-coverage-tools: \S+ needs requires\.install \S+ but changeset-coverage installs only \S+$/,
      );
    }
    assert.equal(new Set(installs).size, installs.length, "one install finding per capability");
    const positions = installs.map((f) => REAL.indexOf(`- id: ${f.split(" ")[1] ?? ""}\n`));
    assert.ok(positions.every((p) => p >= 0));
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
  });

  test("a provisioning line is recognised through installLines, and printed as its value", () => {
    for (const value of ["ci", "install", "omit-dev"]) {
      const [provisioning] = installLines(value);
      assert.ok(provisioning !== undefined, `installLines(${value}) has a line`);
      const text = withGated(
        `
  - id: always-unknown
    changeset-gated: true
    requires:
      install: full
`,
        withCoverageCommands(REAL, [provisioning, ...COVERAGE_TAIL]),
      );
      assert.deepEqual(toolsFindings(text).findings.at(-1), inst("always-unknown", "full", value));
    }
  });
});
