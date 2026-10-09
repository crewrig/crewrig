// owner-check.ts — the listener-owner verdict of the status report (spec 0158;
// spec 0252 requirement 16 and delta-01; PLAN v3 D8). Messages are those of
// scripts/status-mcp-server.sh section 3.
//
//   VERIFIED      listener PID equals the supervised PID or descends from it
//   USURPED       both PIDs determined and neither relation holds
//   UNVERIFIABLE  the listener PID, the supervised PID or the parent table
//                 could not be obtained (never USURPED: delta-01 requirement 16)
//
// Seam MEMPALACE_MCP_EXPECTED_PID: set-but-empty means undeterminable, unset
// means look up. This file spawns nothing.

import { listenerPid, pidSeam } from "./listener-pid.ts";
import { hasAncestor, parentTable } from "./process-tree.ts";
import type { ParentTable } from "./process-tree.ts";

export type OwnerKind = "VERIFIED" | "USURPED" | "UNVERIFIABLE";

export interface OwnerVerdict {
  kind: OwnerKind;
  /** The lines to print, indentation included, exactly as the shell script prints them. */
  lines: string[];
  /** 0 for VERIFIED, 1 otherwise (the shell's `rc=1`). */
  exitCode: 0 | 1;
}

export interface OwnerInput {
  listenerPid: number | null;
  expectedPid: number | null;
  /** null when the parent table could not be obtained. */
  parents: ParentTable | null;
  host: string;
  port: number;
}

/** The pure verdict over already-collected inputs. */
export function ownerVerdict(i: OwnerInput): OwnerVerdict {
  const { listenerPid: listener, expectedPid: expected, parents } = i;
  if (listener !== null && expected !== null && listener === expected) {
    return {
      kind: "VERIFIED",
      lines: [`  owner:    VERIFIED (listener PID ${listener} is the supervised daemon)`],
      exitCode: 0,
    };
  }
  if (listener === null || expected === null || parents === null) {
    const table = listener !== null && expected !== null ? ", process table unavailable" : "";
    return {
      kind: "UNVERIFIABLE",
      lines: [
        `  owner:    UNVERIFIABLE (listener PID ${listener ?? "unknown"}, expected PID ${expected ?? "unknown"}${table})`,
      ],
      exitCode: 1,
    };
  }
  if (hasAncestor(parents, listener, expected)) {
    return {
      kind: "VERIFIED",
      lines: [
        `  owner:    VERIFIED (listener PID ${listener} descends from the supervised daemon PID ${expected})`,
      ],
      exitCode: 0,
    };
  }
  return {
    kind: "USURPED",
    lines: [
      "  owner:    *** USURPED LISTENER ***",
      `            PID ${listener} is answering on ${i.host}:${i.port}, but the`,
      `            supervisor runs PID ${expected}. A process that claimed`,
      "            the port first may have received the bearer token.",
      "            Rotate the token: task mempalace:rotate-token",
      "            (or: bash scripts/switch-mempalace-http.sh --rotate)",
    ],
    exitCode: 1,
  };
}

export interface OwnerCheckOptions {
  host: string;
  port: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The supervisor lookup (launchctl, systemctl or the task snapshot); consulted only when the seam is unset. */
  lookupExpected: () => number | null;
}

/** Collect the three inputs (seams first) and return the verdict. */
export function ownerCheck(o: OwnerCheckOptions): OwnerVerdict {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const listener = listenerPid(o.port, { platform, env });
  const seam = pidSeam(env, "MEMPALACE_MCP_EXPECTED_PID");
  const expected = seam.set ? seam.pid : o.lookupExpected();
  const parents =
    listener !== null && expected !== null && listener !== expected
      ? parentTable({ platform })
      : null;
  return ownerVerdict({
    listenerPid: listener,
    expectedPid: expected,
    parents,
    host: o.host,
    port: o.port,
  });
}
