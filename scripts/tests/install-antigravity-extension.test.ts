// install-antigravity-extension.test.ts — the black-box contract of
// scripts/install-antigravity-extension.sh (spec 0255 R10, R26; ticket #1334). Written against
// the shell; the TypeScript leg joins automatically once the `.ts` entry exists (`LEGS`).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { cliCalls, createInstallSandbox, IMPL, runEntry, stubCli } from "./lib/install-sandbox.ts";
import type { InstallSandbox, Leg } from "./lib/install-sandbox.ts";
import { which } from "./lib/worktree-fixtures.ts";

const NAME = "install-antigravity-extension";
const HAS_JQ = which("jq") !== null;
const LEGS: readonly Leg[] = IMPL.filter((leg) =>
  fs.existsSync(path.join(REPO, "scripts", `${NAME}.${leg === "shell" ? "sh" : "ts"}`)),
);

/** The shell leg shells out to `jq`: without a real one on the host it is skipped, never failed. */
const skipFor = (leg: Leg): false | string =>
  leg === "shell" && !HAS_JQ ? "jq is not installed on this host" : false;

/** Run by the `agy` stub: the real one copies the plugin verbatim to `plugins/<plugin.json .name>`. */
const COPY =
  `n=$(sed -n 's/^ *"name": *"\\([^"]*\\)".*/\\1/p' "$3/plugin.json" | head -1)\n` +
  `d="$HOME/.gemini/config/plugins/$n"\nmkdir -p "$d"\ncp -R "$3/." "$d/"\n`;
const PLUGIN = "hello-world";
/** Host tools linked into the sandbox PATH: `mv` is outside the hermetic coreutil set, yet the token rewrite calls it. */
const LINKS = ["jq", "mv"];

