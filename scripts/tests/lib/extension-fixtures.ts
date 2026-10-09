// extension-fixtures.ts — labelled manifest fixtures for the shell/TypeScript conformance suite
// (spec 0254 R22). Each fixture is JSON text: the suite writes it to a temp file for the shell and
// parses it with `parseJson` for the TypeScript twins. Every label is unique (the suite guards it).

import fs from "node:fs";
import path from "node:path";

import { REPO } from "./shell-extension-harness.ts";

export interface Fixture {
  readonly label: string;
  readonly json: string;
}

const j = (value: unknown): string => JSON.stringify(value);
const fx = (label: string, value: unknown): Fixture => ({ label, json: j(value) });
const raw = (label: string, json: string): Fixture => ({ label, json });

const ROOT = "${extensionRoot}";
const hook = (id: unknown, event: unknown, command: unknown, extra: object = {}): object => ({
  id,
  event,
  command,
  ...extra,
});
const withHooks = (label: string, hooks: unknown, name: unknown = "ext"): Fixture =>
  fx(label, { name, version: "1.0.0", hooks });
const withMcp = (label: string, mcpServers: unknown, name: unknown = "ext"): Fixture =>
  fx(label, { name, version: "1.0.0", mcpServers });
const stdio = (extra: object = {}): object => ({ command: "node", ...extra });

const real = fs.readFileSync(
  path.join(REPO, "extensions", "core", "hello-world", "extension.json"),
  "utf8",
);

const subjects: Fixture[] = [
  raw("real: hello-world", real),
  fx("subjects: every subject", {
    name: "all",
    version: "1.0.0",
    commands: { location: "commands/", convertToSkills: true },
    skills: { location: "skills/" },
    agents: { location: "agents/" },
    context: { source: "CONTEXT.md" },
    hooks: [hook("a", "PreToolUse", `${ROOT}/a.sh`, { matcher: "shell" })],
    mcpServers: { s: stdio({ args: [`${ROOT}/s.js`] }) },
  }),
  fx("subjects: empty object", {}),
  fx("subjects: name and version only", { name: "bare", version: "0.0.1" }),
];

const hooks: Fixture[] = [
  withHooks("hooks: PreToolUse with matcher", [
    hook("a", "PreToolUse", "x.sh", { matcher: "shell" }),
  ]),
  withHooks("hooks: PreToolUse without matcher", [hook("a", "PreToolUse", "x.sh")]),
  withHooks("hooks: UserPromptSubmit without matcher", [hook("p", "UserPromptSubmit", "p.sh")]),
  withHooks("hooks: matcher on an event that accepts none", [
    hook("p", "UserPromptSubmit", "p.sh", { matcher: "shell" }),
  ]),
  withHooks("hooks: unknown event", [hook("a", "PostToolUse", "x.sh")]),
  withHooks("hooks: unknown matcher class", [hook("a", "PreToolUse", "x.sh", { matcher: "zsh" })]),
  withHooks("hooks: empty matcher string", [hook("a", "PreToolUse", "x.sh", { matcher: "" })]),
  withHooks("hooks: null matcher", [hook("a", "PreToolUse", "x.sh", { matcher: null })]),
  withHooks("hooks: numeric matcher", [hook("a", "PreToolUse", "x.sh", { matcher: 5 })]),
  withHooks("hooks: missing id", [{ event: "PreToolUse", command: "x.sh" }]),
  withHooks("hooks: missing event", [{ id: "a", command: "x.sh" }]),
  withHooks("hooks: missing command", [{ id: "a", event: "PreToolUse" }]),
  withHooks("hooks: entry is empty object", [{}]),
  withHooks("hooks: id outside the pattern", [hook("bad id", "PreToolUse", "x.sh")]),
  withHooks("hooks: id with allowed punctuation", [hook("a.b_c-1", "PreToolUse", "x.sh")]),
  withHooks("hooks: numeric id", [hook(7, "PreToolUse", "x.sh")]),
  withHooks("hooks: section is an object", { id: "a" }),
  withHooks("hooks: section is a string", "nope"),
  withHooks("hooks: section is null", null),
  withHooks("hooks: empty array", []),
  withHooks("hooks: entry is a string", ["nope"]),
  withHooks("hooks: root token twice", [
    hook("a", "PreToolUse", `bash ${ROOT}/a.sh --cfg ${ROOT}/cfg.json`, { matcher: "shell" }),
  ]),
  withHooks("hooks: bare root token at the end", [hook("a", "PreToolUse", `run ${ROOT}`)]),
  withHooks("hooks: command with a trailing line feed", [hook("a", "PreToolUse", "x.sh\n")]),
  withHooks("hooks: two entries sharing an event", [
    hook("a", "PreToolUse", "a.sh", { matcher: "shell" }),
    hook("b", "PreToolUse", "b.sh"),
    hook("c", "UserPromptSubmit", "c.sh"),
  ]),
  fx("hooks: no name (antigravity id)", { hooks: [hook("a", "PreToolUse", "x.sh")] }),
  withHooks("hooks: numeric name", [hook("a", "PreToolUse", "x.sh")], 12),
  withHooks("hooks: unicode command", [hook("a", "PreToolUse", 'écho "é" ${HOME}/x')]),
];

