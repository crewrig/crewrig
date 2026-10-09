// service-windows-task-xml.test.ts — scripts/lib/service/windows-task-xml.ts
// and the two templates of config/windows/ (spec 0252 requirement 7; plan v3 D5).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_TEMPLATE_DIR,
  chromaChain,
  decodeTaskFile,
  mcpChain,
  quoteArg,
  renderTaskFile,
  renderTaskXml,
  xmlEscape,
  xmlUnescape,
  type RenderInput,
} from "../lib/service/windows-task-xml.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const LAUNCHER = "C:\\Users\\dev\\.crewrig\\bin\\mcp-launcher.ts";
const WRAPPER = "C:\\Users\\dev\\.crewrig\\bin\\tls-exec.ts";

const mcp: RenderInput = {
  chain: mcpChain(NODE, LAUNCHER),
  taskUri: "\\CrewRig\\mempalace-mcp-server",
  userId: "HOST\\dev",
};
const chroma: RenderInput = {
  chain: chromaChain({
    nodePath: NODE,
    wrapper: WRAPPER,
    python: "C:\\pipx\\python.exe",
    chroma: "C:\\pipx\\Scripts\\chroma.exe",
    palacePath: "C:\\Users\\dev\\.mempalace\\chroma",
  }),
  taskUri: "\\CrewRig\\mempalace-chroma-server",
  userId: "HOST\\dev",
};

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  assert.ok(m?.[1] !== undefined, `${name} present`);
  return xmlUnescape(m[1]);
}

test("the templates carry exactly the five placeholders and no TLS or secret", () => {
  for (const file of ["mempalace-mcp-server.xml", "mempalace-chroma-server.xml"]) {
    const text = fs.readFileSync(path.join(DEFAULT_TEMPLATE_DIR, file), "utf8");
    const names = new Set(text.match(/__[A-Z][A-Z0-9_]*__/g));
    assert.deepEqual([...names].sort(), [
      "__NODE_PATH__",
      "__PROGRAM_ARGS__",
      "__PROGRAM_PATH__",
      "__TASK_URI__",
      "__USER_ID__",
    ]);
    assert.doesNotMatch(text, /TLS_EXEC|<Password>|bearer/i);
  }
});

test("the MCP task runs the launcher alone behind node", () => {
  const xml = renderTaskXml(mcp);
  assert.equal(tag(xml, "Command"), NODE);
  assert.equal(tag(xml, "Arguments"), `"${LAUNCHER}"`);
  assert.equal(tag(xml, "Description"), "crewrig:service-task \\CrewRig\\mempalace-mcp-server");
  assert.doesNotMatch(xml, /tls-exec|__/);
});

test("the ChromaDB task runs the wrapper, the flag, then the daemon command", () => {
  const xml = renderTaskXml(chroma);
  assert.equal(
    tag(xml, "Arguments"),
    `"${WRAPPER}" --end-nonzero-on-child-exit C:\\pipx\\python.exe C:\\pipx\\Scripts\\chroma.exe run ` +
      "--path C:\\Users\\dev\\.mempalace\\chroma --host 127.0.0.1 --port 8001",
  );
});

test("the settings fixed by requirement 7 are all present", () => {
  const xml = renderTaskXml(mcp);
  for (const frag of [
    "<LogonTrigger>",
    "<TimeTrigger>",
    "<Repetition>",
    "<LogonType>InteractiveToken</LogonType>",
    "<RunLevel>LeastPrivilege</RunLevel>",
    "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "<AllowHardTerminate>true</AllowHardTerminate>",
    "<Interval>PT1M</Interval>",
    "<Count>999</Count>",
  ]) {
    assert.ok(xml.includes(frag), frag);
  }
  assert.equal(tag(xml, "UserId"), "HOST\\dev");
  assert.doesNotMatch(xml, /<Password>|RunOnlyIfLoggedOn|S4U/);
});

test("the file is UTF-16LE with a byte-order mark and round-trips", () => {
  const bytes = renderTaskFile(mcp);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal((bytes.length - 2) % 2, 0);
  assert.equal(decodeTaskFile(bytes), renderTaskXml(mcp));
  assert.equal(bytes.subarray(2, 4).toString("hex"), "3c00");
});

test("values are XML-escaped and a path with a space is quoted", () => {
  const odd = { ...mcp, chain: mcpChain(NODE, "C:\\Users\\A & B <x>\\it's\\launcher.ts") };
  const xml = renderTaskXml(odd);
  assert.ok(xml.includes("A &amp; B &lt;x&gt;"));
  assert.doesNotMatch(xml, /A & B/);
  assert.equal(tag(xml, "Arguments"), '"C:\\Users\\A & B <x>\\it\'s\\launcher.ts"');
  assert.equal(xmlUnescape(xmlEscape("a&b<c>\"d'e")), "a&b<c>\"d'e");
  assert.equal(quoteArg("C:\\a b\\"), '"C:\\a b\\\\"');
  assert.equal(quoteArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteArg(""), '""');
  assert.equal(quoteArg("plain"), "plain");
});

test("a residual or unknown placeholder refuses the render", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-xml-"));
  try {
    const tpl = fs.readFileSync(
      path.join(DEFAULT_TEMPLATE_DIR, "mempalace-mcp-server.xml"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "mempalace-mcp-server.xml"),
      tpl.replace("<Priority>7", "<Priority>__PRIO__"),
    );
    assert.throws(
      () => renderTaskXml({ ...mcp, templateDir: dir }),
      /unsubstituted placeholder __PRIO__/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a value that looks like a placeholder is data, not a residual", () => {
  const xml = renderTaskXml({ ...mcp, chain: mcpChain(NODE, "C:\\x\\__init__.ts") });
  assert.equal(tag(xml, "Arguments"), '"C:\\x\\__init__.ts"');
});

test("invalid values are refused", () => {
  assert.throws(() => renderTaskXml({ ...mcp, chain: mcpChain(NODE, "") }), RangeError);
  assert.throws(() => renderTaskXml({ ...mcp, chain: mcpChain(NODE, 'a"b') }), RangeError);
  assert.throws(() => renderTaskXml({ ...mcp, userId: "a\nb" }), RangeError);
});
