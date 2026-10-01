// interleave.ts — an exhaustive two-pickup scheduler for the spec 0244 tests
// (PLAN v2 step 6, v1-F4).
//
// Every forge call and every sleep of each pickup is a gate the scheduler
// opens. A stateless depth-first search re-runs the scenario from scratch for
// each choice sequence until every interleaving has been visited:
//
// - when at least one pending operation is a forge WRITE, both orders are
//   explored (a write never commutes with the rival's read or write);
// - when both pending operations are reads or sleeps, the one due first on
//   the virtual clock runs (reads commute; time only moves forward).
//
// Sleeps are real on the virtual clock: a woken pickup moves the clock to at
// least its wake instant, so a pickup that is delayed past its wake instant is
// one of the explored schedules. `startGap` delays the second pickup's start.

import type { PickupResult } from "./fake-forge.ts";
import { FakeForge, depsFor, parseResult } from "./fake-forge.ts";
import { main } from "../../../lib/ticket-pickup.ts";

interface Party {
  login: string;
  pending: { write: boolean; wake: number; go: () => void } | null;
  done: boolean;
  result: PickupResult | null;
}

export interface RunOutcome {
  forge: FakeForge;
  results: PickupResult[];
  /** The choices taken at each branching point, for a readable failure message. */
  trail: string;
}

const isWrite = (argv: readonly string[]): boolean => {
  const i = argv.indexOf("-X");
  return i >= 0 && argv[i + 1] !== "GET";
};

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

async function runOnce(
  make: () => FakeForge,
  logins: readonly string[],
  issue: number,
  startGap: number,
  choose: (options: number) => number,
): Promise<RunOutcome> {
  const f = make();
  const t0 = f.now;
  const parties: Party[] = logins.map((login) => ({
    login,
    pending: null,
    done: false,
    result: null,
  }));
  const trail: string[] = [];
  parties.forEach((p, idx) => {
    let started = idx === 0 || startGap === 0;
    const gate = (write: boolean, wake: number): Promise<void> =>
      new Promise((go) => (p.pending = { write, wake, go }));
    const direct = f.runAs(p.login);
    const { deps, out, err } = depsFor(f, p.login, {
      run: async (argv) => {
        const wake = started ? f.now : t0 + startGap;
        started = true;
        await gate(isWrite(argv), wake);
        return direct(argv);
      },
      sleep: (ms) => gate(false, f.now + ms),
    });
    void main(["--issue", String(issue)], deps).then((code) => {
      p.done = true;
      p.result = parseResult(code, out, err);
    });
  });
  for (;;) {
    await flush();
    const ready = parties.filter((p) => !p.done && p.pending !== null);
    if (ready.length === 0) break;
    let pick: Party | undefined;
    if (ready.length > 1 && ready.some((p) => p.pending?.write === true)) {
      const i = choose(ready.length);
      pick = ready[i];
      trail.push(`${pick?.login ?? "?"}${pick?.pending?.write === true ? "!w" : ""}`);
    } else {
      pick = [...ready].sort((a, b) => (a.pending?.wake ?? 0) - (b.pending?.wake ?? 0))[0];
    }
    const pend = pick?.pending;
    if (pick === undefined || pend === null || pend === undefined) break;
    pick.pending = null;
    f.now = Math.max(f.now, pend.wake);
    pend.go();
  }
  const results = parties.map((p) => {
    if (p.result === null) throw new Error(`pickup of ${p.login} never finished`);
    return p.result;
  });
  return { forge: f, results, trail: trail.join(" ") };
}

/**
 * Visit every interleaving of two (or more) concurrent pickups of `issue`.
 * `check` runs after each complete schedule; returns the number of schedules.
 */
export async function exhaust(
  make: () => FakeForge,
  logins: readonly string[],
  issue: number,
  check: (o: RunOutcome) => void | Promise<void>,
  opts: { startGap?: number; maxRuns?: number } = {},
): Promise<number> {
  const maxRuns = opts.maxRuns ?? 20_000;
  let prefix: number[] = [];
  for (let runs = 1; ; runs++) {
    const taken: { i: number; n: number }[] = [];
    const outcome = await runOnce(make, logins, issue, opts.startGap ?? 0, (n) => {
      const i = prefix[taken.length] ?? 0;
      taken.push({ i, n });
      return i;
    });
    await check(outcome);
    let k = taken.length - 1;
    while (k >= 0 && (taken[k]?.i ?? 0) >= (taken[k]?.n ?? 1) - 1) k--;
    if (k < 0) return runs;
    if (runs >= maxRuns)
      throw new Error(`more than ${maxRuns} schedules: exploration not exhaustive`);
    prefix = [...taken.slice(0, k).map((t) => t.i), (taken[k]?.i ?? 0) + 1];
  }
}
