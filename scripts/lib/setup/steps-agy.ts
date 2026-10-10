// steps-agy.ts — the Antigravity-specific steps of the setup flow (spec 0256 requirements 3, 6, 24,
// 30; plan v2 step B3b.1, task T6) and the Gemini legacy context cleanup. Shell:
// scripts/setup-antigravity-interactive.sh lines 403-415 (superseded migration), 417-490 (hooks
// rewrite, session recording), 492-604 (statusline usage capture), 611-644 (generated AGENTS.md)
// and scripts/setup-gemini-interactive.sh lines 498-505 (legacy GEMINI.md).
//
// `agySteps` registers the ids only Antigravity (or Antigravity and Gemini) owns. The three ids
// whose body depends on the hook CHANNEL (`hooks-rewrite-installed`, `session-recording`,
// `usage-capture`) are also registered by the Claude/Gemini/Copilot step files, and the registry is
// a plain spread: one key, one body. So they are EXPORTED here as `agyHooksRewriteInstalled`,
// `agySessionRecording` and `agyUsageCapture`, and the shared bodies dispatch on
// `descriptor.hooks.channel === "agy-json"` and delegate to them.

import fs from "node:fs";
import path from "node:path";

import {
  TRANSCRIPT_CANCELED,
  TRANSCRIPT_DISABLED,
  agyPaths,
  applyTranscriptHooks,
  rewriteInstalledAntigravityHooks,
  transcriptDisclosure,
} from "./antigravity-hooks.ts";
import {
  USAGE_CAPTURE_DISABLED,
  enableStatusline,
  keepStatusline,
  removeStatusline,
  statuslineInstalled,
  statuslineInstalledNotice,
} from "./antigravity-statusline.ts";
import { migrateSupersededPlacement } from "./antigravity-tier.ts";
import type { Io, SetupCtx } from "./context.ts";
import type { StepFn, StepRegistry } from "./descriptor.ts";
import { SetupExit } from "./exit.ts";
import { failClosed } from "./steps.ts";

type PrepareFn = (env: Parameters<StepFn>[0]) => Promise<void> | void;

/**
 * `mcp-prepare`: the announcement and the `mkdir -p` of the MCP config directory, written by the
 * MCP task (`mcp-agy-step.ts`, export `prepare`). Imported dynamically, by a computed specifier,
 * so this file loads (and type-checks) before that file exists.
 */
const mcpPrepare: StepFn = async (env) => {
  const specifier = "./mcp-agy-step.ts";
  const loaded: unknown = await import(specifier);
  const prepare: unknown =
    typeof loaded === "object" && loaded !== null
      ? (loaded as Record<string, unknown>)["prepare"]
      : undefined;
  if (typeof prepare !== "function") {
    throw new Error("setup step 'mcp-prepare': mcp-agy-step.ts does not export prepare()");
  }
  await (prepare as PrepareFn)(env);
};

/** `migrate_antigravity_superseded_components ... all || exit 1`, announcement and blank line included. */
const migrateSuperseded: StepFn = async ({ ctx, state }) => {
  migrateSupersededPlacement({ ...ctx, outcomes: state.outcomes });
};

// --- the channel steps (dispatched by `descriptor.hooks.channel === "agy-json"`) --------------------

/** The per-run rewrites of an installed guard and transcript registration, no leading blank line. */
export const agyHooksRewriteInstalled: StepFn = async ({ ctx, spawn }) => {
  rewriteInstalledAntigravityHooks(ctx, spawn, agyPaths(ctx));
};

/**
 * The transcript opt-in (spec 0116): `transcripts`, then the disclosure and `transcripts-confirm`
 * (both abort-class on Antigravity), then the deployment; a trailing blank line closes the block.
 */
export const agySessionRecording: StepFn = async ({ ctx, spawn, session }) => {
  const paths = agyPaths(ctx);
  const enable = await session.choose({
    id: "transcripts",
    header: "Enable automatic session recording to MemPalace? (opt-in)",
    options: ["no", "yes"],
    cancel: "abort",
  });
  if (enable === "yes") {
    transcriptDisclosure(ctx, paths.hooksJson);
    const confirm = await session.choose({
      id: "transcripts-confirm",
      header: "Apply?",
      options: ["yes", "no"],
      cancel: "abort",
    });
    if (confirm === "yes") {
      // `if ! deploy ...`: a refused merge reports and lets the run finish.
      try {
        applyTranscriptHooks(ctx, spawn, paths);
      } catch (error) {
        if (error instanceof SetupExit) throw error;
        ctx.io.err("  Transcript activation FAILED — setup continues without it.");
      }
    } else {
      ctx.io.out(TRANSCRIPT_CANCELED);
    }
  } else {
    ctx.io.out(TRANSCRIPT_DISABLED);
  }
  ctx.io.out("");
};

