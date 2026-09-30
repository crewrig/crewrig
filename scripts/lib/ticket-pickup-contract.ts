// ticket-pickup-contract.ts — the ticket-pickup check's contract: the
// injected dependencies (the fake-forge seam), the JSON report, the timing
// knobs, and argument / overlay-config parsing (spec 0244 R8; PLAN v2 step 3).
// A `UsageError` maps to exit 1.

import type { Forge, Run } from "./forge-detect.ts";

export const ASSIGN_REQUEST_MARKER = "<!-- crewrig:ticket-pickup assign-request -->";

export interface Timing {
  settleMs: number;
  confirmGapMs: number;
  lagRetryMs: number;
  lagReads: number;
  confirmRounds: number;
}
export const TIMING: Timing = {
  settleMs: 2000,
  confirmGapMs: 1000,
  lagRetryMs: 2000,
  lagReads: 5,
  confirmRounds: 3,
};

/** Everything the check touches outside its own logic — the injection seam for a fake forge. */
export interface PickupDeps {
  run: Run;
  env: NodeJS.ProcessEnv;
  /** URL of the git remote whose forge holds the issue, or null when there is none. */
  remoteUrl: () => string | null;
  /** Name of that git remote (binds the `tea` login, i1-F2); optional for doubles. */
  remoteName?: () => string | null;
  /** Content of the overlay `crewrig.config.toml`, or null when absent. */
  readConfig: () => string | null;
  sleep: (ms: number) => Promise<void>;
  out: (line: string) => void;
  err: (line: string) => void;
  timing?: Partial<Timing>;
}

export interface Action {
  op: "add" | "remove" | "set" | "comment";
  target: string;
  ok: boolean;
  error?: string;
}

export interface Report {
  verdict: string;
  issue: number;
  owner: string | null;
  self: string | null;
  forge: Forge | null;
  actions: Action[];
  delays: { nudge_days: number; grace_days: number };
  reason?: string;
}

export const DEFAULT_DELAYS = { nudge_days: 14, grace_days: 7 } as const;

export class UsageError extends Error {}

export const USAGE = "usage: ticket-pickup.ts --issue <N> [--read-only]";

export function parseArgs(argv: readonly string[]): {
  issue: number;
  readOnly: boolean;
  help: boolean;
} {
  let issue: number | undefined;
  let readOnly = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--read-only") readOnly = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--issue" || a.startsWith("--issue=")) {
      const raw = a === "--issue" ? argv[++i] : a.slice("--issue=".length);
      if (raw === undefined || !/^#?[1-9]\d*$/.test(raw))
        throw new UsageError(`--issue needs a positive issue number`);
      issue = Number(raw.replace(/^#/, ""));
    } else throw new UsageError(`unknown argument '${a}'`);
  }
  if (help) return { issue: 0, readOnly, help };
  if (issue === undefined) throw new UsageError("--issue is required");
  return { issue, readOnly, help };
}

/** R8 delays from `ticket_nudge_days` / `ticket_grace_days`, parsed as build-components.sh reads the file. */
export function loadDelays(text: string | null): { nudge_days: number; grace_days: number } {
  const delays: { nudge_days: number; grace_days: number } = { ...DEFAULT_DELAYS };
  for (const line of (text ?? "").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    if (eq < 0 || key.startsWith("#")) continue;
    if (key !== "ticket_nudge_days" && key !== "ticket_grace_days") continue;
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    if (!/^[1-9]\d{0,3}$/.test(value))
      throw new UsageError(`crewrig.config.toml: malformed ${key} '${value}'`);
    delays[key === "ticket_nudge_days" ? "nudge_days" : "grace_days"] = Number(value);
  }
  return delays;
}
