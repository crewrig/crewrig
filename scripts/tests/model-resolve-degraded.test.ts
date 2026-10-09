// model-resolve-degraded.test.ts — the intelligence-absent path (rule (b)), the no-mapping and
// no-profile cases, and the never-throws guarantee of `resolveAgent` (spec 0250 R19; spec 0198
// R7, R17). Bash cases covered: C5, C6, rule (b) exhaustiveness and R7's tail clause.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import fs from "node:fs";
import os from "node:os";

import { createResolveContext, resolveAgent } from "../lib/model-resolve.ts";
import { extractFrontmatter } from "../lib/render-command.ts";
import {
  cleanupTmp,
  makeRun,
  mkTmp,
  orgRoot,
  realRoot,
  REPO,
  resolveProbe,
  rootWith,
  tab,
  TARGETS,
  writeProfile,
  yamlText,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const dir = mkTmp();
const real = (target: string, ...profile: string[]) =>
  resolveProbe(makeRun(REPO), writeProfile(dir, ...profile), target);

describe("rule (b): no intelligence declared", () => {
  test("a declared reasoning axis is dropped unserved-value exactly once", () => {
    const r = real("claude", "reasoning: medium");
    assert.deepEqual(
      [r.offeringId, r.diagLines],
      [
        "",
        [
          tab(
            "model-drop",
            "probe",
            "claude",
            "metadata.model.reasoning",
            "medium",
            "unserved-value",
          ),
        ],
      ],
    );
  });

  test("R7 tail: the tuning knobs the target expresses are still directed", () => {
    const r = real("gemini", "reasoning: medium", "tuning:\n  temperature: 0.5\n  max-turns: 7");
    assert.deepEqual(
      [r.offeringId, r.fmLines, r.diagLines.length],
      ["", ["temperature: 0.5", "max_turns: 7"], 1],
    );
  });

  test("every other declared axis is dropped unserved-value, in the fixed axis order", () => {
    const r = real(
      "gemini",
      "reasoning: low",
      "specialization: code",
      "context: 5",
      "speed: fast",
      "modalities: [text, image]",
      "locality: any",
    );
    const dropped = r.diagLines.map((l) => l.split("\t").slice(3).join("|"));
    assert.deepEqual(dropped, [
      "metadata.model.reasoning|low|unserved-value",
      "metadata.model.specialization|code|unserved-value",
      "metadata.model.context|5|unserved-value",
      "metadata.model.speed|fast|unserved-value",
      "metadata.model.modalities|[text,image]|unserved-value",
      "metadata.model.locality|any|unserved-value",
    ]);
  });
});

describe("C5, C6 and the degraded inputs", () => {
  test("C5 an unconfigured target: no offering, two unsupported-on-cli drops", () => {
    const r = real("copilot", "intelligence: xhigh", "reasoning: high");
    assert.deepEqual(
      [r.offeringId, r.fmLines, r.prose, r.diagLines],
      [
        "",
        [],
        "",
        [
          tab(
            "model-drop",
            "probe",
            "copilot",
            "metadata.model.intelligence",
            "xhigh",
            "unsupported-on-cli",
          ),
          tab(
            "model-drop",
            "probe",
            "copilot",
            "metadata.model.reasoning",
            "high",
            "unsupported-on-cli",
          ),
        ],
      ],
    );
  });

  test("C6 a target with no mapping file: one no-mapping note, no failure", () => {
    const r = real(
      "no-such-target-at-all",
      "intelligence: xhigh",
      "reasoning: high",
      "context: 500",
    );
    assert.deepEqual(
      [r.offeringId, r.fmLines, r.diagLines],
      [
        "",
        [],
        [
          tab(
            "model-note",
            "probe",
            "no-such-target-at-all",
            "no-mapping",
            "no mapping file is present for target no-such-target-at-all",
          ),
        ],
      ],
    );
  });

  test("a source with no profile resolves to nothing and records nothing", () => {
    const r = real("claude");
    assert.deepEqual(
      [r.offeringId, r.nativeValue, r.fmLines, r.prose, r.diagLines],
      ["", "", [], "", []],
    );
  });

  test("an unparseable or empty mapping reads as an empty document: everything is unsupported-on-cli", () => {
    for (const text of ["{{{ not yaml ::\n  - [", ""]) {
      const run = makeRun(rootWith({ "t.yml": text }));
      const r = resolveProbe(run, writeProfile(dir, "intelligence: high", "reasoning: low"), "t");
      assert.deepEqual(
        r.diagLines.map((l) => l.split("\t").slice(3).join("|")),
        [
          "metadata.model.intelligence|high|unsupported-on-cli",
          "metadata.model.reasoning|low|unsupported-on-cli",
        ],
      );
    }
  });

  test("never throws: a failing reader or extractor yields the empty result", () => {
    const boom = (): never => {
      throw new Error("boom");
    };
    const src = writeProfile(dir, "intelligence: high");
    const bad = makeRun(
      REPO,
      {},
      { yaml: { parse: boom, plain: boom, alt: boom, seq: boom, has: boom, entries: boom } },
    );
    assert.deepEqual(resolveAgent(bad.ctx, "probe", src, "claude"), {
      offeringId: "",
      nativeValue: "",
      fmLines: [],
      prose: "",
      diagLines: [],
    });
    const noFm = makeRun(REPO, {}, { extractFrontmatter: boom });
    assert.equal(resolveAgent(noFm.ctx, "probe", src, "claude").offeringId, "");
  });
});

describe("createResolveContext", () => {
  const base = { repoDir: REPO, yaml: yamlText, extractFrontmatter };

  test("defaults come from the running process", () => {
    const ctx = createResolveContext(base);
    assert.deepEqual(
      [ctx.env, ctx.platform, ctx.pid, ctx.tmpdir],
      [process.env, process.platform, process.pid, os.tmpdir()],
    );
    assert.equal(ctx.uid, process.platform === "win32" ? undefined : process.getuid?.());
  });

  test("any field can be overridden, and the standard-error sink is a function", () => {
    const ctx = createResolveContext({ ...base, env: {}, pid: 9, uid: 3, platform: "win32" });
    assert.deepEqual([ctx.env, ctx.pid, ctx.uid, ctx.platform], [{}, 9, 3, "win32"]);
    assert.equal(typeof ctx.stderr, "function");
  });
});

describe("resolveAgent writes no file other than the merge files (R19)", () => {
  const listing = (root: string): string[] =>
    fs.readdirSync(root, { recursive: true }).map(String).sort();
  const source = writeProfile(dir, "intelligence: high", "reasoning: low");

  test("a silent org channel: the repository and the temp directory are untouched", () => {
    const root = realRoot();
    const run = makeRun(root);
    const before = listing(root);
    for (const target of TARGETS) resolveProbe(run, source, target);
    assert.deepEqual([listing(root), listing(run.ctx.tmpdir)], [before, []]);
  });

  test("an active org channel: the repository is untouched, the merge root holds only the counter and one document", () => {
    const root = orgRoot("claude", "target: claude\nguard:\n  state: directed");
    const mergeDir = mkTmp();
    const before = listing(root);
    resolveProbe(makeRun(root, { MAPPING_MERGE_DIR: mergeDir }), source, "claude");
    assert.deepEqual(listing(root), before);
    for (const entry of listing(mergeDir))
      assert.match(entry, /^(\.merges|[0-9a-f]{64}([\\/]claude\.yml)?)$/);
    assert.equal(listing(mergeDir).length, 3);
  });
});
