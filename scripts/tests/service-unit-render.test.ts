// service-unit-render.test.ts — scripts/lib/service/unit-render.ts (spec 0252
// requirement 9): the substitutions, the palace-path rule, the interpreter
// token, and the two refusals, over the four shipped templates.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  chromaPalacePathFor,
  flavourOf,
  materialiseUnit,
  renderUnit,
} from "../lib/service/unit-render.ts";
import type { UnitValues } from "../lib/service/unit-render.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const NODE = "/opt/node/bin/node";
const CHROMA_PLIST = path.join(REPO, "config/launchd/com.mempalace.chroma-server.plist");
const MCP_PLIST = path.join(REPO, "config/launchd/com.mempalace.mcp-server.plist");
const CHROMA_UNIT = path.join(REPO, "config/systemd/mempalace-chroma-server.service");
const MCP_UNIT = path.join(REPO, "config/systemd/mempalace-mcp-server.service");

const chromaValues = (palace: string): UnitValues => ({
  mempalaceHome: "/home/agent/.mempalace",
  pipxPython: "/pipx/bin/python",
  chromaBin: "/pipx/bin/chroma",
  chromaPalacePath: palace,
  tlsExec: "/home/agent/.crewrig/tls-exec.ts",
});
const mcpValues: UnitValues = {
  mempalaceHome: "/home/agent/.mempalace",
  launcherPath: "/home/agent/.crewrig/mcp-daemon-launcher.ts",
};

function render(templatePath: string, values: UnitValues, nodePath = NODE) {
  const template = readFileSync(templatePath, "utf8");
  return renderUnit({ templatePath, template, targetPath: "/dst", values, nodePath });
}

function text(result: ReturnType<typeof render>): string {
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return result.ok ? result.text : "";
}

test("flavour follows the template extension", () => {
  assert.equal(flavourOf("a/b.plist"), "plist");
  assert.equal(flavourOf("a/b.service"), "service");
});

test("the palace-path rule: override, systemd default, launchd default", () => {
  assert.equal(chromaPalacePathFor("service", "/h", undefined), "%h/.mempalace/palace");
  assert.equal(chromaPalacePathFor("service", "/h", ""), "%h/.mempalace/palace");
  assert.equal(chromaPalacePathFor("plist", "/h", undefined), "/h/.mempalace/palace");
  assert.equal(chromaPalacePathFor("plist", "/h", "/data/p"), "/data/p");
  assert.equal(chromaPalacePathFor("service", "/h", "/data/p"), "/data/p");
});

test("the chroma plist: interpreter token, wrapper, interpreter, binary, palace", () => {
  const out = text(render(CHROMA_PLIST, chromaValues("/h/.mempalace/palace")));
  assert.match(
    out,
    /<string>\/opt\/node\/bin\/node<\/string>\s*<string>\/home\/agent\/\.crewrig\/tls-exec\.ts<\/string>/,
  );
  assert.ok(!out.includes("/bin/bash"));
  assert.ok(out.includes("<string>/pipx/bin/python</string>"));
  assert.ok(out.includes("<string>/pipx/bin/chroma</string>"));
  assert.ok(out.includes("<string>/h/.mempalace/palace</string>"));
  assert.ok(out.includes("/home/agent/.mempalace/chroma-server.log"));
});

test("the mcp plist runs the launcher program alone after node", () => {
  const out = text(render(MCP_PLIST, mcpValues));
  assert.match(
    out,
    /<string>\/opt\/node\/bin\/node<\/string>\s*<string>\/home\/agent\/\.crewrig\/mcp-daemon-launcher\.ts<\/string>/,
  );
  assert.ok(out.includes("/home/agent/.mempalace/mcp-server.log"));
});

test("the chroma unit keeps %h/.mempalace/palace and drops env bash", () => {
  const out = text(render(CHROMA_UNIT, chromaValues("%h/.mempalace/palace")));
  assert.ok(
    out.includes(
      "ExecStart=/opt/node/bin/node /home/agent/.crewrig/tls-exec.ts /pipx/bin/python /pipx/bin/chroma run --path %h/.mempalace/palace",
    ),
  );
  assert.ok(!out.includes("/usr/bin/env bash"));
});

test("the mcp unit names the launcher after node", () => {
  const out = text(render(MCP_UNIT, mcpValues));
  assert.match(
    out,
    /^ExecStart=\/opt\/node\/bin\/node \/home\/agent\/\.crewrig\/mcp-daemon-launcher\.ts$/m,
  );
});

test("a node path with a space is quoted in a unit and escaped in a plist", () => {
  const unit = text(render(MCP_UNIT, mcpValues, "/opt/my node/bin/node"));
  assert.ok(unit.includes('ExecStart="/opt/my node/bin/node" /home/agent'));
  const plist = text(render(MCP_PLIST, mcpValues, "/o&p/node"));
  assert.ok(plist.includes("<string>/o&amp;p/node</string>"));
});

test("a residual placeholder is refused and names the target", () => {
  const r = render(CHROMA_UNIT, { mempalaceHome: "/h" });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.includes("/dst still contains an unsubstituted placeholder."));
});

test("a template that lost its interpreter token is refused, naming the template", () => {
  for (const [name, body] of [
    ["x.plist", "<string>/usr/bin/python3</string>\n"],
    ["x.service", "ExecStart=/usr/bin/python3 __LAUNCHER_PATH__\n"],
  ] as const) {
    const r = renderUnit({
      templatePath: `/repo/config/${name}`,
      template: body,
      targetPath: "/dst",
      values: mcpValues,
      nodePath: NODE,
    });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.reason.includes(`/repo/config/${name}`));
    assert.ok(!r.ok && r.reason.includes("interpreter token"));
  }
});

test("materialiseUnit writes nothing on a refusal and the file on success", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "unit-render-"));
  try {
    const refused = path.join(dir, "refused", "a.service");
    assert.equal(materialiseUnit(CHROMA_UNIT, refused, { mempalaceHome: "/h" }, NODE).ok, false);
    assert.equal(existsSync(refused), false);
    assert.equal(existsSync(path.dirname(refused)), false);

    const missing = path.join(dir, "m.service");
    const gone = materialiseUnit(path.join(dir, "nope.service"), missing, {}, NODE);
    assert.ok(!gone.ok && gone.reason.includes("nope.service missing"));
    assert.equal(existsSync(missing), false);

    const target = path.join(dir, "ok", "mcp.service");
    assert.equal(materialiseUnit(MCP_UNIT, target, mcpValues, NODE).ok, true);
    assert.ok(readFileSync(target, "utf8").includes("ExecStart=/opt/node/bin/node "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
