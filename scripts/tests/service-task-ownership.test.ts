// service-task-ownership.test.ts — scripts/lib/service/task-ownership.ts
// (spec 0252 requirement 8; plan v3 D5 *Re-run and foreign task*, items (i) to (iv)).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyTask,
  expectationFromDefinition,
  firstToken,
  normalizeForCompare,
  type OwnershipExpectation,
} from "../lib/service/task-ownership.ts";
import {
  chromaChain,
  mcpChain,
  renderTaskXml,
  type RenderInput,
} from "../lib/service/windows-task-xml.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const MCP_URI = "\\CrewRig\\mempalace-mcp-server";
const CHROMA_URI = "\\CrewRig\\mempalace-chroma-server";
const LAUNCHER = "C:\\Users\\dev\\.crewrig\\bin\\mcp-launcher.ts";
const WRAPPER = "C:\\Users\\dev\\.crewrig\\bin\\tls-exec.ts";

function mcpInput(program = LAUNCHER): RenderInput {
  return { chain: mcpChain(NODE, program), taskUri: MCP_URI, userId: "H\\dev" };
}
function chromaInput(program = WRAPPER): RenderInput {
  return {
    chain: chromaChain({
      nodePath: NODE,
      wrapper: program,
      python: "py",
      chroma: "ch",
      palacePath: "p",
    }),
    taskUri: CHROMA_URI,
    userId: "H\\dev",
  };
}
const mcpExpect: OwnershipExpectation = { taskUri: MCP_URI, programPath: LAUNCHER };
const chromaExpect: OwnershipExpectation = { taskUri: CHROMA_URI, programPath: WRAPPER };

test("(i) a task rendered by windows-task-xml.ts itself is own, for each leaf", () => {
  assert.equal(classifyTask(renderTaskXml(mcpInput()), mcpExpect).kind, "own");
  assert.equal(classifyTask(renderTaskXml(chromaInput()), chromaExpect).kind, "own");
});

test("(i) the definition states the same expectation about itself", () => {
  assert.deepEqual(expectationFromDefinition(renderTaskXml(mcpInput())), mcpExpect);
  assert.deepEqual(expectationFromDefinition(renderTaskXml(chromaInput())), chromaExpect);
  assert.equal(expectationFromDefinition("<Task/>"), null);
});

test("(i) the Command is not compared: another Node.js is still own", () => {
  const xml = renderTaskXml({ ...mcpInput(), chain: mcpChain("D:\\other\\node.exe", LAUNCHER) });
  assert.equal(classifyTask(xml, mcpExpect).kind, "own");
});

test("(ii) cross-leaf program paths are foreign, both ways", () => {
  const mcpWithWrapper = renderTaskXml(mcpInput(WRAPPER));
  const chromaWithLauncher = renderTaskXml(chromaInput(LAUNCHER));
  assert.equal(classifyTask(mcpWithWrapper, mcpExpect).kind, "foreign");
  assert.equal(classifyTask(chromaWithLauncher, chromaExpect).kind, "foreign");
  assert.equal(classifyTask(renderTaskXml(chromaInput()), mcpExpect).kind, "foreign");
});

test("(iii) a different Description is foreign", () => {
  const xml = renderTaskXml(mcpInput()).replace(
    /<Description>[^<]*<\/Description>/,
    "<Description>Somebody else's job</Description>",
  );
  const r = classifyTask(xml, mcpExpect);
  assert.equal(r.kind, "foreign");
  const wrongUri = renderTaskXml(mcpInput()).replace(
    `service-task ${MCP_URI}`,
    `service-task ${CHROMA_URI}`,
  );
  assert.equal(classifyTask(wrongUri, mcpExpect).kind, "foreign");
  const noMarker = renderTaskXml(mcpInput()).replace("crewrig:service-task", "other:marker");
  assert.equal(classifyTask(noMarker, mcpExpect).kind, "foreign");
});

test("(iv) the marker with another program path is foreign", () => {
  const xml = renderTaskXml(mcpInput("C:\\elsewhere\\launcher.ts"));
  const r = classifyTask(xml, mcpExpect);
  assert.equal(r.kind, "foreign");
  assert.match(r.kind === "foreign" ? r.reason : "", /first argument/);
});

test("a non-ASCII profile path survives a code-page or UTF-16 reading of the output", () => {
  const home = "C:\\Users\\Hélène Müller\\.crewrig\\bin\\mcp-launcher.ts";
  const expect = { taskUri: MCP_URI, programPath: home };
  const xml = renderTaskXml(mcpInput(home));
  assert.equal(classifyTask(xml, expect).kind, "own");
  const codePage = xml.replace(/[^\u0000-\u007f]/g, "\uFFFD");
  assert.equal(classifyTask(codePage, expect).kind, "own");
  const utf16AsBytes = "\uFEFF" + [...xml].join("\u0000");
  assert.equal(classifyTask(utf16AsBytes, expect).kind, "own");
  assert.equal(
    classifyTask(xml, { ...expect, programPath: "C:\\Users\\Other\\x.ts" }).kind,
    "foreign",
  );
});

test("paths compare normalised: separators, case, trailing slash", () => {
  assert.equal(normalizeForCompare("C:\\Users\\Dev\\"), normalizeForCompare("c:/users/dev"));
  assert.equal(firstToken('"C:\\a b\\x.ts" --flag'), "C:\\a b\\x.ts");
  assert.equal(firstToken("C:\\a\\x.ts --flag"), "C:\\a\\x.ts");
  assert.equal(firstToken(""), "");
});
