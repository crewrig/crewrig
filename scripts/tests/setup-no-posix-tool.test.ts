// setup-no-posix-tool.test.ts — the setup modules and entries never spawn a POSIX tool (spec 0256
// requirement 39): a static scan of scripts/lib/setup/**/*.ts and scripts/setup-<cli>-interactive.ts,
// on the source text with its comments stripped, for (1) a spawn call whose first argument names a
// POSIX tool, (2) an argv array literal starting with one (the `Spawner` shape, tool name first),
// (3) `shell: true`, (4) any shell-string API (`exec`, `execSync`). Allowed tools: node, npm, git,
// claude, agy, gh, copilot, gemini, pipx, python, python3, py, systemctl, launchctl, schtasks,
// powershell, netstat, ps. Not tested here: the win32 half of requirement 39 (no `bash` in a Windows
// MCP entry's registered command) is tested by the MCP writer PR, which owns that file.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { lineOf, listMatching, listTsFiles, REPO, stripComments } from "./lib/setup-source-scan.ts";
import type { Finding } from "./lib/setup-source-scan.ts";

const BANNED = "fzf jq find sed awk wc diff grep ls cp mv rm mktemp curl bash sh".split(" ");
const TOOL = new RegExp(`^(?:${BANNED.join("|")})$`);

/** `/usr/bin/jq`, `C:\\tools\\jq.exe` and `jq` all name the tool `jq`. */
function toolName(literal: string): string {
  const base = literal.split(/[\\/]/).pop() ?? literal;
  return base.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

const SPAWN_LITERAL =
  /\b(?:spawnSync|spawn|execFileSync|execFile|fork)\s*\(\s*(["'`])([^"'`\n]+)\1/g;
const ARGV_LITERAL = /[\w$.]\s*\(\s*\[\s*(["'`])([^"'`\n]+)\1/g;
const SHELL_TRUE = /\bshell\s*:\s*true\b/g;
const SHELL_STRING: readonly RegExp[] = [
  /\bexecSync\s*\(/g,
  /(?<![\w$.])exec\s*\(/g,
  /\b(?:child_process|childProcess|cp)\.exec\s*\(/g,
  /\bimport\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*from\s*["'](?:node:)?child_process["']/g,
];

/** The POSIX-tool findings of one source text; `text` starts with the rule that fired. */
export function scanSource(file: string, source: string): Finding[] {
  const code = stripComments(source);
  const found: Finding[] = [];
  const add = (rule: string, m: RegExpMatchArray): void =>
    void found.push({ file, line: lineOf(code, m.index ?? 0), text: `${rule}: ${m[0].trim()}` });
  for (const m of code.matchAll(SPAWN_LITERAL)) {
    if (TOOL.test(toolName(m[2] as string))) add("spawn-literal", m);
  }
  for (const m of code.matchAll(ARGV_LITERAL)) {
    if (TOOL.test(toolName(m[2] as string))) add("argv-literal", m);
  }
  for (const m of code.matchAll(SHELL_TRUE)) add("shell-true", m);
  for (const re of SHELL_STRING) for (const m of code.matchAll(re)) add("shell-string", m);
  return found;
}

function scannedFiles(): string[] {
  return [
    ...listTsFiles("scripts/lib/setup"),
    ...listMatching("scripts", /^setup-[a-z]+-interactive\.ts$/),
  ];
}

describe("setup sources spawn no POSIX tool", () => {
  test("no module under scripts/lib/setup/ and no entry names one", () => {
    const files = scannedFiles();
    assert.ok(files.length >= 10, `only ${files.length} files scanned: the scan is vacuous`);
    assert.ok(files.includes("scripts/lib/setup/spawner.ts"), "the spawner was not scanned");
    const offenders = files.flatMap((rel) =>
      scanSource(rel, fs.readFileSync(path.join(REPO, rel), "utf8")),
    );
    assert.deepEqual(
      offenders.map((f) => `${f.file}:${f.line} ${f.text}`),
      [],
    );
  });
});

describe("scanner self-test", () => {
  const rules = (source: string): string[] =>
    scanSource("snippet.ts", source).map((f) => f.text.split(":")[0] as string);

  const OFFENDING: readonly (readonly [string, string, string])[] = [
    [
      "a banned tool as the first spawn argument",
      'spawnSync("bash", ["-c", "x"]);',
      "spawn-literal",
    ],
    ["an absolute path to a banned tool", 'execFileSync("/usr/bin/jq", []);', "spawn-literal"],
    ["a Windows executable name", "spawn('C:\\\\tools\\\\Grep.exe', []);", "spawn-literal"],
    ["a banned tool as argv[0] of a Spawner call", 'run(["grep", "-r", "x"]);', "argv-literal"],
    ["a method receiving an argv array", 'ctx.spawn(["fzf"], { input: "a" });', "argv-literal"],
    ["shell: true", 'spawn("node", [], { shell: true });', "shell-true"],
    ["execSync", 'execSync("echo hi");', "shell-string"],
    ["a bare exec call", 'exec("echo hi");', "shell-string"],
    ["child_process.exec", 'cp.exec("echo hi");', "shell-string"],
    ["an exec import", 'import { exec } from "node:child_process";', "shell-string"],
  ];
  for (const [name, snippet, rule] of OFFENDING) {
    test(`flags ${name}`, () => assert.ok(rules(snippet).includes(rule), snippet));
  }

  const ALLOWED: readonly (readonly [string, string])[] = [
    ["node", 'spawnSync("node", ["a.ts"]);'],
    [
      "every allowed tool as argv[0]",
      'run(["git", "status"]); run(["gh", "pr"]); run(["python3", "-V"]);',
    ],
    ["a RegExp exec method", 'const m = /grep/.exec("grep"); re.exec(text);'],
    ["a commented-out offender", '// spawnSync("bash", []);\n/* run(["jq"]) */'],
    ["a POSIX tool name in a message", 'io.err("install jq or grep first");'],
    ["a tool name as a plain array member", 'const tools = ["jq", "git"].includes(x);'],
    ["execFileSync of an allowed tool", 'execFileSync("systemctl", ["status"]);'],
  ];
  for (const [name, snippet] of ALLOWED) {
    test(`does not flag ${name}`, () => assert.deepEqual(rules(snippet), [], snippet));
  }
});
