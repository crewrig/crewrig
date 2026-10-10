// mcp-writers-box.ts — the sandbox the setup-mcp-json-writers tests share: a temporary home and
// repository holding the Copilot template, a recording `Io`, and the entries a real run builds.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeJsonText } from "../../lib/extension/json-write.ts";
import type { JsonValue } from "../../lib/extension/types.ts";
import type { McpEntries, WriteJson } from "../../lib/setup/mcp-json-writers.ts";

export const TEMPLATE = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "config",
  "copilot",
  "mcp-config.json.template",
);
export const JQ = spawnSync("jq", ["--version"]).status === 0;
export const PY = "/venv/bin/python";
export const OPERATOR = {
  mcpServers: {
    "operator-tool": { command: "node", args: ["__CREWRIG_REPO_DIR__/op.js"], env: { K: "v" } },
  },
};

export interface Box {
  readonly root: string;
  readonly repo: string;
  readonly target: string;
  readonly out: string[];
  readonly ctx: {
    readonly io: {
      out: (l: string) => void;
      err: (l: string) => void;
      errRaw: (t: string) => void;
    };
    readonly repoDir: string;
  };
  readonly entries: McpEntries;
}

export function box(): Box {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-writers-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "config", "copilot"), { recursive: true });
  fs.copyFileSync(TEMPLATE, path.join(repo, "config", "copilot", "mcp-config.json.template"));
  const target = path.join(root, "home", ".copilot", "mcp-config.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const out: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void out.push(`ERR ${l}`),
    errRaw: () => {},
  };
  const tls = `${repo}/scripts/lib/tls-exec.sh`;
  const entries: McpEntries = {
    mempalace: {
      type: "stdio",
      command: "bash",
      args: [tls, PY, `${repo}/scripts/lib/mempalace-http-wrapper.py`],
    },
    sequentialThinking: {
      type: "stdio",
      command: "bash",
      args: [tls, "npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
  };
  return { root, repo, target, out, ctx: { io, repoDir: repo }, entries };
}

export const writeJson: WriteJson = (file, value: JsonValue) => {
  fs.writeFileSync(file, writeJsonText(value), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};
export const seed = (file: string, body: unknown): void =>
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
export const jq = (input: string, args: string[]): string =>
  // jq for Windows ends lines with CRLF; the shell oracle is read as LF
  spawnSync("jq", [...args], { input, encoding: "utf8" }).stdout.replaceAll("\r\n", "\n");
