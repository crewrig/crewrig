// wait-for-instance.ts — the restart wait of the Windows service proofs (issue 2007).

import type { DaemonState } from "./windows-service-fixture.ts";

/**
 * Wait for a daemon instance other than `previous`, then for its /healthz. The stand-in writes a fresh
 * `instance` each start, so the wait never depends on clearing state.json first: the repeating keep-alive
 * trigger may restart the task before a test's own `start` (IgnoreNew then drops that `/Run`), and a state
 * wiped after that restart is never written again (issue 2007).
 */
export async function waitForNewInstance(
  read: () => DaemonState | null,
  previous: string,
  probe: (port: number) => Promise<boolean>,
  timeoutMs: number,
  stepMs = 500,
): Promise<DaemonState> {
  const end = Date.now() + timeoutMs;
  let fresh: DaemonState | null = null;
  for (;;) {
    const s = read();
    if (s !== null && s.instance !== previous) {
      fresh = s;
      if (await probe(s.port)) return s;
    }
    if (Date.now() > end) {
      const seen =
        fresh === null ? "no new instance" : `instance on port ${fresh.port} not healthy`;
      throw new Error(
        `timed out after ${timeoutMs} ms waiting for daemon restarted by start (${seen})`,
      );
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
