// hook-run.ts — the slow path shared by hooks/usage-capture.ts and
// hooks/antigravity-statusline-shim.ts (spec 0243 R3, R7, R9, R10).
//
// The entries decide, with the standard library alone, that there is
// something to capture, and only then load this module (R6). It replaces the
// retired scripts/lib/usage-capture/cli.js: the payload is parsed here and the
// untouched dispatcher (index.js) runs in the hook's own process, so no
// intermediate process is spawned and no file holding the payload is written
// (R10). The one exception is the test-only override (R9).
//
// Standard library only (R11). Errors are swallowed here except the
// `MissingDependencyError` of spec 0240 R7, which the caller reports (R12).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTempNextTo, discardTemp } from "../tmp-file.ts";

export interface RunCaptureInput {
  /** `claude-code`, `gemini-cli`, `copilot-cli` or `antigravity`. */
  readonly cli: string;
  /** The firing lifecycle event, forwarded to the dispatcher verbatim. */
  readonly event: string;
  /** The payload exactly as read from standard input. */
  readonly rawPayload: string;
}

/** Unparseable text becomes `{}`, as cli.js did: the adapter then records why. */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * Run the override script as a separate process with the payload staged in an
 * owner-only file (R9). The file lives in the OS temporary directory, is
 * written through the descriptor the exclusive create returned (never renamed
 * onto a target) and closed before the child starts; `discardTemp` removes it
 * in a `finally`, on every path.
 */
function runOverride(script: string, input: RunCaptureInput): void {
  const tmp = createTempNextTo(path.join(os.tmpdir(), "crewrig-usage-capture-payload"));
  try {
    fs.writeSync(tmp.fd, input.rawPayload);
    fs.closeSync(tmp.fd);
    spawnSync(
      process.execPath,
      [script, "--cli", input.cli, "--event", input.event, "--payload-file", tmp.path],
      { stdio: "ignore" },
    );
  } finally {
    discardTemp(tmp);
  }
}

/**
 * Derive and store the records of one firing.
 *
 * @throws the `MissingDependencyError` a lazily loaded module raises; every
 *   other failure is swallowed (the dispatcher records it as `uncaptured`).
 */
export async function runCapture(input: RunCaptureInput): Promise<void> {
  const script = process.env["CREWRIG_USAGE_CAPTURE_CLI"];
  if (isNonEmpty(process.env["CREWRIG_USAGE_CAPTURE_TEST"]) && isNonEmpty(script)) {
    try {
      runOverride(script, input);
    } catch {
      // exit-zero contract (R5): a broken override never reaches the CLI
    }
    return;
  }
  try {
    const dispatcher = await import("./index.js");
    dispatcher.capture({
      cli: input.cli,
      event: input.event,
      payload: parsePayload(input.rawPayload),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "MissingDependencyError") throw error;
  }
}
