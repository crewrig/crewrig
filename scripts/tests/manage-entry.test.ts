// manage-entry.test.ts — the four manage-*-component.ts entries as child processes in an install
// sandbox (spec 0255 R3, R12; ticket #1334, plan step 14): usage, a placement in each mode, the
// link prompt answered through standard input, and a clean standard error (no Node.js warning).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createInstallSandbox } from "./lib/install-sandbox.ts";
import type { InstallSandbox } from "./lib/install-sandbox.ts";

const sandbox = createInstallSandbox({ deps: "none" });

/** Run `scripts/manage-<cli>-component.ts` in the sandbox, `input` being the whole standard input. */
function entry(
  box: InstallSandbox,
  cli: string,
  args: readonly string[],
  input = "",
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...box.hermetic.env, LC_ALL: "C" };
  delete env["REPO_DIR"];
  const file = box.tree.resolve(`scripts/manage-${cli}-component.ts`);
  const res = spawnSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    env,
    cwd: box.tree.root,
    input,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const TYPES: Readonly<Record<string, string>> = {
  claude: "claude-skills, policies, mcp-servers",
  copilot: "skills, commands, mcp-servers",
  antigravity: "antigravity-skills, policies",
  workspace: "commands, skills, hooks, agents, policies",
};

describe("manage entries: usage", () => {
  for (const [cli, types] of Object.entries(TYPES)) {
    it(`${cli}: no type prints the usage and the Types line, exit 1`, () => {
      const res = entry(sandbox, cli, []);
      assert.equal(res.status, 1);
      const lines = res.stdout.split("\n");
      assert.equal(lines[0], `Usage: manage-${cli}-component.sh <install|link> <type> [name]`);
      assert.ok((lines[1] ?? "").startsWith("Types: "), lines[1]);
      assert.ok((lines[1] ?? "").includes(types.split(", ")[0] ?? ""), lines[1]);
      assert.equal(res.stderr, "");
    });
  }
});

/** The authored fixture each CLI places without a rebuild: `[artifact path, file, landing path]`. */
const PLACED: Readonly<Record<string, readonly [string, string, string, string]>> = {
  claude: ["policies", "demo.md", ".claude/rules/demo.md", "policies"],
  antigravity: ["policies", "demo.md", ".gemini/antigravity-cli/rules/demo.md", "policies"],
  workspace: ["commands", "demo.toml", ".gemini/commands/demo.toml", "commands"],
};

describe("manage entries: placement", () => {
  for (const [cli, [dir, file, landing, type]] of Object.entries(PLACED)) {
    it(`${cli}: install copies, link asks first and links on y`, () => {
      const box = createInstallSandbox({ deps: "none" });
      box.tree.artifact(`library/${dir}/${file}`, "demo\n");
      const dest = path.join(box.home, landing);

      const installed = entry(box, cli, ["install", type, "demo"]);
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(installed.stderr, "");
      assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
      assert.equal(fs.readFileSync(dest, "utf8"), "demo\n");

      // The workspace script prints the warning and asks nothing; the others stop on a "n".
      if (cli !== "workspace") {
        const declined = entry(box, cli, ["link", type, "demo"], "n\n");
        assert.equal(declined.status, 1);
        assert.match(declined.stdout, /^WARNING: Symlink mode/);
        assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
      }

      const linked = entry(box, cli, ["link", type, "demo"], "y\n");
      assert.equal(linked.status, 0, linked.stderr);
      assert.equal(linked.stderr, "");
      assert.ok(fs.lstatSync(dest).isSymbolicLink());
    });
  }

  it("copilot: an MCP declaration is merged without a rebuild", () => {
    const box = createInstallSandbox({ deps: "none" });
    box.tree.artifact("library/mcp-servers/demo.json", '{"command":"x"}\n');
    const res = entry(box, "copilot", ["install", "mcp-servers", "demo"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
    assert.match(res.stdout, /Merged: demo into mcpServers/);
    const config = fs.readFileSync(path.join(box.home, ".copilot/mcp-config.json"), "utf8");
    assert.ok(config.includes('"demo"'));
  });

  it("an unknown type prints the shell's lines on standard output, exit 1", () => {
    const res = entry(sandbox, "claude", ["install", "nope"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /^Error: unknown type 'nope'\nTypes: /);
    assert.equal(res.stderr, "");
  });
});
