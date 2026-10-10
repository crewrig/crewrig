// steps-mcp-common.ts — what the four MCP strategies share (spec 0256 requirements 25-28, plan v2
// step B3b.3): the MemPalace detect / offer / version-range block, the Chroma daemon step, the
// ensure-http builder for `runMempalaceStep`, the typed test seams and the org-manifest wrappers.
// Nothing here prints a CLI-specific line: the one text that differs per CLI (the `Detected ...`
// line) is passed in.

import fs from "node:fs";

import type { JsonValue } from "../extension/types.ts";
import { ExtError } from "../extension/types.ts";
import { readMempalacePin } from "../mempalace-pin.ts";
import { orgMcpToNative } from "../org-mcp.ts";
import type { ChromaInstallSeams } from "./chroma-install.ts";
import type { ChromaInstallArgs, ChromaInstallResult } from "./chroma-types.ts";
import { installChromaDaemon } from "./chroma-install.ts";
import type { DetectDeps } from "./mempalace-detect.ts";
import { detectMempalaceInterpreter, installedVersion } from "./mempalace-detect.ts";
import type { OfferDeps } from "./mempalace-install-offer.ts";
import { offerMempalaceInstall } from "./mempalace-install-offer.ts";
import { inRange, rangeErrorLines } from "./mempalace-version.ts";
import type { EnsureRc } from "./mempalace-callsite.ts";
import type { EnsureHttpDeps } from "./ensure-http.ts";
import { ensureMempalaceHttp } from "./ensure-http.ts";
import type { StepEnv } from "./descriptor.ts";
import { SetupExit } from "./exit.ts";
import { orgMcpManifestPath, readOrgMcpManifest } from "./org-mcp-fold.ts";
import { ensureTrustWrapperInstalled } from "./trust-wrapper-install.ts";

/** The per-module test overrides the MCP steps read from `FlowDeps.seams` (all optional). */
export interface McpSeams {
  /** `detect`: the interpreter detector. */
  readonly detect?: DetectDeps;
  /** `offer`: the pin reader, used by the offer and by the supported-range check. */
  readonly offer?: OfferDeps;
  /** `chroma`: the Chroma installer's seams. */
  readonly chroma?: ChromaInstallSeams;
  /** `installChroma`: replaces `installChromaDaemon` altogether (the real one needs a machine). */
  readonly installChroma?: (args: ChromaInstallArgs) => Promise<ChromaInstallResult>;
  /** `ensureHttp`: the whole daemon-contract seam bag. */
  readonly ensureHttp?: EnsureHttpDeps;
  /** `ensure`: replaces `ensureMempalaceHttp` altogether (rc-arm tests). */
  readonly ensure?: () => Promise<EnsureRc>;
  /** `now`: the clock of the settings backup name (Gemini). */
  readonly now?: () => Date;
}

function pick(bag: Readonly<Record<string, unknown>> | undefined, key: string): unknown {
  const value = bag?.[key];
  return value === null ? undefined : value;
}

/** Narrow the untyped seam bag; an absent key stays absent, so production uses the real modules. */
export function mcpSeams(env: StepEnv): McpSeams {
  const bag = env.deps.seams;
  const detect = pick(bag, "detect");
  const offer = pick(bag, "offer");
  const chroma = pick(bag, "chroma");
  const ensureHttp = pick(bag, "ensureHttp");
  const now = pick(bag, "now");
  const ensure = pick(bag, "ensure");
  const installChroma = pick(bag, "installChroma");
  const obj = (value: unknown): value is object => typeof value === "object" && value !== null;
  return {
    ...(obj(detect) ? { detect: detect as DetectDeps } : {}),
    ...(obj(offer) ? { offer: offer as OfferDeps } : {}),
    ...(obj(chroma) ? { chroma: chroma as ChromaInstallSeams } : {}),
    ...(obj(ensureHttp) ? { ensureHttp: ensureHttp as EnsureHttpDeps } : {}),
    ...(typeof installChroma === "function"
      ? { installChroma: installChroma as McpSeams["installChroma"] }
      : {}),
    ...(typeof ensure === "function" ? { ensure: ensure as () => Promise<EnsureRc> } : {}),
    ...(typeof now === "function" ? { now: now as () => Date } : {}),
  };
}

