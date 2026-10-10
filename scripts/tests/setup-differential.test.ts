// setup-differential.test.ts — the comparison function of the parity proof (spec 0256 requirement 10)
// is itself tested on the host: an untagged difference fails and names the cell, a tagged one does not.
// The per-CLI proofs are setup-differential-<cli>.test.ts (Linux only; see lib/setup-differential-suite.ts).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { legDifference } from "./lib/setup-differential.ts";
import type { CaseResult } from "./lib/setup-golden-regen.ts";
import type { GoldenCase } from "./lib/setup-golden-types.ts";

describe("setup differential: the comparison itself (host-runnable)", () => {
  const c: GoldenCase = { id: "cell", cli: "claude", note: "a unit cell" };
  const opted: GoldenCase = { ...c, deviations: ["s"] };
  const base = {
    status: 0,
    stdout: "one\ntwo\n",
    stderr: "",
    tree: [{ path: "<HOME>/.claude/a", kind: "file", sha256: "1" }],
    bakCount: {},
    fzfRecords: [],
    curlRecords: [],
  } as unknown as CaseResult;
  const patched = (patch: Partial<CaseResult>): CaseResult => ({ ...base, ...patch });

  test("identical legs agree; an echoed question the shell never asked is a difference", () => {
    assert.equal(legDifference(c, base, base), undefined);
    // The `[answer]` echo is tagged (f), but the question SEQUENCE is compared: an echo with no matching
    // shell question cannot hide behind the tag (seat finding i1-F17).
    const echoed = patched({ stdout: "[answer] x=y\none\ntwo\n", fzfRecords: [] });
    assert.match(legDifference(c, base, echoed) ?? "", /question/i);
  });

  test("an injected untagged difference fails and names the cell and the first lines", () => {
    const message = legDifference(c, base, patched({ stdout: "one\nTWO\n" }));
    assert.match(message ?? "", /claude\/cell/);
    assert.match(message ?? "", /-two[\s\S]*\+TWO/);
    assert.match(legDifference(c, base, patched({ status: 1 })) ?? "", /status/);
    assert.match(legDifference(c, base, patched({ stderr: "boom\n" })) ?? "", /stderr/);
    assert.match(legDifference(c, base, patched({ bakCount: { x: 1 } })) ?? "", /tree\.json/);
  });

  test("tag (s) hides the launcher files for an opted-in cell only", () => {
    const launcher = { path: "<HOME>/.crewrig/mcp-daemon-launcher.ts", kind: "file", sha256: "2" };
    const extra = patched({ tree: [...base.tree, launcher] as unknown as CaseResult["tree"] });
    assert.equal(legDifference(opted, base, extra), undefined);
    assert.match(legDifference(c, base, extra) ?? "", /tree\.json/);
  });
});
