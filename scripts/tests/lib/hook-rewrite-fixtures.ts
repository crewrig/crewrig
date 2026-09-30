// hook-rewrite-fixtures.ts — shared fixtures of hook-rewrite.test.ts and
// hook-rewrite-dedup.test.ts: temporary checkouts holding a hook's `.sh` and
// `.ts`, and the command and configuration builders around them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import type { JsonObject } from "../../lib/hook-config.ts";
import { USAGE_CAPTURE, type HookDescriptor, type WiredCli } from "../../lib/hook-descriptor.ts";
import { rewriteConfig } from "../../lib/hook-rewrite.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A checkout `<root>/<name>` holding `hooks/<basename>.sh` and, unless told otherwise, `.ts`. */
export function checkout(name: string, options: { ts?: boolean; basename?: string } = {}): string {
  const base = options.basename ?? "usage-capture";
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hook-rewrite-")),
  );
  temps.push(root);
  const dir = path.join(root, name, "hooks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${base}.sh`), "#!/bin/bash\n");
  if (options.ts !== false) fs.writeFileSync(path.join(dir, `${base}.ts`), "// entry\n");
  return dir;
}

export const legacy = (dir: string, id: string, event: string, base = "usage-capture"): string =>
  `bash "${dir}/${base}.sh" ${id} ${event}`;
export const direct = (dir: string, id: string, event: string, base = "usage-capture"): string =>
  `node "${dir}/${base}.ts" ${id} ${event}`;

export const claudeConfig = (...commands: string[]): JsonObject => ({
  model: "opus",
  hooks: {
    Stop: [{ matcher: "", hooks: commands.map((command) => ({ type: "command", command })) }],
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "/opt/operator/lint.sh" }] },
    ],
  },
});

export const run = (
  config: JsonObject,
  cli: WiredCli = "claude",
  extra: { descriptor?: HookDescriptor; dedupEvents?: string[] } = {},
): ReturnType<typeof rewriteConfig> =>
  rewriteConfig(config, { descriptor: extra.descriptor ?? USAGE_CAPTURE, cli, ...extra });

export function stopCommands(config: JsonObject): string[] {
  const hooks = config["hooks"] as Record<string, { hooks: { command: string }[] }[]>;
  return (hooks["Stop"] ?? []).flatMap((group) => group.hooks.map((h) => h.command));
}
