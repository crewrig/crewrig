// reserve-args.ts — argument and environment parsing of reserve-spec-id (spec 0262).
//
// Usage: parseArgs(argv) returns the parsed options or throws ExitSignal.
// Exit codes: 0 for --help, 1 for a malformed invocation.
// Finding-line format: `Error: <message>` on stderr.

import { ExitSignal, fail } from "./exit.ts";

export interface ReserveOptions {
  issue: string;
  wantId: string;
  corpus: string;
  offline: boolean;
  maxAttempts: number;
}

const USAGE = `reserve-spec-id.sh — secure a spec id before the spec file exists (spec 0112).

  bash scripts/reserve-spec-id.sh --issue <N>
      Allocate and secure the next free UPSTREAM id.

  bash scripts/reserve-spec-id.sh --id <ID> --issue <N> [--corpus upstream|org]
      Secure one specific identifier, treated as an opaque string. Both the
      maintainer path of requirement 10 (securing a fork contribution's id
      before merge) and, generalised from <NNNN> to any string, requirement 14
      of delta-01.

Options:
  --issue <N>   GitHub issue the id is reserved for. Required.
  --id <ID>     Secure this identifier instead of computing the next free one.
                Required with --corpus org.
  --corpus <c>  'upstream' (default) or 'org'. Explicit, never inferred from
                the identifier's shape.
  --offline     Skip the remote entirely and return exit 3.
  -h, --help    This block.

There is deliberately no --remote flag: the remote comes from the reference
branch, resolved with the repository's existing BASE_REF idiom below.

Environment:
  BASE_REF                       The reference branch. Default: the first
                                 remote matching 'crewrig|origin' (else the
                                 first remote) with /main appended. The remote
                                 is its first path component.
  CREWRIG_SPEC_ID_CARRIER        One-off carrier override for a single
                                 invocation, for debugging. NOT the normal
                                 configuration route — see
                                 .crewrig/spec-id-carrier.
  CREWRIG_SPEC_ID_MAX_ATTEMPTS   Retry budget for lost races (default 10).
  CREWRIG_REPO_DIR               Repository root override (used by the
                                 regression suite).

Exit codes: 0 secured (stdout: the id) | 3 allocated locally, NOT secured
(stdout: the id, then 'unsecured-id: true') | 1 genuine failure (stderr).
`;

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ReserveOptions {
  const maxRaw = env.CREWRIG_SPEC_ID_MAX_ATTEMPTS ?? "10";
  const opts: ReserveOptions = {
    issue: "",
    wantId: "",
    corpus: "upstream",
    offline: false,
    maxAttempts: 10,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;
    const valued = arg === "--issue" || arg === "--id" || arg === "--corpus";
    if (valued) {
      // `shift 2` with a single argument left fails under `set -e`: silent exit 1.
      if (argv.length - i < 2) throw new ExitSignal(1);
      const value = argv[i + 1] as string;
      if (arg === "--issue") opts.issue = value;
      else if (arg === "--id") opts.wantId = value;
      else opts.corpus = value;
      i += 2;
    } else if (arg === "--offline") {
      opts.offline = true;
      i += 1;
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(USAGE);
      throw new ExitSignal(0);
    } else {
      fail(`unknown argument '${arg}'. Run with --help for the usage block.`);
    }
  }
  if (opts.corpus !== "upstream" && opts.corpus !== "org")
    fail(`unknown corpus '${opts.corpus}'. Expected 'upstream' or 'org'.`);
  if (opts.issue === "")
    fail("--issue <N> is required: a reservation records the ticket it is held for.");
  if (/[^0-9]/.test(opts.issue)) fail(`--issue must be a positive integer, got '${opts.issue}'.`);
  if (maxRaw === "" || /[^0-9]/.test(maxRaw))
    fail(`CREWRIG_SPEC_ID_MAX_ATTEMPTS must be a positive integer, got '${maxRaw}'.`);
  opts.maxAttempts = Number(maxRaw);
  if (opts.maxAttempts < 1)
    fail(`CREWRIG_SPEC_ID_MAX_ATTEMPTS must be at least 1, got '${maxRaw}'.`);
  if (opts.corpus === "org" && opts.wantId === "")
    fail(`--corpus org requires --id <ID>. Computing the next free org identifier is
       out of scope (spec 0112 delta-01, requirement 16): the org numbering
       convention is deliberately unknown to upstream, per
       specs/0071-org-specs-lint-exclusion.md. Choose the identifier and pass it.`);
  return opts;
}
