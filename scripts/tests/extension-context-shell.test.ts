// extension-context-shell.test.ts — compares the pure context renderer with the real shell
// library `scripts/lib/render-context.sh` (spec 0254 R16 oracle): same stdout, same
// diagnostics and warnings on stderr, same success or failure, over a set of sources.
// POSIX only; skipped when bash, awk, jq or yq is missing.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderContext } from "../lib/extension/context-render.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB = path.join(ROOT, "scripts", "lib", "render-context.sh");
const TARGETS_JSON = path.join(ROOT, "scripts", "lib", "extension-targets.json");

function have(cmd: string): boolean {
  return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
}
const missing = ["bash", "jq", "yq"].filter((cmd) => !have(cmd));
const skip =
  process.platform === "win32"
    ? "POSIX only"
    : missing.length > 0
      ? `missing tools: ${missing.join(", ")}`
      : spawnSync("awk", ["BEGIN{}"]).status !== 0
        ? "missing tool: awk"
        : false;

const table = JSON.parse(fs.readFileSync(TARGETS_JSON, "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const knownTargets = Object.keys(table).filter((key) => !key.startsWith("_"));

const CASES: ReadonlyArray<readonly [string, string]> = [
  ["plain text with a trailing blank line", "# Title\n\nbody\n\n"],
  ["no trailing line feed", "no newline at end"],
  ["empty source", ""],
  ["only line feeds", "\n\n"],
  [
    "dropped and kept spans across lines",
    "a ${ONLY:claude}x\ny${ENDONLY} b\nc\n${EXCEPT:claude}\nz\n${ENDEXCEPT}\nd\n",
  ],
  ["kept span on its own lines", "a\n  ${ONLY:claude,copilot}\nmid\n  ${ENDONLY}\nb\n"],
  ["whitespace-only sentinel line with CR", "a\r\n${ONLY:claude}\r\nx\r\n${ENDONLY}\r\nb\r\n"],
  ["already blank lines survive", "a\n\n${ONLY:gemini}\nx\n${ENDONLY}\n\nb\n"],
  ["trimmed names", "${ONLY: claude\t, gemini }x${ENDONLY}\n"],
  ["empty element in a list", "${ONLY:claude,}x${ENDONLY}\n${ONLY:nope,}y${ENDONLY}\n"],
  ["escaped marker", "$${ONLY:copilot} and $${COMMAND:nope} and $${FOO}\n"],
  ["triple dollar", "$$${TOOL}\n"],
  ["names", "${TOOL} / ${EXTENSION} / ${TOOL}${EXTENSION}\n"],
  ["references", "${COMMAND:greet} ${SKILL:helper}\n- **${COMMAND:greet}**\n"],
  ["unresolved references", "x\n${COMMAND:nope}\n${SKILL:greet} ${COMMAND:helper}\n"],
  ["unterminated reference", "a ${COMMAND:greet\n"],
  ["empty reference name", "${COMMAND:}\n"],
  ["unknown target", "x\n${ONLY:bad1, claude, bad2}y${ENDONLY}\n"],
  ["empty target list", "a\n${ONLY:}\n"],
  ["span kept nowhere", "${EXCEPT:gemini,claude,copilot,antigravity}x${ENDEXCEPT}\n"],
  ["unclosed block", "a\n${ONLY:claude}\nx\n"],
  ["marker without brace", "a\nb ${ONLY:claude"],
  ["stray end", "a\n\n${ENDONLY}\n"],
  ["mismatched end", "${ONLY:claude}\nx\n${ENDEXCEPT}\n"],
  ["nested span", "${ONLY:claude}\n${ONLY:gemini}x${ENDONLY}${ENDONLY}\n"],
  ["crossing spans", "${ONLY:claude}a${EXCEPT:gemini}b${ENDONLY}c${ENDEXCEPT}\n"],
  [
    "near misses",
    "a\n${TOOl} ${FOO} ${FOO_BAR:x} ${SKELETON_NAME} ${extensionPath} ${_X} ${Foo}\n",
  ],
  [
    "line numbers after a dropped span",
    "a\n${ONLY:gemini}x\ny${ENDONLY}\n${COMMAND:nope}\n${FOO}\n",
  ],
  ["reserved byte U+0001", "a\u0001b\n"],
  ["non-ASCII text", "é — ${ONLY:claude}ü${ENDONLY} ${TOOL}\n"],
];

interface Shell {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runShell(dir: string, source: string, target: string): Shell {
  fs.writeFileSync(path.join(dir, "ctx.md"), source);
  const run = spawnSync(
    "bash",
    ["-c", 'source "$1"; render_context ctx.md "$2" manifest.json .', "bash", LIB, target],
    { cwd: dir, encoding: "utf8" },
  );
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

function column(target: string, name: string): string {
  const value = table[target]?.[name];
  return typeof value === "string" ? value : "";
}

describe("pure renderer against the shell library", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-shell-"));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      name: "demo",
      commands: { location: "commands/" },
      skills: { location: "skills/" },
    }),
  );
  fs.mkdirSync(path.join(dir, "commands"));
  fs.writeFileSync(path.join(dir, "commands", "a.md"), "---\nname: greet\n---\nbody\n");
  fs.mkdirSync(path.join(dir, "skills", "helper"), { recursive: true });

  for (const [label, source] of CASES) {
    for (const target of ["claude", "copilot", "antigravity"]) {
      test(`${label} (${target})`, () => {
        const shell = runShell(dir, source, target);
        const pure = renderContext({
          source,
          sourceName: "ctx.md",
          target,
          knownTargets,
          displayName: column(target, "displayName"),
          commandRef: column(target, "commandRef"),
          skillRef: column(target, "skillRef"),
          extName: "demo",
          declaredCommands: ["greet"],
          declaredSkills: ["helper"],
        });
        if (pure.ok) {
          assert.equal(shell.status, 0, shell.stderr);
          assert.equal(pure.text, shell.stdout);
          assert.equal(pure.warnings.map((line) => `${line}\n`).join(""), shell.stderr);
        } else {
          assert.notEqual(shell.status, 0);
          assert.equal(shell.stdout, "");
          assert.equal(pure.diagnostics.map((line) => `${line}\n`).join(""), shell.stderr);
        }
      });
    }
  }
});
