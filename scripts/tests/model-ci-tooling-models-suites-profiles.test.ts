// model-ci-tooling-models-suites-profiles.test.ts — the UNCHANGED Bash suite of check-agent-profiles run through the
// differential wrapper (pure-checker mode): the suite must pass on the shell result, bar the
// yq-absent case, and the TS twin must equal the shell on every wrapped call.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { failLines, runSuite, SKIP, YQ_ABSENT } from "./lib/models-suite-differential.ts";

describe("check-agent-profiles suite through the differential wrapper", { skip: SKIP }, () => {
  test("the suite passes, bar the yq-absent case, and the twin equals the shell", async () => {
    const r = await runSuite("check-agent-profiles", "test-check-agent-profiles.sh");
    console.log(`check-agent-profiles: ${r.calls} wrapped calls in ${(r.ms / 1000).toFixed(1)}s`);
    assert.ok(r.calls > 0, `the wrapper must have recorded calls\n${r.out}`);
    assert.deepEqual(
      failLines(r.out).filter((l) => !l.startsWith(YQ_ABSENT)),
      [],
      r.out,
    );
    assert.ok(failLines(r.out).length <= 1, r.out);
    assert.deepEqual(r.diffs, [], `shell and twin differ:\n${r.diffs.join("\n")}`);
  });
});