/** The texts that differ per CLI. */
export interface DetectTexts {
  /** `Detected interpreter` (Claude) or `Detected MemPalace interpreter` (the others), no colon. */
  readonly detected: string;
}

/**
 * Detect the MemPalace interpreter; when absent print `  MemPalace not found.`, offer the pipx
 * install (a refusal is a decline, never an error: the shell's `|| true`) and detect again. With an
 * interpreter, check the installed version against the pin: out of range prints the two ERROR lines
 * on stdout and ends the run with status 1. Sets `state.pythonBin` and `state.mempalaceVersion`
 * and prints `  <detected>: <python> (mempalace <version>)`. Returns the interpreter or `undefined`.
 */
export async function detectMempalace(
  env: StepEnv,
  texts: DetectTexts,
): Promise<string | undefined> {
  const { ctx, state, session, spawn } = env;
  const seams = mcpSeams(env);
  let python = detectMempalaceInterpreter(ctx, seams.detect);
  if (python === undefined) {
    ctx.io.out("  MemPalace not found.");
    await offerMempalaceInstall({ ctx, session, spawn, deps: seams.offer });
    python = detectMempalaceInterpreter(ctx, seams.detect);
  }
  if (python === undefined) return undefined;
  const version = installedVersion(spawn, python);
  const pin = (seams.offer?.pin ?? readMempalacePin)(ctx.repoDir);
  if (version === undefined || !inRange(version, pin.min, pin.maxExclusive)) {
    for (const line of rangeErrorLines(version, pin.min, pin.maxExclusive)) ctx.io.out(line);
    throw new SetupExit(1);
  }
  state.pythonBin = python;
  state.mempalaceVersion = version;
  ctx.io.out(`  ${texts.detected}: ${python} (mempalace ${version})`);
  return python;
}

/**
 * `install_chroma_daemon`: the installer prints its own header and `ERROR:` lines; a failure ends
 * the run with status 1 (plan B3b.1: the shell ignored the result, the TypeScript flow stops).
 */
export async function chromaStep(env: StepEnv): Promise<void> {
  const { ctx, spawn, state } = env;
  const seams = mcpSeams(env);
  const args = { ctx, spawn, python: state.pythonBin };
  const result = await (seams.installChroma?.(args) ?? installChromaDaemon(args, seams.chroma));
  if (!result.ok) throw new SetupExit(1);
}

/**
 * The `ensure` of `runMempalaceStep`. The endpoint (`MEMPALACE_MCP_HOST` / `MEMPALACE_MCP_PORT` of
 * `ctx.env`, defaults 127.0.0.1 and 41893) and `defaultEnsureHttpDeps` are resolved by
 * `ensureMempalaceHttp` itself when no seam is injected.
 */
export function makeEnsure(env: StepEnv): () => Promise<EnsureRc> {
  const { ctx, spawn, descriptor } = env;
  const { ensure, ensureHttp: deps } = mcpSeams(env);
  if (ensure !== undefined) return ensure;
  return () =>
    ensureMempalaceHttp({
      ctx,
      cli: descriptor.cli,
      spawn,
      ...(deps === undefined ? {} : { deps }),
    });
}

/** win32 only: the trust wrapper that the stdio entries name must exist before the first entry. */
export function prepareTrustWrapper(env: StepEnv): void {
  ensureTrustWrapperInstalled(env.ctx);
}

/** `[ -f mcp-servers.org.json ]`. */
export function hasOrgManifest(env: StepEnv): boolean {
  try {
    return fs.statSync(orgMcpManifestPath(env.ctx.repoDir)).isFile();
  } catch {
    return false;
  }
}

/**
 * Gemini's `org_mcp_to_native gemini "$(read_org_mcp_manifest ...)"`, guarded on the manifest file;
 * `undefined` when there is none. A manifest the translator refuses folds nothing, with one warning
 * on stderr (the same policy as `foldOrgMcpNative`).
 */
export function orgNativeFor(env: StepEnv): ReadonlyMap<string, JsonValue> | undefined {
  if (!hasOrgManifest(env)) return undefined;
  try {
    return orgMcpToNative(env.descriptor.cli, readOrgMcpManifest(env.ctx.repoDir));
  } catch (error) {
    if (!(error instanceof ExtError)) throw error;
    env.ctx.io.err(`  WARNING: the org MCP manifest is ignored: ${error.message}`);
    return new Map();
  }
}