/** The statusline channel (spec 0206, 0243): keep/remove when installed by us, else the opt-in. */
export const agyUsageCapture: StepFn = async ({ ctx, spawn, session }) => {
  const paths = agyPaths(ctx);
  const { installed, current } = statuslineInstalled(paths);
  if (installed) {
    statuslineInstalledNotice(ctx, current);
    const action = await session.choose({
      id: "usage-capture-keep",
      header:
        "Antigravity usage capture is installed — keep it, or remove it (restores the prior statusLine.command, R21)?",
      options: ["keep", "remove"],
      cancel: "abort",
    });
    if (action === "remove") {
      failClosed(ctx.io, "cannot remove Antigravity usage capture", () =>
        removeStatusline(ctx, paths),
      );
    } else {
      keepStatusline(ctx, spawn, paths);
    }
    return;
  }
  const enable = await session.choose({
    id: "usage-capture",
    header: "Enable Antigravity CLI usage capture (statusline channel, opt-in)?",
    options: ["no", "yes"],
    cancel: "abort",
  });
  if (enable === "yes") enableStatusline(ctx, spawn, paths);
  else ctx.io.out(USAGE_CAPTURE_DISABLED);
};

// --- the generated system context and the legacy GEMINI.md ------------------------------------------

const CONTEXT_FILE = /^\d\d_.*\.md$/;
const SECTION_MARK = "<!-- crewrig-section:";

/** `find "$AGY_HOME" -maxdepth 1 \( -type f -o -type l \) -name '[0-9][0-9]_*.md' | sort`. */
function contextFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => CONTEXT_FILE.test(name))
      .filter((name) => {
        try {
          return !fs.lstatSync(path.join(dir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/** `cat` of one file; a dangling link prints nothing (the shell's `cat` error is not captured). */
function catFile(file: string): Buffer {
  try {
    return fs.readFileSync(file);
  } catch {
    return Buffer.alloc(0);
  }
}

/** `wc -l`: the number of line feeds. */
function lineCount(content: Buffer): number {
  let lines = 0;
  for (const byte of content) if (byte === 0x0a) lines += 1;
  return lines;
}

/**
 * `rm -f ~/.gemini/GEMINI.md` when it still carries the generated-section marker (spec 0061
 * delta-02, issue #1082); `trailingBlank` is Antigravity's `echo ""` after the notice.
 */
export function removeLegacyContextFile(ctx: SetupCtx, trailingBlank: boolean): void {
  const legacy = path.join(ctx.home, ".gemini", "GEMINI.md");
  let marked = false;
  try {
    marked = fs.statSync(legacy).isFile() && fs.readFileSync(legacy, "utf8").includes(SECTION_MARK);
  } catch {
    marked = false;
  }
  if (!marked) return;
  failClosed(ctx.io, `cannot remove ${legacy}`, () => fs.rmSync(legacy, { force: true }));
  ctx.io.out(`  Removed superseded context file: ${legacy}`);
  if (trailingBlank) ctx.io.out("");
}

/** The Gemini and Antigravity step: dispatch on the CLI, only the blank line after the notice differs. */
const legacyContextCleanup: StepFn = async ({ ctx }) => {
  removeLegacyContextFile(ctx, ctx.cli === "antigravity");
};

function generate(ctx: SetupCtx, agyHome: string, target: string, io: Io): number {
  const names = contextFiles(agyHome);
  if (names.length === 0) {
    io.out(`  No context files found in ${agyHome} — ${target} not written.`);
    return 0;
  }
  const parts: Buffer[] = [];
  for (const name of names) {
    parts.push(Buffer.from(`${SECTION_MARK} ${name} -->\n\n`));
    parts.push(catFile(path.join(agyHome, name)));
    parts.push(Buffer.from("\n"));
  }
  const content = Buffer.concat(parts);
  failClosed(ctx.io, `cannot write ${target}`, () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, content);
    fs.renameSync(`${target}.tmp`, target);
  });
  const lines = lineCount(content);
  io.out(`  Generated: ${target} (${lines} lines)`);
  return lines;
}

/**
 * `system-context-file`: concatenate the deployed priority-ordered context files into
 * `~/.gemini/config/AGENTS.md` (tmp file then rename), then run the legacy GEMINI.md cleanup, which
 * the shell does inline right after. Prints the blank line that follows `session-check`, sets
 * `state.agentsMdLines`. The cleanup is idempotent: a descriptor that also lists
 * `legacy-context-cleanup` after this step prints nothing twice.
 */
const systemContextFile: StepFn = async ({ ctx, state }) => {
  const agyHome = agyPaths(ctx).agyHome;
  const target = path.join(ctx.home, ".gemini", "config", "AGENTS.md");
  ctx.io.out("");
  ctx.io.out(`Generating ${target}...`);
  state.agentsMdLines = generate(ctx, agyHome, target, ctx.io);
  ctx.io.out("");
  removeLegacyContextFile(ctx, true);
};

export const agySteps: StepRegistry = {
  "mcp-prepare": mcpPrepare,
  "migrate-superseded": migrateSuperseded,
  "legacy-context-cleanup": legacyContextCleanup,
  "system-context-file": systemContextFile,
};
