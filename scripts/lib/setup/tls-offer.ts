// tls-offer.ts — the opt-in TLS delegation step (spec 0256 requirements 18-19). A TypeScript twin
// of `offer_tls_delegation` in scripts/lib/tls-delegation.sh: the same lines, the same bypass, the
// same consent rule, the file written by `writeTlsEnv` (scripts/lib/tls-env.ts) in the shell format.
//
// The shell sourced the written file so the immediately-following bootstrap saw the variables. A
// module here does not touch `process.env`: `offerTlsDelegation` RETURNS the variables, read back
// from the file with the reader, and the flow applies them with `Object.assign(process.env, vars)`
// and merges them into the environment it hands to the spawner. `ctx.env` is only read.

import type { Env, Io } from "../extension/types.ts";
import { readTlsEnv, writeTlsEnv, type TlsEnvResult } from "../tls-env.ts";
import { SetupExit } from "./exit.ts";
import type { PromptSession } from "./prompt.ts";
import { candidateCa, defaultTlsFs, detectCustomTlsContext, type TlsFs } from "./tls-detect.ts";

/** The part of the setup context the offer uses. */
export interface TlsOfferCtx {
  readonly io: Io;
  readonly env: Env;
  readonly home: string;
}

/** Everything that touches the machine; the defaults are the real file system and writer. */
export interface TlsOfferDeps {
  readonly fs: TlsFs;
  readonly write: (home: string, bundle: string) => { path: string; content: string };
  readonly read: (home: string) => TlsEnvResult;
}

export interface TlsOfferResult {
  /** True when `~/.crewrig/tls-env.sh` was written by this call. */
  readonly wrote: boolean;
  /** The variables the written file defines (empty when nothing was written). */
  readonly vars: Readonly<Record<string, string>>;
}

export const TLS_QUESTION_ID = "tls-delegation";
export const TLS_QUESTION_HEADER =
  "Configure the framework's tools to trust your system CA for its network operations? (never disables TLS verification; writes only ~/.crewrig/tls-env.sh)";

const NOTHING: TlsOfferResult = { wrote: false, vars: {} };

const defaultDeps: TlsOfferDeps = { fs: defaultTlsFs, write: writeTlsEnv, read: readTlsEnv };

/** Ask (or bypass) and, on consent, delegate trust to the resolved bundle. */
export async function offerTlsDelegation(args: {
  ctx: TlsOfferCtx;
  session: PromptSession;
  deps?: Partial<TlsOfferDeps>;
}): Promise<TlsOfferResult> {
  const { ctx, session } = args;
  const deps: TlsOfferDeps = { ...defaultDeps, ...args.deps };
  const { io } = ctx;
  const bypass = ctx.env["TLS_DELEGATION"];
  let choice: string | undefined;

  if (typeof bypass === "string" && bypass !== "") {
    if (bypass === "off") return NOTHING;
    if (bypass !== "on") {
      io.out(`  ERROR: invalid TLS_DELEGATION '${bypass}' (want: on|off)`);
      throw new SetupExit(1);
    }
    choice = "yes";
  } else {
    if (!detectCustomTlsContext(ctx.env, deps.fs.readdir)) return NOTHING;
    io.out("");
    io.out("Custom certificate trust (spec 0084):");
    io.out("  Your environment looks like it sits behind a custom or corporate");
    io.out("  certificate authority (a TLS-intercepting gateway or a private CA).");
    choice = await session.choose({
      id: TLS_QUESTION_ID,
      header: TLS_QUESTION_HEADER,
      options: ["no", "yes"],
      cancel: "decline",
    });
  }

  if (choice !== "yes") {
    io.out("  TLS delegation skipped — nothing written.");
    return NOTHING;
  }

  const bundle = candidateCa(ctx.env, deps.fs.isFile);
  if (bundle === undefined) {
    io.out("  Could not locate a certificate bundle to delegate trust to.");
    io.out("  Trust was NOT configured, and no verification-disabling setting was");
    io.out("  applied. See docs/runbooks/custom-ca-tls-trust.md to configure it");
    io.out("  manually (e.g. export CREWRIG_TLS_CA=/path/to/corporate-ca.pem, then");
    io.out("  re-run setup).");
    return NOTHING;
  }

  const written = deps.write(ctx.home, bundle);
  // The file is read back here too, whatever wrote it: a file the reader rejects is fatal, and the
  // variables the flow applies are the ones the reader parsed, not the ones the writer meant.
  const back = deps.read(ctx.home);
  if (back.kind !== "ok") {
    throw new Error(`tls-env: wrote ${written.path} but the reader rejects it (${back.kind})`);
  }

  io.out(`  Custom CA trust configured -> ${written.path}`);
  io.out(`  Delegated to CA bundle: ${bundle}`);
  io.out("  Applied for this setup run and, via scripts/lib/tls-exec.sh, for the");
  io.out("  framework's runtime paths (MCP servers, the ChromaDB daemon).");
  io.out("  Your shell profile was NOT modified. Remove with: rm " + written.path);
  io.out("");
  io.out("  Exact configuration written:");
  const lines = written.content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) io.out(`    ${line}`);
  return { wrote: true, vars: back.vars };
}
