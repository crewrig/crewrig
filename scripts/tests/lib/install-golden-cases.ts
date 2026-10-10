// install-golden-cases.ts — the inputs and the observation of the install golden (spec 0255 R27,
// PR C step 17). `observe(leg)` runs every case through one leg of the install sandbox and returns
// the files worth keeping, temporary paths replaced by fixed tokens, keyed by golden name. The
// regeneration script and the test both feed it the TypeScript entry (leg `node`); the stored bytes
// were first produced by the real shell (PR C).

import fs from "node:fs";
import path from "node:path";

import { REPO } from "./build-fixture-tree.ts";
import { createInstallSandbox, runEntry, stubCli } from "./install-sandbox.ts";
import type { InstallSandbox, Leg } from "./install-sandbox.ts";

/** The golden whose lines carry POSIX file modes; not comparable on Windows. */
export const MODES = "placed-tree/commands.txt";

export type Observed = Map<string, string>;

const DECL = '{"command":"node","args":["a","b"],"env":{"K":"v"}}\n';
const OLD = '{"mcpServers":{"old":{"command":"keep"}},"theme":"dark"}\n';
const COPY =
  `n=$(sed -n 's/^ *"name": *"\\([^"]*\\)".*/\\1/p' "$3/plugin.json" | head -1)\n` +
  `d="$HOME/.gemini/config/plugins/$n"\nmkdir -p "$d"\ncp -R "$3/." "$d/"\n`;

// The TypeScript entries need no host tool beyond node (they also run on Windows).
const box = (): InstallSandbox => createInstallSandbox();

/** The real hello-world, copied without `node_modules` under `extensions/<tier>/`. */
function placeHello(b: InstallSandbox, tier = "core"): void {
  const from = path.join(REPO, "extensions", "core", "hello-world");
  const to = b.tree.resolve(`extensions/${tier}/hello-world`);
  fs.cpSync(from, to, { recursive: true, filter: (e) => path.basename(e) !== "node_modules" });
}

/** The text of a file with the sandbox paths replaced; a missing file reads `<absent>`. */
function read(b: InstallSandbox, file: string): string {
  if (!fs.existsSync(file)) return "<absent>\n";
  const h = b.hermetic;
  const spellings: [string, string][] = [
    [b.tree.root, "<ROOT>"],
    [b.tree.root.replace(/^\/private/, ""), "<ROOT>"],
    [b.home, "<HOME>"],
    [h.root, "<TMP>"],
    [h.root.replace(/^\/private/, ""), "<TMP>"],
  ];
  const named = fs.readFileSync(file, "utf8").split(path.basename(b.tree.root)).join("<ROOTNAME>");
  return spellings
    .sort((x, y) => y[0].length - x[0].length)
    .reduce((t, [from, to]) => t.split(from).join(to), named);
}

function ext(b: InstallSandbox, name: string): void {
  const manifest = {
    name,
    version: "0.0.1",
    description: "fixture",
    commands: { location: "commands/" },
  };
  b.tree.write(`extensions/core/${name}/extension.json`, JSON.stringify(manifest));
  b.tree.write(
    `extensions/core/${name}/commands/x.md`,
    "---\nname: x\ndescription: d\ntype: command\n---\nbody\n",
  );
}

/** Files under `dir`, one `<mode> <path>` line each, sorted; the placed tree of a component. */
function placed(dir: string): string {
  const out: string[] = [];
  const walk = (cur: string, rel: string): void => {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const next = rel === "" ? e.name : `${rel}/${e.name}`;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) walk(full, next);
      else out.push(`${(fs.lstatSync(full).mode & 0o777).toString(8)} ${next}\n`);
    }
  };
  walk(dir, "");
  return out.sort().join("");
}

function marketplace(leg: Leg, out: Observed): void {
  const b = box();
  placeHello(b);
  ext(b, "alpha");
  const file = `${b.home}/.claude/local-marketplace/.claude-plugin/marketplace.json`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const seed = {
    name: "crewrig-local",
    owner: { name: "x" },
    plugins: [{ name: "old", source: "./old" }],
  };
  fs.writeFileSync(file, JSON.stringify(seed, null, 2));
  const steps: [string, string][] = [
    ["hello-world", "after-first"],
    ["alpha", "after-second"],
    ["hello-world", "after-replacement"],
  ];
  for (const [name, label] of steps) {
    runEntry(b, "install-claude-plugin", [name], { leg });
    out.set(`marketplace/${label}.json`, read(b, file));
  }
}

function mcpMerge(leg: Leg, out: Observed): void {
  const clis: [string, string, string][] = [
    ["manage-copilot-component", ".copilot/mcp-config.json", "copilot"],
    ["manage-antigravity-component", ".gemini/antigravity-cli/settings.json", "antigravity"],
    ["manage-workspace-component", ".gemini/settings.json", "gemini"],
  ];
  for (const [script, config, label] of clis) {
    const b = box();
    b.tree.artifact("library/mcp-servers/demo.json", DECL);
    const file = `${b.home}/${config}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, OLD);
    runEntry(b, script, ["install", "mcp-servers", "demo"], { leg });
    out.set(`mcp-merge/${label}.json`, read(b, file));
    out.set(`mcp-merge/${label}.json.bak`, read(b, `${file}.bak`));
  }
}

function antigravityConfig(leg: Leg, out: Observed): void {
  const b = box();
  placeHello(b);
  stubCli(b, "agy", { body: COPY });
  runEntry(b, "install-antigravity-extension", ["hello-world"], { leg });
  out.set(
    "antigravity/mcp_config.json",
    read(b, `${b.home}/.gemini/config/plugins/hello-world/mcp_config.json`),
  );
}

function placedTree(leg: Leg, out: Observed): void {
  const b = box();
  b.tree.artifact("library/commands/one.toml", 'description = "one"\n');
  b.tree.artifact("library/commands/two.toml", 'description = "two"\n');
  runEntry(b, "manage-workspace-component", ["install", "commands"], { leg });
  out.set(MODES, placed(`${b.home}/.gemini/commands`));
}

/** Every golden case through `leg`: golden name (relative, no `.golden`) to normalised text. */
export function observe(leg: Leg): Observed {
  const out: Observed = new Map();
  for (const run of [marketplace, mcpMerge, antigravityConfig, placedTree]) run(leg, out);
  if (process.platform === "win32") out.delete(MODES);
  return out;
}
