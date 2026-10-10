// install-all.test.ts — black-box contract of scripts/install-extension-all.ts (spec 0255 R11,
// R22(a)): the TypeScript leg only (the shell's own oracle is test-install-extension-all.sh).
// The four child installers are replaced in the sandbox by stubs that record their arguments and
// fail when their name is listed in FAIL; CLI presence is decided by stub binaries on the sandbox
// PATH, which holds no `jq`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createInstallSandbox, runEntry } from "./lib/install-sandbox.ts";
import type { InstallSandbox } from "./lib/install-sandbox.ts";

const CHILDREN = [
  "install-extension",
  "install-claude-plugin",
  "install-copilot-plugin",
  "install-antigravity-extension",
];

function makeSandbox(clis: readonly string[]): { sandbox: InstallSandbox; log: string } {
  const sandbox = createInstallSandbox({ deps: "none", clis });
  const log = path.join(sandbox.hermetic.root, "child-calls");
  for (const child of CHILDREN) {
    sandbox.tree.write(
      `scripts/${child}.ts`,
      [
        'import fs from "node:fs";',
        `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(child)} + " " + process.argv.slice(2).join(" ") + "\\n");`,
        'console.log("child stdout");',
        `if ((process.env.FAIL ?? "").split(" ").includes(${JSON.stringify(child)})) {`,
        '  console.error("child failure");',
        "  process.exit(2);",
        "}",
        "",
      ].join("\n"),
    );
  }
  sandbox.tree.write("extensions/core/hello-world/extension.json", "{}\n");
  return { sandbox, log };
}

const calls = (log: string): string[] =>
  fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").slice(0, -1) : [];

const run = (s: InstallSandbox, args: string[], env: Record<string, string> = {}) =>
  runEntry(s, "install-extension-all", args, { leg: "node", env });

describe("install-extension-all (TypeScript leg)", () => {
  it("installs on every CLI present, silencing the children", () => {
    const { sandbox, log } = makeSandbox(["claude", "copilot", "agy", "gemini"]);
    const res = run(sandbox, ["hello-world"]);
    const gemini = `${sandbox.home}/.gemini`;
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      res.stdout,
      "Installing extension 'hello-world' across available CLIs...\n" +
        `  [INSTALLED] Gemini CLI (${gemini}/extensions/hello-world)\n` +
        "  [INSTALLED] Claude Code\n  [INSTALLED] GitHub Copilot CLI\n  [INSTALLED] Antigravity CLI\n" +
        "\nSummary: Successfully installed 'hello-world' across 4 CLI target(s) (0 skipped).\n",
    );
    assert.equal(res.stderr, "");
    assert.deepEqual(calls(log), [
      "install-extension install hello-world",
      "install-claude-plugin hello-world",
      "install-copilot-plugin hello-world",
      "install-antigravity-extension hello-world",
    ]);
  });

  it("skips a CLI whose binary is absent, with no jq needed", () => {
    const { sandbox, log } = makeSandbox(["gemini"]);
    const res = run(sandbox, ["hello-world"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(
      res.stdout.includes("  [SKIPPED]   Claude Code ('claude' CLI binary not found in PATH)\n"),
    );
    assert.ok(
      res.stdout.includes(
        "  [SKIPPED]   GitHub Copilot CLI ('copilot' CLI binary not found in PATH)\n",
      ),
    );
    assert.ok(
      res.stdout.includes("  [SKIPPED]   Antigravity CLI ('agy' CLI binary not found in PATH)\n"),
    );
    assert.equal(res.stdout.includes("jq"), false);
    assert.ok(res.stdout.endsWith("(3 skipped).\n"));
    assert.deepEqual(calls(log), ["install-extension install hello-world"]);
  });

  it("uses a GEMINI_HOME directory in place of the gemini binary", () => {
    const { sandbox } = makeSandbox([]);
    const home = path.join(sandbox.hermetic.root, "gem");
    fs.mkdirSync(home);
    const res = run(sandbox, ["hello-world"], { GEMINI_HOME: home });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes(`  [INSTALLED] Gemini CLI (${home}/extensions/hello-world)\n`));
  });

  it("exits 1 when every CLI is skipped", () => {
    const { sandbox, log } = makeSandbox([]);
    const gemini = path.join(sandbox.hermetic.root, "nowhere");
    const res = run(sandbox, ["hello-world"], { GEMINI_HOME: gemini });
    assert.equal(res.status, 1);
    assert.ok(
      res.stdout.includes(
        `  [SKIPPED]   Gemini CLI (neither '${gemini}' directory nor 'gemini' CLI binary found)\n`,
      ),
    );
    assert.equal(res.stdout.split("[SKIPPED]").length - 1, 4);
    assert.equal(
      res.stderr,
      "Error: No supported CLI targets were available; all 4 target(s) were skipped.\n",
    );
    assert.deepEqual(calls(log), []);
  });

  it("reports [FAILED] on stderr, counts it and exits 1", () => {
    const { sandbox } = makeSandbox(["claude", "copilot", "agy", "gemini"]);
    const res = run(sandbox, ["hello-world"], { FAIL: "install-claude-plugin install-extension" });
    assert.equal(res.status, 1);
    assert.equal(
      res.stderr,
      "  [FAILED]    Gemini CLI (install-extension.sh failed)\n" +
        "  [FAILED]    Claude Code (install-claude-plugin.sh failed)\n" +
        "Error: Installation failed for 2 target(s) (2 installed, 0 skipped, 2 failed).\n",
    );
    assert.ok(res.stdout.includes("  [INSTALLED] GitHub Copilot CLI\n"));
    assert.equal(res.stdout.includes("Summary:"), false);
  });

  it("prints the usage on stdout: exit 1 without a name, 0 for -h and --help", () => {
    const { sandbox } = makeSandbox([]);
    const usage =
      "Usage: install-extension-all.sh <extension-name>\n\nInstalls an extension across";
    const none = run(sandbox, []);
    assert.equal(none.status, 1);
    assert.ok(none.stdout.startsWith(usage));
    for (const flag of ["-h", "--help"]) {
      const res = run(sandbox, [flag]);
      assert.equal(res.status, 0);
      assert.ok(res.stdout.startsWith(usage));
      assert.ok(
        res.stdout.endsWith("(Gemini CLI, Claude Code, GitHub Copilot CLI, Antigravity CLI).\n"),
      );
    }
  });

  it("rejects an unknown extension and one present in several tiers", () => {
    const { sandbox } = makeSandbox(["gemini"]);
    const missing = run(sandbox, ["nope"]);
    assert.equal(missing.status, 1);
    assert.equal(
      missing.stderr,
      "Error: Extension 'nope' not found in extensions/ (searched core, library, org).\n",
    );
    sandbox.tree.write("extensions/library/hello-world/extension.json", "{}\n");
    const both = run(sandbox, ["hello-world"]);
    assert.equal(both.status, 1);
    assert.equal(
      both.stderr,
      "Error: extension 'hello-world' exists in multiple tiers; names must be unique.\n",
    );
    assert.equal(both.stdout, "");
  });
});
