// flow.ts — the one runner of the four setups (spec 0256 requirements 3, 6, 11-16; plan v2 step
// B3b.1). `runSetup(descriptor, deps)` parses the command line, validates the pre-answers, then runs
// the descriptor's steps in order, each resolved in the registry below and awaited with a `StepEnv`.
// It never calls `process.exit` and reads nothing from `process`: the streams, the environment and
// the spawner come from `FlowDeps`, and the result is the exit status the entry sets.
//
// Stdin ownership (requirement 16): the flow executes the `link-confirm` step itself. The one-key
// question reads the stream BEFORE the line queue and the prompter exist; the unread remainder
// seeds the queue, which `link-confirm` then creates. A descriptor without `link-confirm` (Copilot)
// gets the queue before its first step. A step that runs before the prompter exists (Antigravity's
// `prerequisites`) and asks a question hits `NO_SESSION`, a programming error, not a user error.

import { flushFallbackNotice } from "./files.ts";
import { createAnswers, unusedWarning } from "./answers.ts";
import { parseSetupArgv } from "./argv.ts";
import type { Io, SetupCtx } from "./context.ts";
import type { FlowDeps, FlowState, SetupDescriptor, StepRegistry } from "./descriptor.ts";
import { SetupExit } from "./exit.ts";
import { askLinkConfirm } from "./link-key.ts";
import { createSession, type PromptSession } from "./prompt.ts";
import { createLineQueue } from "./prompt-queue.ts";
import { createSpawner } from "./spawner.ts";
import { agySteps } from "./steps-agy.ts";
import { copilotSteps } from "./steps-copilot.ts";
import { hooksSteps } from "./steps-hooks.ts";
import { mcpSteps } from "./steps-mcp.ts";
import { rulesSteps } from "./steps-rules.ts";
import { tierSteps } from "./steps-tiers.ts";
import { usageSteps } from "./steps-usage.ts";
import { commonSteps, notImplemented } from "./steps.ts";
import { summarySteps } from "./summary.ts";

function early(): never {
  throw new Error("a setup step asked a question before the prompter was created");
}

const NO_SESSION: PromptSession = { choose: early, confirm: early, close: () => undefined };

function ioOf(deps: FlowDeps): Io {
  return {
    out: (line) => void deps.stdout.write(`${line}\n`),
    err: (line) => void deps.stderr.write(`${line}\n`),
    errRaw: (text) => void deps.stderr.write(text),
  };
}

function initialState(env: FlowDeps["env"]): FlowState {
  return {
    env: { ...env },
    skipRules: false,
    mempalaceInstalled: false,
    tlsVars: {},
    tlsWrote: false,
    srTranscriptWired: false,
    srAllHooksDisabled: false,
    agentsMdLines: 0,
    outcomes: [],
  };
}

/** Run one setup; resolves with the exit status (0 on success) and rethrows a non-`SetupExit` error. */
export async function runSetup(descriptor: SetupDescriptor, deps: FlowDeps): Promise<number> {
  const io = ioOf(deps);
  const state = initialState(deps.env);
  let session: PromptSession | undefined;
  let ctx: SetupCtx | undefined;
  let unused: readonly string[] = [];
  let status = 0;
  try {
    const parsed = parseSetupArgv(deps.argv, io);
    const answers = createAnswers(parsed, descriptor.cli, io);
    // `ctx.env` is the flow-owned `state.env`: `tls-offer` merges into it and the spawner reads it.
    const run: SetupCtx = {
      io,
      env: state.env,
      platform: deps.platform,
      home: deps.home,
      repoDir: deps.repoDir,
      cli: descriptor.cli,
      link: parsed.link,
    };
    ctx = run;
    const spawn = deps.spawn ?? createSpawner(run);
    const registry: StepRegistry = {
      ...commonSteps,
      ...rulesSteps,
      ...mcpSteps,
      ...hooksSteps,
      ...agySteps,
      ...copilotSteps,
      ...usageSteps,
      ...tierSteps,
      ...summarySteps,
      ...deps.steps,
    };
    const open = (remainder: string): void => {
      const queue = createLineQueue(deps.stdin, { remainder });
      session = createSession({ queue, answers, io, isTty: deps.stdin.isTTY === true });
    };
    if (!descriptor.steps.includes("link-confirm")) open("");
    for (const id of descriptor.steps) {
      if (id === "link-confirm") {
        let remainder = "";
        if (parsed.link) {
          ({ remainder } = await askLinkConfirm({
            cli: descriptor.cli,
            io,
            stdin: deps.stdin,
            answers,
          }));
        }
        open(remainder);
        continue;
      }
      const step = registry[id] ?? notImplemented(id);
      await step({ descriptor, ctx: run, state, session: session ?? NO_SESSION, spawn, deps });
    }
    unused = answers.unused();
  } catch (error) {
    if (!(error instanceof SetupExit)) throw error;
    status = error.status;
  } finally {
    session?.close();
    deps.stdin.pause();
  }
  if (ctx !== undefined) flushFallbackNotice({ ...ctx, outcomes: state.outcomes });
  // Only a completed run knows which questions it never asked; an early exit would name every later one.
  const warning = status === 0 ? unusedWarning(unused) : undefined;
  if (warning !== undefined) io.err(warning);
  return status;
}
