// service-names.test.ts — scripts/lib/service/names.ts (spec 0252 requirement 5).

import assert from "node:assert/strict";
import { test } from "node:test";
import { endpoint } from "../lib/usage-store/mcp.js";
import { daemonEndpoint, serviceNames, taskPathOf, windowsTaskPath } from "../lib/service/names.ts";

test("defaults of the two daemons", () => {
  assert.deepEqual(serviceNames("mcp", {}), {
    kind: "mcp",
    label: "com.mempalace.mcp-server",
    unit: "mempalace-mcp-server",
  });
  assert.deepEqual(serviceNames("chroma", {}), {
    kind: "chroma",
    label: "com.mempalace.chroma-server",
    unit: "mempalace-chroma-server",
  });
});

test("the overrides apply to the MCP daemon only, and an empty value means the default", () => {
  const env = { MEMPALACE_MCP_LABEL: "com.test.mcp", MEMPALACE_MCP_UNIT: "test-mcp" };
  assert.equal(serviceNames("mcp", env).label, "com.test.mcp");
  assert.equal(serviceNames("mcp", env).unit, "test-mcp");
  assert.equal(serviceNames("chroma", env).label, "com.mempalace.chroma-server");
  assert.equal(
    serviceNames("mcp", { MEMPALACE_MCP_LABEL: "", MEMPALACE_MCP_UNIT: "" }).unit,
    "mempalace-mcp-server",
  );
});

test("the Windows task path is \\CrewRig\\<leaf>, the unit naming the leaf", () => {
  assert.equal(taskPathOf(serviceNames("mcp", {})), "\\CrewRig\\mempalace-mcp-server");
  assert.equal(taskPathOf(serviceNames("chroma", {})), "\\CrewRig\\mempalace-chroma-server");
  assert.equal(
    taskPathOf(serviceNames("mcp", { MEMPALACE_MCP_UNIT: "mempalace-test-mcp-7" })),
    "\\CrewRig\\mempalace-test-mcp-7",
  );
});

test("a leaf that would escape the folder is refused", () => {
  for (const leaf of ["", "a\\b", "..\\x", "a/b", "a b", "-x", "a\nb"]) {
    assert.throws(() => windowsTaskPath(leaf), RangeError, JSON.stringify(leaf));
  }
});

test("host and port come from the single definition in mcp.js", () => {
  assert.deepEqual(daemonEndpoint(), endpoint());
  const saved = { h: process.env["MEMPALACE_MCP_HOST"], p: process.env["MEMPALACE_MCP_PORT"] };
  try {
    delete process.env["MEMPALACE_MCP_HOST"];
    delete process.env["MEMPALACE_MCP_PORT"];
    assert.deepEqual(daemonEndpoint(), { host: "127.0.0.1", port: "41893" });
    process.env["MEMPALACE_MCP_PORT"] = "5555";
    assert.equal(daemonEndpoint().port, "5555");
  } finally {
    if (saved.h === undefined) delete process.env["MEMPALACE_MCP_HOST"];
    else process.env["MEMPALACE_MCP_HOST"] = saved.h;
    if (saved.p === undefined) delete process.env["MEMPALACE_MCP_PORT"];
    else process.env["MEMPALACE_MCP_PORT"] = saved.p;
  }
});
