// setup-mcp-claude-flow.test.ts — mcp-claude-flow.ts over a fake Spawner modelling `claude mcp`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import {
  backupClaudeJson,
  installSettingsTemplate,
  isRegistered,
  legacyMcpPath,
  registerSequentialThinking,
  registerUser,
  removeLegacyMcpJson,
  removeUser,
} from "../lib/setup/mcp-claude-flow.ts";
import type { PromptSession, Question } from "../lib/setup/prompt.ts";
import { wrapStdioCommand } from "../lib/setup/trust-wrapper.ts";
import type { WrapperEnv } from "../lib/setup/trust-wrapper.ts";

let home: string;
let repo: string;
let out: string[];
let events: string[];
let asked: Question[];
let servers: Map<string, string>;
let shape: "plain" | "status" | "colon";
let addStatus: number;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-mcp-claude-")));
  repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, "config", "claude"), { recursive: true });
  fs.writeFileSync(path.join(repo, "config", "claude", "settings.json.template"), '{"a":1}\r\n');
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  out = [];
  events = [];
  asked = [];
  servers = new Map();
  shape = "plain";
  addStatus = 0;
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const result = (status: number, stdout = ""): SpawnResult => ({ status, stdout, stderr: "" });
/** The list as `claude mcp list` prints it, in one of the three recorded shapes. */
function listing(): string {
  const lines = ["Checking MCP server health..."];
  for (const [name, command] of servers) {
    if (shape === "plain") lines.push(`${name}: ${command}`);
    else if (shape === "status") lines.push(`${name}: ${command} - ✓ Connected`);
    else lines.push(`${name}: `);
  }
  return `${lines.join("\n")}\n`;
}

const spawn: Spawner = (argv) => {
  events.push(argv.join(" "));
  assert.equal(argv[0], "claude");
  const [, verb, sub, ...rest] = argv;
  if (verb !== "mcp") return result(1);
  if (sub === "list") return result(0, listing());
  if (sub === "add") {
    assert.deepEqual(rest.slice(0, 2), ["--scope", "user"]);
    if (addStatus !== 0) return result(addStatus);
    const sep = rest.indexOf("--");
    servers.set(rest[2] ?? "", rest.slice(sep + 1).join(" "));
    return result(0);
  }
  if (sub === "remove") return result(servers.delete(rest[2] ?? "") ? 0 : 1);
  return result(1);
};

const ctx = (platform: NodeJS.Platform = "linux") => ({
  io: { out: (l: string) => out.push(l), err: () => undefined, errRaw: () => undefined },
  home,
  repoDir: repo,
  platform,
});
const session = (answer: string | undefined): PromptSession => ({
  choose: async (q) => (asked.push(q), answer),
  confirm: async () => answer,
  close: () => undefined,
});
const command = (env: WrapperEnv, npx: string) =>
  wrapStdioCommand(env, [npx, "-y", "@modelcontextprotocol/server-sequential-thinking"]);

describe("isRegistered: the anchored `^name:[[:space:]]` rule", () => {
  for (const [label, kind] of [
    ["plain", "plain"],
    ["with a status suffix", "status"],
    ["trailing colon", "colon"],
  ] as const) {
    it(`matches the ${label} shape`, () => {
      shape = kind;
      servers.set("mempalace", "http://127.0.0.1:8765/mcp");
      assert.equal(isRegistered(spawn, "mempalace"), true);
      assert.equal(isRegistered(spawn, "memp"), false);
      assert.equal(isRegistered(spawn, "other"), false);
    });
  }

  it("does not match a prefix, an indented line, a bare `name:` or a regex name; a failing claude lists nothing", () => {
    assert.equal(
      isRegistered(() => result(127), "mempalace"),
      false,
    );
    const lines = "x-mempalace: a\n  mempalace: a\nmempalace2: a\nmempalace:\nmem.alace: a\n";
    const fake: Spawner = () => result(0, lines);
    assert.equal(isRegistered(fake, "mempalace"), false);
    assert.equal(isRegistered(fake, "mem.alace"), true);
    assert.equal(isRegistered((() => result(0, "memxalace: a\n")) as Spawner, "mem.alace"), false);
  });
});

