// usage-headless.ts: headless usage capture (spec 0206 step 15, spec 0261; the shell original is retired). It derives
// one run-total record from a headless CLI envelope and submits it, calling the CommonJS adapters
// in-process instead of through a generated node driver. Capture NEVER fails or blocks the wrapped
// run: every error is swallowed. CREWRIG_USAGE_ROOT is resolved AT CALL TIME from the passed env.
// The agy rewrite is in place: the reply is never staged in a second file.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export type UsageEnv = Readonly<Record<string, string | undefined>>;

export interface UsageOptions {
  /** Project root recorded on the derived record; defaults to the process's own directory. */
  readonly cwd?: string;
}

const require = createRequire(import.meta.url);
const CAPTURE_DIR = path.join(import.meta.dirname, "usage-capture");

interface Rec {
  readonly nowInstant: () => string;
}
interface Headless {
  readonly capture: (args: Record<string, unknown>) => unknown;
}
interface Sink {
  readonly submit: (rec: unknown) => unknown;
}

function usageRoot(env: UsageEnv): string {
  const explicit = env.CREWRIG_USAGE_ROOT;
  if (explicit !== undefined && explicit !== "") return explicit;
  return `${env.HOME ?? ""}/.crewrig/usage`;
}

/** Runs `fn` with `process.env` replaced by the caller's env (the adapters read it), then restores it. */
function withEnv<T>(env: UsageEnv, fn: () => T): T {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const [key, value] of Object.entries(env))
      if (value !== undefined) process.env[key] = value;
    process.env.CREWRIG_USAGE_ROOT = usageRoot(env);
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

function readEnvelope(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function submitEnvelope(
  cli: string,
  envelope: unknown,
  launchInstant: string,
  env: UsageEnv,
  opts: UsageOptions,
): void {
  try {
    withEnv(env, () => {
      const headless = require(
        path.join(CAPTURE_DIR, "adapters", "headless-envelope.js"),
      ) as Headless;
      const record = require(path.join(CAPTURE_DIR, "record.js")) as Rec;
      const sink = require(path.join(CAPTURE_DIR, "sink.js")) as Sink;
      const rec = headless.capture({
        cli,
        envelope,
        launchInstant,
        projectRoot: path.resolve(opts.cwd ?? "."),
        now: record.nowInstant,
      });
      sink.submit(rec);
    });
  } catch {
    // capture never fails or blocks the wrapped run (R15).
  }
}

function nonEmpty(file: string): boolean {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

/** usage_headless_capture_usage_file: a no-op when the file is missing or empty. */
export function usageHeadlessCaptureUsageFile(
  cli: string,
  usageOutputFile: string,
  launchInstant: string,
  env: UsageEnv,
  opts: UsageOptions = {},
): void {
  if (!nonEmpty(usageOutputFile)) return;
  submitEnvelope(cli, readEnvelope(usageOutputFile), launchInstant, env, opts);
}

/**
 * usage_headless_agy_rewrite_json_response: validates, submits one record, then rewrites the file in
 * place to the envelope's own string `.response`. Anything else leaves the file untouched.
 */
export function usageHeadlessAgyRewriteJsonResponse(
  outFile: string,
  launchInstant: string,
  env: UsageEnv,
  opts: UsageOptions = {},
): void {
  try {
    if (!nonEmpty(outFile)) return;
    const envelope = readEnvelope(outFile) as { response?: unknown } | null;
    if (!envelope || typeof envelope.response !== "string") return;
    submitEnvelope("antigravity", envelope, launchInstant, env, opts);
    fs.writeFileSync(outFile, envelope.response);
  } catch {
    // never fail the wrapped run.
  }
}
