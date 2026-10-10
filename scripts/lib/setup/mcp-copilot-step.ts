// mcp-copilot-step.ts — the `mcp` step of the Copilot setup (spec 0256 requirements 25-28, delta-01;
// plan v2 step B3b.1). Twins the block of scripts/setup-copilot-interactive.sh that goes from
// `Configuring ~/.copilot/mcp-config.json...` to the blank line before the tiers: the backup and the
// capture of the operator's servers BEFORE the overwrite, the MemPalace detection (offer, version),
// the Chroma daemon, the template write with the stdio entries, the organisation fold, then the HTTP
// registration. The stdio entry is written BEFORE `ensure_mempalace_http`; its return codes 1 and 2
// only print warnings (requirement 26). Copilot asks no Sequential Thinking question.
//
// Test seams come from `env.deps.seams` through steps-mcp-common.ts (`detect`, `offer`, `chroma`,
// `installChroma`, `ensureHttp`, `ensure`).

import path from "node:path";

import type { JsonValue } from "../extension/types.ts";
import type { StepEnv } from "./descriptor.ts";
import { writeJsonConfigSecure } from "./json-secure.ts";
import { backupAndCapture, writeCopilotMcpConfig } from "./mcp-json-writers.ts";
import { runMempalaceStep } from "./mempalace-callsite.ts";
import { sequentialThinkingEntry, mempalaceStdioEntry } from "./mempalace-stdio.ts";
import { applyOrgMcpServers, readOrgMcpManifest } from "./org-mcp-fold.ts";
import {
  chromaStep,
  detectMempalace,
  makeEnsure,
  prepareTrustWrapper,
} from "./steps-mcp-common.ts";

/** `~/.copilot/mcp-config.json`, from the descriptor when it names one. */
function targetOf(env: StepEnv): string {
  return path.join(env.ctx.home, env.descriptor.homes.mcpConfig ?? ".copilot/mcp-config.json");
}

export async function run(env: StepEnv): Promise<void> {
  const { ctx, state } = env;
  const { io } = ctx;
  const target = targetOf(env);
  io.out("Configuring ~/.copilot/mcp-config.json...");

  // `backup_file` then the capture, BEFORE the template overwrites the file.
  const captured = backupAndCapture(ctx, target);

  const python = await detectMempalace(env, { detected: "Detected MemPalace interpreter" });
  if (python !== undefined) await chromaStep(env);

  // The stdio entries name the win32 trust wrapper: install it before the first one is built.
  prepareTrustWrapper(env);
  const wrapperEnv = { platform: ctx.platform, home: ctx.home, repoDir: ctx.repoDir };
  writeCopilotMcpConfig({
    ctx,
    target,
    captured,
    entries: {
      mempalace:
        python === undefined ? undefined : mempalaceStdioEntry("copilot", wrapperEnv, python),
      sequentialThinking: sequentialThinkingEntry("copilot", wrapperEnv),
    },
    writeJson: (file: string, value: JsonValue) =>
      void writeJsonConfigSecure({ ctx, file, value, backup: false }),
  });
  const installed = python !== undefined;
  state.mempalaceInstalled = installed;

  // `apply_org_mcp_servers` after the operator fold: framework-reserved > org > operator.
  const preexisting = captured.servers instanceof Map ? captured.servers : new Map();
  applyOrgMcpServers(
    ctx,
    "copilot",
    readOrgMcpManifest(ctx.repoDir),
    target,
    preexisting,
    captured.backup,
  );

  // The stdio entry is already written: the return codes 1 and 2 only print their warnings.
  const result = await runMempalaceStep({
    ctx,
    cli: "copilot",
    ensure: makeEnsure(env),
    registerStdio: () => installed,
    removeUserScope: () => undefined,
    isRegistered: () => false,
  });
  state.mempalaceInstalled = result.installed;
  io.out("");
}