describe("registerUser and removeUser", () => {
  it("adds with the exact argv and prints the registered line", () => {
    const rc = registerUser(spawn, ctx().io, "tool", ["bash", "/r/x.sh", "npx", "-y", "pkg"]);
    assert.equal(rc, 0);
    assert.deepEqual(events, [
      "claude mcp list",
      "claude mcp add --scope user tool -- bash /r/x.sh npx -y pkg",
    ]);
    assert.deepEqual(out, ["  tool: registered (scope=user)"]);
  });

  it("skips a registered name without adding", () => {
    servers.set("tool", "x");
    assert.equal(registerUser(spawn, ctx().io, "tool", ["a"]), 0);
    assert.deepEqual(events, ["claude mcp list"]);
    assert.deepEqual(out, ["  tool: already registered, skipping"]);
  });

  it("prints the FAILED line with the manual command and returns 1", () => {
    addStatus = 1;
    assert.equal(registerUser(spawn, ctx().io, "tool", ["a", "b c"]), 1);
    assert.deepEqual(out, [
      "  tool: FAILED to register — re-run manually: claude mcp add --scope user tool -- a b c",
    ]);
  });

  it("removeUser runs `claude mcp remove --scope user <name>` and returns its status", () => {
    servers.set("tool", "x");
    assert.equal(removeUser(spawn, "tool"), 0);
    assert.equal(removeUser(spawn, "tool"), 1);
    assert.deepEqual(events, [
      "claude mcp remove --scope user tool",
      "claude mcp remove --scope user tool",
    ]);
  });
});

describe("registerSequentialThinking", () => {
  const run = (answer: string | undefined, platform: NodeJS.Platform = "linux") =>
    registerSequentialThinking({ ctx: ctx(platform), session: session(answer), spawn, command });

  it("asks install-seqthink (yes, no; abort) and registers through the wrapper", async () => {
    assert.equal(await run("yes"), true);
    assert.deepEqual(asked, [
      {
        id: "install-seqthink",
        header: "Install Sequential Thinking MCP server?",
        options: ["yes", "no"],
        cancel: "abort",
      },
    ]);
    const wrapper = path.posix.join(repo, "scripts", "lib", "tls-exec.sh");
    assert.deepEqual(events, [
      "claude mcp list",
      `claude mcp add --scope user sequentialthinking -- bash ${wrapper} npx -y @modelcontextprotocol/server-sequential-thinking`,
    ]);
    assert.deepEqual(out, [
      "",
      "Sequential Thinking MCP server (working memory):",
      "  Command: npx -y @modelcontextprotocol/server-sequential-thinking",
      "  sequentialthinking: registered (scope=user)",
      "",
    ]);
  });

  it("names node, the profile wrapper and npx.cmd on win32", async () => {
    await run("yes", "win32");
    const added = events[1] ?? "";
    assert.match(
      added,
      /^claude mcp add --scope user sequentialthinking -- node .*tls-exec\.ts npx\.cmd -y /,
    );
  });

  it("declining registers nothing and says so", async () => {
    assert.equal(await run("no"), false);
    assert.deepEqual(events, []);
    assert.deepEqual(out.slice(3), ["  Sequential Thinking install skipped.", ""]);
  });

  it("a failed add prints the FAILED line then exits 1 (the shell's set -e)", async () => {
    addStatus = 1;
    await assert.rejects(run("yes"), (e: unknown) => e instanceof SetupExit && e.status === 1);
    assert.match(out.join("\n"), /sequentialthinking: FAILED to register — re-run manually/);
  });
});

