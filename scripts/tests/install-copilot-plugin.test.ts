// install-copilot-plugin.test.ts — the black-box contract of scripts/install-copilot-plugin.sh
// (spec 0255 R10, R26; ticket #1334). Written against the shell, which is now a forwarding shim:
// the "shell" leg is `bash scripts/<name>.sh` (shim -> TypeScript) and the "node" leg is the entry
// itself; both are real user paths. No `jq` anywhere on the sandbox PATH (R22(a)).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { cliCalls, createInstallSandbox, IMPL, runEntry, stubCli } from "./lib/install-sandbox.ts";
import type { InstallSandbox, Leg } from "./lib/install-sandbox.ts";

const NAME = "install-copilot-plugin";
const LEGS: readonly Leg[] = IMPL.filter((leg) =>
  fs.existsSync(path.join(REPO, "scripts", `${NAME}.${leg === "shell" ? "sh" : "ts"}`)),
);

/** `hello-world` from the real tree (no `node_modules`) under `extensions/<tier>/<name>`. */
function placeExtension(sb: InstallSandbox, tier: string, name = "hello-world"): void {
  const from = path.join(REPO, "extensions", "core", "hello-world");
  fs.cpSync(from, sb.tree.resolve(`extensions/${tier}/${name}`), {
    recursive: true,
    filter: (entry) => path.basename(entry) !== "node_modules",
  });
}

const sandbox = (opts: { clis?: readonly string[] } = {}): InstallSandbox =>
  createInstallSandbox(opts.clis === undefined ? {} : { clis: opts.clis });

for (const leg of LEGS) {
  describe(`install-copilot-plugin (${leg} leg)`, () => {
    const run = (sb: InstallSandbox, args: readonly string[]) => runEntry(sb, NAME, args, { leg });

    it("fails with the usage line when no extension name is given", () => {
      const sb = sandbox();
      const res = run(sb, []);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "Usage: install-copilot-plugin.sh <extension-name>\n");
      assert.deepEqual(cliCalls(sb, "copilot"), []);
    });

    // Spec 0255 R22(a): `jq` is no longer a prerequisite; the sandbox PATH holds none.
    it("installs the plugin on a machine without jq", () => {
      const sb = sandbox();
      assert.equal(fs.existsSync(path.join(sb.hermetic.bin, "jq")), false);
      placeExtension(sb, "core");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 0, res.stderr);
      assert.ok(fs.existsSync(sb.tree.resolve("dist-copilot-plugin/hello-world/plugin.json")));
      assert.equal(cliCalls(sb, "copilot").length, 1);
      assert.equal(res.stderr, "");
    });

    it("reports a missing copilot and exits 1", () => {
      const sb = sandbox({ clis: ["claude", "agy", "gemini"] });
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 1);
      assert.equal(
        res.stdout,
        "Error: 'copilot' CLI is required. Install GitHub Copilot CLI first.\n",
      );
      assert.equal(res.stderr, "");
    });

    it("reports an extension that is in no tier", () => {
      const sb = sandbox();
      const res = run(sb, ["ghost"]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "Error: Extension 'ghost' not found in extensions/\n");
      assert.equal(res.stderr, "");
      assert.deepEqual(cliCalls(sb, "copilot"), []);
      assert.equal(sb.tree.exists("dist-copilot-plugin"), false);
    });

    it("refuses a name that exists in two tiers", () => {
      const sb = sandbox();
      placeExtension(sb, "core");
      placeExtension(sb, "library");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 1);
      assert.equal(
        res.stdout,
        "Error: extension 'hello-world' exists in multiple tiers; names must be unique.\n",
      );
      assert.deepEqual(cliCalls(sb, "copilot"), []);
      assert.equal(sb.tree.exists("dist-copilot-plugin"), false);
    });

    it("builds into dist-copilot-plugin/<name> and installs that directory", () => {
      const sb = sandbox();
      placeExtension(sb, "core");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 0, res.stderr);
      const out = sb.tree.resolve("dist-copilot-plugin/hello-world");
      assert.ok(fs.existsSync(path.join(out, "plugin.json")), "the build wrote plugin.json");
      assert.deepEqual(cliCalls(sb, "copilot"), [["plugin", "install", out]]);
      assert.ok(
        res.stdout.endsWith("\nPlugin 'hello-world' installed. Run: copilot plugin list\n"),
      );
      assert.equal(res.stderr, "");
    });

    it("finds an extension in the library tier", () => {
      const sb = sandbox();
      placeExtension(sb, "library");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(cliCalls(sb, "copilot"), [
        ["plugin", "install", sb.tree.resolve("dist-copilot-plugin/hello-world")],
      ]);
    });

    it("exits with the status of a failing copilot install", () => {
      const sb = sandbox();
      stubCli(sb, "copilot", { status: 5, stderr: "boom\n" });
      placeExtension(sb, "core");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 5);
      assert.ok(!res.stdout.includes("installed."));
    });
  });
}
