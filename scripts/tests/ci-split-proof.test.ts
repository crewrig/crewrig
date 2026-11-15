// Tests for the split equivalence proof (spec 0309 R13) and the placement it checks (R2): a clean
// fixture passes, a stray `paths:` entry fails and is named, an edited moved block fails. Pure
// functions over strings, no file system.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { place, type Parts } from "../ci-split.ts";
import { splitBlocks } from "../lib/ci-split/blocks.ts";
import { proveSplit } from "../lib/ci-split/proof.ts";

const one = [{ ids: ["*"] }];
const PARTS: Parts = {
  gate: one,
  modules: one,
  governance: one,
  extensions: one,
  integration: one,
  windows: one,
  standalone: one,
};

const entry = (id: string, group: string, cmd: string, self: string): string =>
  `  # section of ${id}\n\n  - id: ${id}\n${group === "" ? "" : `    group: ${group}\n`}` +
  `    name: "${id}"\n    paths:\n      - "scripts/${id}.ts"\n      - "${self}"\n    command:\n      - ${cmd}\n`;

const BASE_REF = `# old header\ncapabilities:\n${entry("m1", "modules", "m-cmd", "ci/ci-capabilities.yml")}${entry("g1", "gate", "g-cmd", "ci/ci-capabilities.yml")}${entry("s1", "", "s-cmd", "scripts/x.ts")}`;

const job = (id: string, self: string, extra = ""): string =>
  `${id}:\n  stage: ${id}\n  script:\n    - "${id}-cmd"\n  rules:\n    - changes:\n        - "${self}"\n${extra}`;
const gitlab = (head: string, jobs: string[]): string =>
  `# GENERATED from ${head}\n# edit ${head} and run\n\nstages:\n  - gate\n\n${jobs.join("\n")}`;

const OLD = "ci/ci-capabilities.yml";
const BASE_GL = gitlab(OLD, [job("m1", OLD), job("g1", OLD), job("s1", "scripts/x.ts")]);
const NEW = "ci/capabilities/";
const SPLIT_GL = gitlab(NEW, [
  job("g1", "ci/capabilities/**"),
  job("m1", "ci/capabilities/**"),
  job("s1", "scripts/x.ts"),
]);

const files = (): Map<string, string> => place(splitBlocks(BASE_REF), PARTS);
const prove = (gl: string, f = files()) =>
  proveSplit({ baseReference: BASE_REF, baseGitlab: BASE_GL, splitFiles: f, splitGitlab: gl });

describe("ci-split placement", () => {
  it("writes one file per group, the ungrouped ones to standalone, retargeting the self entry", () => {
    const f = files();
    assert.deepEqual([...f.keys()].sort(), ["gate.yml", "modules.yml", "standalone.yml"]);
    assert.match(f.get("gate.yml") as string, /^# CI capabilities: group gate .*\ncapabilities:\n/);
    assert.match(f.get("gate.yml") as string, /- "ci\/capabilities\/\*\*"/);
    assert.doesNotMatch(f.get("gate.yml") as string, /ci-capabilities\.yml/);
  });

  it("takes the first matching part and rejects a parts file without a final `*`", () => {
    const parts: Parts = {
      ...PARTS,
      gate: [
        { part: "a", ids: ["g*"] },
        { part: "b", ids: ["*"] },
      ],
    };
    assert.deepEqual([...place(splitBlocks(BASE_REF), parts).keys()].sort(), [
      "gate-a.yml",
      "modules.yml",
      "standalone.yml",
    ]);
    assert.throws(() =>
      place(splitBlocks(BASE_REF), { ...PARTS, gate: [{ part: "a", ids: ["g*"] }] }),
    );
  });
});

describe("ci-split proof", () => {
  it("passes the clean split and counts the changed lines", () => {
    const r = prove(SPLIT_GL);
    assert.equal(r.ok, true, r.report.join("\n"));
    assert.ok(r.report.some((l) => l.includes("2 path entries + 2 header lines")));
    assert.ok(r.report.some((l) => l.includes("2 path entries retargeted")));
  });

  it("fails a stray `paths:` entry and names the job and the line", () => {
    const stray = SPLIT_GL.replace(
      'g1:\n  stage: g1\n  script:\n    - "g1-cmd"\n  rules:\n    - changes:\n        - "ci/capabilities/**"\n',
      'g1:\n  stage: g1\n  script:\n    - "g1-cmd"\n  rules:\n    - changes:\n        - "ci/capabilities/**"\n        - "docs/stray.md"\n',
    );
    const r = prove(stray);
    assert.equal(r.ok, false);
    assert.ok(
      r.report.some((l) => l.includes("job 'g1'") && l.includes('+         - "docs/stray.md"')),
    );
  });

  it("fails an edited block that moved with the split, in the pipeline", () => {
    const r = prove(SPLIT_GL.replace('"m1-cmd"', '"m1-edited"'));
    assert.equal(r.ok, false);
    assert.ok(r.report.some((l) => l.includes("job 'm1'") && l.includes("m1-edited")));
  });

  it("fails an edited block in the split reference", () => {
    const f = files();
    f.set("modules.yml", (f.get("modules.yml") as string).replace("m-cmd", "m-edited"));
    const r = prove(SPLIT_GL, f);
    assert.equal(r.ok, false);
    assert.ok(r.report.some((l) => l.includes("reference block 'm1'") && l.includes("m-edited")));
  });

  it("fails a job block left in the pre-split order", () => {
    const r = prove(
      gitlab(NEW, [
        job("m1", "ci/capabilities/**"),
        job("g1", "ci/capabilities/**"),
        job("s1", "scripts/x.ts"),
      ]),
    );
    assert.equal(r.ok, false);
    assert.ok(r.report.some((l) => l.includes("block order")));
  });
});
