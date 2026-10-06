// run.ts — the slow path of hooks/mempalace-transcript.ts (spec 0247 R9-R16).
//
// The entry has already decided the argument shape, the enablement, that the
// payload is a JSON object and that the event is not `PostToolUse` (R7); it
// loads this module lazily only then. Here the record is built and sent, and
// the outcome logged on standard error exactly as the shell hook logged it
// (R15, spec 0074): the success line unless `MEMPALACE_TRANSCRIPT_QUIET` is
// `1`, the failure lines always. Nothing is ever written to standard output —
// the Antigravity acknowledgement is the entry's.
//
// Standard library only (R17).

import os from "node:os";

import { readTlsEnv } from "../tls-env.ts";
import { classify } from "./classify.ts";
import { deriveContext } from "./context.ts";
import { addDrawer, type DaemonOutcome } from "./daemon.ts";
import { utf8Cut } from "./fields.ts";
import { stopSummary } from "./stop-summary.ts";
import { readDaemonToken } from "./token.ts";

const MAX_CONTENT_BYTES = 4000;

export interface RunInput {
  /** The parsed payload, a JSON object. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The Antigravity event argument, `""` outside Antigravity mode. */
  readonly antigravityEvent: string;
  readonly antigravity: boolean;
  /** `hook_event_name`, else the Antigravity event argument (R10). */
  readonly event: string;
}

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** The trust variables for the Git process (R16): a malformed file yields none and is reported. */
function trustVariables(): Readonly<Record<string, string>> {
  const result = readTlsEnv(os.homedir());
  switch (result.kind) {
    case "ok":
      return result.vars;
    case "malformed":
      log(
        `mempalace-transcript: ignoring ${result.file}: line ${result.line} is not an \`export NAME=VALUE\` line written by setup`,
      );
      return {};
    case "unreadable":
      log(`mempalace-transcript: ignoring ${result.file}: it cannot be read`);
      return {};
    default:
      return {};
  }
}

export async function runTranscript(input: RunInput): Promise<void> {
  const entry = classify({
    payload: input.payload,
    antigravityEvent: input.antigravityEvent,
    event: input.event,
    stopSummary,
  });
  // Nothing to record: nothing sent and nothing on standard error (R10), so the
  // trust file is read only from here on.
  if (entry === undefined) return;
  const extraEnv = trustVariables();

  const context = deriveContext({
    antigravity: input.antigravity,
    payload: input.payload,
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    extraEnv,
    now: new Date(),
  });

  const token = readDaemonToken(process.env);
  const outcome: DaemonOutcome = token.ok
    ? await addDrawer({
        room: context.room,
        content: utf8Cut(entry.content, MAX_CONTENT_BYTES),
        token: token.token,
      })
    : { ok: false, status: 4, diagnostic: `DAEMON_UNREACHABLE: ${token.reason}` };

  if (outcome.ok) {
    if (process.env["MEMPALACE_TRANSCRIPT_QUIET"] !== "1") {
      log(`mempalace-transcript: persisted ${entry.type} to transcripts/${context.room}`);
    }
    return;
  }
  log(outcome.diagnostic);
  log(`mempalace-transcript: FAILED to persist ${entry.type} (rc=${outcome.status}): `);
}
