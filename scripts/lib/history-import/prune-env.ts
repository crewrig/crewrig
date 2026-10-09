// prune-env.ts — the environments of scripts/prune-transcripts.ts (spec 0253 R18, delta-01 R25
// items 8-9): the TLS variables of `~/.crewrig/tls-env.sh` read without sourcing it, and the child
// environment handed to prune_drawers.py.

import { readTlsEnv } from "../tls-env.ts";

export interface TlsLoad {
  /** The variables to apply: the file's, for a well-formed file; none otherwise. */
  readonly vars: Readonly<Record<string, string>>;
  /** The one `Warning:` line for a malformed or unreadable file. */
  readonly warning: string | undefined;
}

/** Read the trust file under `home`; a malformed or unreadable one applies nothing and warns. */
export function loadTls(home: string): TlsLoad {
  const result = readTlsEnv(home);
  switch (result.kind) {
    case "ok":
      return { vars: result.vars, warning: undefined };
    case "absent":
      return { vars: {}, warning: undefined };
    case "malformed":
      return {
        vars: {},
        warning: `Warning: ${result.file} is unreadable or malformed (line ${result.line}); no custom CA variable applied`,
      };
    case "unreadable":
      return {
        vars: {},
        warning: `Warning: ${result.file} is unreadable or malformed; no custom CA variable applied`,
      };
  }
}

export interface ChildEnvInput {
  readonly cutoff: string;
  readonly dryRun: boolean;
  readonly project: string;
  readonly installSpec: string;
}

/** The environment of the Python child: the inherited one, the file's TLS overrides, the run's variables. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  tls: Readonly<Record<string, string>>,
  input: ChildEnvInput,
): NodeJS.ProcessEnv {
  return {
    ...base,
    ...tls,
    TRANSCRIPTS_WING: "transcripts",
    PROJECT_FILTER: input.project,
    CUTOFF_DATE: input.cutoff,
    DRY_RUN: input.dryRun ? "true" : "false",
    MEMPALACE_INSTALL_SPEC: input.installSpec,
  };
}
