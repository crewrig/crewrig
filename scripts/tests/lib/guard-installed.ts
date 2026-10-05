// guard-installed.ts — installed configurations holding the worktree git guard,
// for the setup suites (spec 0248 R30; plan step 19).

import fs from "node:fs";
import path from "node:path";

import { handler, handlers, type Checkout, type Json } from "./guard-wiring-fixtures.ts";

export type Cli = "claude" | "gemini" | "copilot";
export const CLIS: readonly Cli[] = ["claude", "gemini", "copilot"];
export const q = JSON.stringify;
export const TRANSCRIPT = 'bash "/home/u/.hooks/mempalace-transcript.sh"';

/** An installed configuration of `cli`'s shape holding `commands` as guard handlers and one transcript hook. */
export function installed(cli: Cli, commands: string[]): Json {
  switch (cli) {
    case "claude":
      return {
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: commands.map((c) => handler(c)) }],
          Stop: [{ matcher: "", hooks: [handler(TRANSCRIPT)] }],
        },
      };
    case "gemini":
      return {
        hooks: {
          BeforeTool: [
            { hooks: commands.map((c) => handler(c, { name: "transcript-git-guard" })) },
          ],
          SessionEnd: [{ hooks: [handler(TRANSCRIPT, { name: "transcript-session-end" })] }],
        },
      };
    case "copilot":
      return {
        version: 1,
        hooks: { preToolUse: commands.map((c) => handler(c)), sessionEnd: [handler(TRANSCRIPT)] },
      };
  }
}

export function write(co: Checkout, name: string, config: Json): string {
  const file = path.join(path.dirname(co.repo), name);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
  return file;
}

export const legacy = (co: Checkout): string =>
  `bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`;
export const direct = (co: Checkout): string => `node "${co.guard}"`;
export const transcriptCount = (config: unknown): number =>
  handlers(config).filter((h) => String(h["command"]).includes("mempalace-transcript")).length;