const server = (label: string, entry: unknown, name = "srv"): Fixture =>
  withMcp(label, { [name]: entry });
const mcp: Fixture[] = [
  server("mcp: stdio", stdio({ args: ["a"], env: { K: "v" }, cwd: "/w", timeout: 30 })),
  server("mcp: stdio explicit transport", stdio({ transport: "stdio" })),
  server("mcp: stdio null transport", stdio({ transport: null })),
  server("mcp: http", { transport: "http", url: "https://h/x", headers: { A: "b" }, timeout: 9 }),
  server("mcp: sse", { transport: "sse", url: "https://h/s", headers: { A: "b" } }),
  server("mcp: stdio missing command", { args: ["a"] }),
  server("mcp: stdio empty command", { command: "" }),
  server("mcp: http missing url", { transport: "http" }),
  server("mcp: sse missing url", { transport: "sse", headers: {} }),
  server("mcp: stdio inadmissible key", stdio({ url: "https://h", trust: true })),
  server("mcp: http inadmissible key", { transport: "http", url: "https://h", command: "x" }),
  server("mcp: sse inadmissible key", { transport: "sse", url: "https://h", args: [] }),
  server("mcp: unknown transport", { transport: "ws", url: "ws://h" }),
  server("mcp: reserved name mempalace", stdio(), "mempalace"),
  server("mcp: reserved name sequentialthinking", stdio(), "sequentialthinking"),
  server("mcp: root token in command", { command: `${ROOT}/bin/run` }),
  server("mcp: root token in args and cwd", stdio({ args: [`${ROOT}/a.js`, "-x"], cwd: ROOT })),
  server("mcp: other token in command", { command: "${HOME}/bin" }),
  server("mcp: other token in args", stdio({ args: ["${extensionPath}/a", "${A}${B}"] })),
  server("mcp: path token in env", stdio({ env: { P: `${ROOT}/x`, Q: "${CLAUDE_PLUGIN_ROOT}" } })),
  server("mcp: gemini slash token in env", stdio({ env: { P: "${/}" } })),
  server("mcp: path token in headers", {
    transport: "http",
    url: "https://h",
    headers: { P: "${COPILOT_PLUGIN_ROOT}" },
  }),
  server("mcp: ordinary interpolation in env", stdio({ env: { KEY: "${API_KEY}" } })),
  server("mcp: root token in url", { transport: "http", url: `https://h/${ROOT}` }),
  withMcp("mcp: two servers, sorted by name", { zeta: stdio(), alpha: stdio({ args: [ROOT] }) }),
  withMcp("mcp: section is an array", [stdio()]),
  withMcp("mcp: section is a string", "nope"),
  withMcp("mcp: section is null", null),
  withMcp("mcp: section is empty", {}),
  server("mcp: entry is null", null),
  server("mcp: entry is a string", "nope"),
  server("mcp: falsy optional members", stdio({ args: false, env: null, cwd: "", timeout: 0 })),
  server("mcp: args is not an array", stdio({ args: "x" })),
  fx("mcp: no name, reserved name", { mcpServers: { mempalace: stdio() } }),
];

const percli: Fixture[] = [
  fx("percli: admissible keys", {
    name: "p",
    gemini: { themes: [] },
    claude: { author: { name: "a" }, settings: {}, lsp: {}, bin: null, defaultAllowedTools: [] },
  }),
  fx("percli: inadmissible key per CLI", {
    name: "p",
    gemini: { x: 1 },
    claude: { zeta: 1, alpha: 2, settings: {} },
    copilot: { y: 1 },
    antigravity: { z: 1 },
  }),
  fx("percli: sections null, false and string", { gemini: null, claude: false, copilot: "s" }),
  fx("percli: section is an array", { copilot: [1, 2] }),
  fx("percli: section is a number", { antigravity: 4 }),
  fx("percli: empty key", { gemini: { "": 1 } }),
  fx("percli: unicode key order", { gemini: { é: 1, z: 2, a: 3, "😀": 4 } }),
];

const legacy: Fixture[] = [
  fx("legacy: components with subjects", {
    components: { skills: { enabled: true }, hooks: { enabled: false }, other: 1 },
  }),
  fx("legacy: components empty object", { components: {} }),
  fx("legacy: components null", { components: null }),
  fx("legacy: components string", { components: "x" }),
  fx("legacy: claude.skills", { claude: { skills: [] } }),
  fx("legacy: every retired per-CLI key", {
    claude: { skills: 1, agents: 2, rules: 3 },
    copilot: { pluginName: "c" },
    antigravity: { pluginName: "a" },
  }),
  fx("legacy: components and claude.skills", {
    components: { commands: {} },
    claude: { skills: 1, agents: 1 },
  }),
];

export const fixtures: readonly Fixture[] = [...subjects, ...hooks, ...mcp, ...percli, ...legacy];