describe("backup before the first mutation", () => {
  it("backs up ~/.claude.json before the first claude mcp add", async () => {
    fs.writeFileSync(path.join(home, ".claude.json"), "{}");
    const backedUp = (): boolean =>
      fs.readdirSync(home).some((n) => n.startsWith(".claude.json.bak."));
    const wrapped: Spawner = (argv) => {
      if (argv[2] === "add") events.push(backedUp() ? "backup-before-add" : "add-without-backup");
      return spawn(argv);
    };
    const bak = backupClaudeJson(ctx());
    assert.match(path.basename(bak), /^\.claude\.json\.bak\.\d{8}-\d{6}/);
    await registerSequentialThinking({
      ctx: ctx(),
      session: session("yes"),
      spawn: wrapped,
      command,
    });
    assert.ok(events.includes("backup-before-add"));
    assert.ok(!events.includes("add-without-backup"));
    assert.match(out[0] ?? "", /^  Backed up: \.claude\.json -> \.claude\.json\.bak\./);
  });
});

describe("removeLegacyMcpJson", () => {
  const legacy = () => legacyMcpPath(home);

  it("asks nothing when the legacy file is absent; only the blank line", async () => {
    assert.equal(await removeLegacyMcpJson(ctx(), session("yes")), false);
    assert.deepEqual(asked, []);
    assert.deepEqual(out, [""]);
  });

  it("backs up then removes on yes, with the shell's messages", async () => {
    fs.writeFileSync(legacy(), "{}");
    assert.equal(await removeLegacyMcpJson(ctx(), session("yes")), true);
    assert.deepEqual(asked, [
      {
        id: "legacy-mcp-removal",
        header: "Remove legacy ~/.claude/mcp.json (backup will be kept)?",
        options: ["no", "yes"],
        cancel: "abort",
      },
    ]);
    assert.equal(fs.existsSync(legacy()), false);
    assert.ok(
      fs.readdirSync(path.join(home, ".claude")).some((n) => n.startsWith("mcp.json.bak.")),
    );
    assert.equal(out[0], "");
    assert.equal(out[1], `Note: ${legacy()} is a legacy file and is NOT read by Claude Code.`);
    assert.equal(out[2], "      Active MCP config lives in ~/.claude.json.");
    assert.match(out[3] ?? "", /^ {2}Backed up: mcp\.json -> mcp\.json\.bak\./);
    assert.deepEqual(out.slice(4), ["  Legacy mcp.json removed.", ""]);
  });

  it("keeps the file on no", async () => {
    fs.writeFileSync(legacy(), "{}");
    assert.equal(await removeLegacyMcpJson(ctx(), session("no")), false);
    assert.equal(fs.existsSync(legacy()), true);
    assert.equal(out.at(-1), "");
  });
});

describe("installSettingsTemplate", () => {
  const target = () => path.join(home, ".claude", "settings.json");

  it("asks install-settings (yes, no; abort) and copies the template with LF endings", async () => {
    assert.equal(await installSettingsTemplate(ctx(), session("yes")), true);
    assert.deepEqual(asked, [
      {
        id: "install-settings",
        header: "Install default settings.json?",
        options: ["yes", "no"],
        cancel: "abort",
      },
    ]);
    assert.equal(fs.readFileSync(target(), "utf8"), '{"a":1}\n');
    assert.deepEqual(out, ["  Installed: settings.json", ""]);
  });

  it("writes nothing on no", async () => {
    assert.equal(await installSettingsTemplate(ctx(), session("no")), false);
    assert.equal(fs.existsSync(target()), false);
    assert.deepEqual(out, [""]);
  });

  it("an existing settings.json is not asked about and is left as is", async () => {
    fs.writeFileSync(target(), "mine");
    assert.equal(await installSettingsTemplate(ctx(), session("yes")), false);
    assert.deepEqual(asked, []);
    assert.equal(fs.readFileSync(target(), "utf8"), "mine");
    assert.deepEqual(out, ["  settings.json already exists, skipping.", ""]);
  });
});