/** `hello-world` from the real tree (no `node_modules`); `edit` may rewrite its extension.json. */
function place(
  sb: InstallSandbox,
  tier: string,
  edit?: (manifest: Record<string, unknown>) => void,
) {
  const from = path.join(REPO, "extensions", "core", "hello-world");
  const to = sb.tree.resolve(`extensions/${tier}/hello-world`);
  fs.cpSync(from, to, { recursive: true, filter: (e) => path.basename(e) !== "node_modules" });
  if (edit === undefined) return;
  const file = path.join(to, "extension.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

const sandbox = (opts: { clis?: readonly string[]; jq?: boolean; agy?: string } = {}) => {
  const sb = createInstallSandbox({
    ...(opts.clis === undefined ? {} : { clis: opts.clis }),
    ...(opts.jq === true ? { links: LINKS } : {}),
  });
  if (opts.agy !== undefined) stubCli(sb, "agy", { body: COPY + opts.agy });
  return sb;
};

for (const leg of LEGS) {
  describe(`install-antigravity-extension (${leg} leg)`, () => {
    const run = (sb: InstallSandbox, args: readonly string[]) => runEntry(sb, NAME, args, { leg });
    const jq = { skip: skipFor(leg) };

    it("fails with the usage line when no extension name is given", jq, () => {
      const sb = sandbox({ jq: true });
      const res = run(sb, []);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      // R22(i): the shell form carries its script path prefix, the TypeScript form does not.
      if (leg === "shell")
        assert.match(
          res.stderr,
          /: 1: Usage: install-antigravity-extension\.sh <extension-name>\n$/,
        );
      else assert.match(res.stderr, /Usage: install-antigravity-extension\.sh <extension-name>/);
      assert.deepEqual(cliCalls(sb, "agy"), []);
    });

    // Spec 0255 R22(a): the TypeScript entry drops the `jq` prerequisite, so this is shell-leg only.
    it(
      "reports a missing jq and exits 1",
      { skip: leg !== "shell" && "R22(a): no jq on the TypeScript leg" },
      () => {
        const res = run(sandbox(), ["hello-world"]);
        assert.equal(res.status, 1);
        assert.equal(res.stdout, "Error: jq is required. Install with: brew install jq\n");
        assert.equal(res.stderr, "");
      },
    );

    it("reports a missing agy and exits 1", jq, () => {
      const res = run(sandbox({ clis: ["claude", "copilot", "gemini"], jq: true }), [
        "hello-world",
      ]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "Error: 'agy' CLI is required. Install Antigravity CLI first.\n");
      assert.equal(res.stderr, "");
    });

    it("reports an extension that is in no tier", jq, () => {
      const sb = sandbox({ jq: true });
      const res = run(sb, ["ghost"]);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "Error: Extension 'ghost' not found in extensions/\n");
      assert.deepEqual(cliCalls(sb, "agy"), []);
      assert.equal(sb.tree.exists("dist-antigravity-plugin"), false);
    });

    it("refuses a name that exists in two tiers", jq, () => {
      const sb = sandbox({ jq: true });
      place(sb, "core");
      place(sb, "org");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 1);
      assert.equal(
        res.stdout,
        "Error: extension 'hello-world' exists in multiple tiers; names must be unique.\n",
      );
      assert.deepEqual(cliCalls(sb, "agy"), []);
    });

    it("builds, installs that directory, then resolves ${extensionRoot}", jq, () => {
      const sb = sandbox({ jq: true, agy: "" });
      place(sb, "core");
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 0, res.stderr);
      const out = sb.tree.resolve("dist-antigravity-plugin/hello-world");
      assert.deepEqual(cliCalls(sb, "agy"), [["plugin", "install", out]]);
      const root = path.join(sb.home, ".gemini", "config", "plugins", PLUGIN);
      const mcp = path.join(root, "mcp_config.json");
      assert.ok(
        fs.readFileSync(path.join(out, "mcp_config.json"), "utf8").includes("${extensionRoot}"),
      );
      const installed = fs.readFileSync(mcp, "utf8");
      assert.ok(!installed.includes("${extensionRoot}"));
      assert.ok(installed.includes(`${root}/dist/index.js`));
      assert.ok(res.stdout.includes(`  Resolved \${extensionRoot} -> ${root} in ${mcp}\n`));
      assert.ok(
        res.stdout.endsWith(
          "\nPlugin 'hello-world' installed. Restart Antigravity CLI to pick up the plugin.\n",
        ),
      );
      assert.equal(res.stderr, "");
    });

    it("prints no rewrite line for an extension with no mcp_config.json", jq, () => {
      const sb = sandbox({ jq: true, agy: "" });
      place(sb, "core", (m) => void delete m["mcpServers"]);
      const res = run(sb, ["hello-world"]);
      assert.equal(res.status, 0, res.stderr);
      assert.ok(!sb.tree.exists("dist-antigravity-plugin/hello-world/mcp_config.json"));
      assert.ok(!res.stdout.includes("Resolved"));
      assert.ok(
        res.stdout.endsWith(
          "\nPlugin 'hello-world' installed. Restart Antigravity CLI to pick up the plugin.\n",
        ),
      );
    });

    const failing = (title: string, agy: string, message: (sb: InstallSandbox) => RegExp) =>
      it(title, jq, () => {
        const sb = sandbox({ jq: true, agy });
        place(sb, "core");
        const res = run(sb, ["hello-world"]);
        assert.equal(res.status, 1);
        assert.match(res.stderr, message(sb));
        assert.ok(!res.stdout.includes("Restart Antigravity CLI"));
      });
    const out = (sb: InstallSandbox) => sb.tree.resolve("dist-antigravity-plugin/hello-world");
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    failing(
      "fails when plugin.json carries no .name",
      `sed 's/"name"/"nom"/' "$3/plugin.json" > "$3/p.tmp" && mv "$3/p.tmp" "$3/plugin.json"`,
      (sb) =>
        new RegExp(`^Error: ${escape(out(sb))}/plugin\\.json carries no \\(or an empty\\) \\.name`),
    );
    failing(
      "fails when plugin.json carries an empty .name",
      `printf '{"name": ""}' > "$3/plugin.json"`,
      (sb) =>
        new RegExp(`^Error: ${escape(out(sb))}/plugin\\.json carries no \\(or an empty\\) \\.name`),
    );
    failing(
      "fails when the installed mcp_config.json is missing",
      `rm -f "$d/mcp_config.json"`,
      (sb) => {
        const mcp = path.join(sb.home, ".gemini", "config", "plugins", PLUGIN, "mcp_config.json");
        return new RegExp(`^Error: expected ${escape(mcp)} after install \\(spec 0180 R16`);
      },
    );
    failing(
      "fails when the rewrite of the installed mcp_config.json fails",
      `printf '{bad' > "$d/mcp_config.json"`,
      (sb) => {
        const mcp = path.join(sb.home, ".gemini", "config", "plugins", PLUGIN, "mcp_config.json");
        return new RegExp(`Error: failed to rewrite \\$\\{extensionRoot\\} in ${escape(mcp)}\\n$`);
      },
    );
  });
}
