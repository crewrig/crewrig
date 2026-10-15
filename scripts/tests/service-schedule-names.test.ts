// service-schedule-names.test.ts — scripts/lib/service/schedule-names.ts (spec 0258 requirement 15).

import assert from "node:assert/strict";
import { test } from "node:test";
import { serviceNames } from "../lib/service/names.ts";
import type { DaemonKind, ServiceNames } from "../lib/service/names.ts";
import { CURATOR_LABEL, CURATOR_UNIT, curatorNames } from "../lib/service/schedule-names.ts";

test("the curator label is the one the shell wrote, the unit the same string", () => {
  assert.equal(CURATOR_LABEL, "io.crewrig.harness-curator");
  assert.equal(CURATOR_UNIT, CURATOR_LABEL);
});

test("the default names carry the curator discriminator and the Windows task path", () => {
  assert.deepEqual(curatorNames(), {
    kind: "curator",
    label: "io.crewrig.harness-curator",
    unit: "io.crewrig.harness-curator",
    taskPath: "\\CrewRig\\io.crewrig.harness-curator",
  });
});

test("a leaf replaces the label, the unit and the task leaf (a test seam)", () => {
  assert.deepEqual(curatorNames("crewrig-test-curator-7"), {
    kind: "curator",
    label: "crewrig-test-curator-7",
    unit: "crewrig-test-curator-7",
    taskPath: "\\CrewRig\\crewrig-test-curator-7",
  });
});

test("a leaf that would escape the task folder is refused", () => {
  for (const leaf of ["", "a\\b", "..\\x", "a/b", "a b", "-x", "a\nb"]) {
    assert.throws(() => curatorNames(leaf), RangeError, JSON.stringify(leaf));
  }
});

test("the daemon names are untouched: the kinds stay mcp and chroma", () => {
  const kinds: DaemonKind[] = (["mcp", "chroma"] as const).map((k) => serviceNames(k, {}).kind);
  assert.deepEqual(kinds, ["mcp", "chroma"]);
  const helper = (n: Pick<ServiceNames, "label" | "unit">): string => `${n.label}/${n.unit}`;
  assert.equal(helper(curatorNames()), "io.crewrig.harness-curator/io.crewrig.harness-curator");
});
