// mcp-agy-step.ts — the two MCP steps of the Antigravity setup (spec 0256 requirements 25-28,
// delta-01; plan v2 step B3b.1). Twins the blocks of scripts/setup-antigravity-interactive.sh:
//   - `prepare` (step `mcp-prepare`, lines 159-161): prints `Configuring <mcp_config.json>...` and
//     creates the directory; it runs BEFORE `tls-offer` and `deps-install`;
//   - `run` (step `mcp`, lines 168-290): the backup and capture of the operator's servers, the
//     MemPalace detection (offer, version), the Chroma daemon, the Sequential Thinking question
//     (asked BEFORE the file is written), the write, the organisation fold, the HTTP registration.
// The stdio entry is written BEFORE `ensure_mempalace_http`; its return codes 1 and 2 only print
// warnings (requirement 26).
//
// Test seams come from `env.deps.seams` through steps-mcp-common.ts (`detect`, `offer`, `chroma`,
// `installChroma`, `ensureHttp`, `ensure`).

import fs from "node:fs";
import path from "node:path";

import type { JsonValue } from "../extension/types.ts";
import type { StepEnv } from "./descriptor.ts";
import { writeJsonConfigSecure } from "./json-secure.ts";
import { backupAndCapture, writeAntigravityMcpConfig } from "./mcp-json-writers.ts";
import { runMempalaceStep } from "./mempalace-callsite.ts";
import { mempalaceStdioEntry, sequentialThinkingEntry } from "./mempalace-stdio.ts";
import { applyOrgMcpServers, readOrgMcpManifest } from "./org-mcp-fold.ts";
import {
  chromaStep,
  detectMempalace,
  makeEnsure,
  prepareTrustWrapper,
} from "./steps-mcp-common.ts";
import { failClosed } from "./steps.ts";

export const SEQTHINK_HEADER = "Include SequentialThinking MCP server in mcp_config.json?";

/** `~/.gemini/config/mcp_config.json` (`AGY_MCP_CONFIG`), from the descriptor when it names one. */
function targetOf(env: StepEnv): string {
  return path.join(
    env.ctx.home,
    env.descriptor.homes.mcpConfig ?? ".gemini/config/mcp_config.json",
  );
}

/** `echo "Configuring $AGY_MCP_CONFIG..."` and `mkdir -p "$(dirname ...)"` (a failure aborts: `set -e`). */
export async function prepare(env: StepEnv): Promise<void> {
  const target = targetOf(env);
  env.ctx.io.out(`Configuring ${target}...`);
  failClosed(env.ctx.io, `cannot create ${path.dirname(target)}`, () =>
    fs.mkdirSync(path.dirname(target), { recursive: true }),
  );
}

export async function run(env: StepEnv): Promise<void> {
  const { ctx, state, session } = env;
  const target = targetOf(env);

  // `backup_file` then the capture, BEFORE the file is rebuilt from the empty base.
  const captured = backupAndCapture(ctx, target);

  const python = await detectMempalace(env, { detected: "Detected MemPalace interpreter" });
  if (python !== undefined) await chromaStep(env);

  // The question precedes the write, as in the shell (`install-seqthink`, abort on cancel).
  const answer = await session.choose({
    id: "install-seqthink",
    header: SEQTHINK_HEADER,
    options: ["yes", "no"],
    cancel: "abort",
  });

  // The stdio entries name the win32 trust wrapper: install it before the first one is built.
  prepareTrustWrapper(env);
  const wrapperEnv = { platform: ctx.platform, home: ctx.home, repoDir: ctx.repoDir };
  writeAntigravityMcpConfig({
    ctx,
    target,
    captured,
    entries: {
      mempalace:
        python === undefined ? undefined : mempalaceStdioEntry("antigravity", wrapperEnv, python),
      sequentialThinking:
        answer === "yes" ? sequentialThinkingEntry("antigravity", wrapperEnv) : undefined,
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
    "antigravity",
    readOrgMcpManifest(ctx.repoDir),
    target,
    preexisting,
    captured.backup,
  );

  // The stdio entry is already written: the return codes 1 and 2 only print their warnings.
  const result = await runMempalaceStep({
    ctx,
    cli: "antigravity",
    ensure: makeEnsure(env),
    registerStdio: () => installed,
    removeUserScope: () => undefined,
    isRegistered: () => false,
  });
  state.mempalaceInstalled = result.installed;
  ctx.io.out("  Installed: mcp_config.json");
  ctx.io.out("");
}
