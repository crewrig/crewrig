// ticket-pickup.ts — the spec 0244 R11 pickup check (PLAN v2 step 3, v2-F2);
// CLI entry: scripts/ticket-pickup.ts. Sequence: read → verdict → optional
// write(s) → confirming reads → final verdict. Exit codes: 0 proceed; 3 owned
// by another (own assignment withdrawn); 4 undecidable (R4, R13; own
// assignment left in place); 5 the self-assignment did not take (R14;
// maintainer asked once); 2 cannot determine (R13), including a write that
// failed partway; 1 usage or wiring.
// One JSON line goes to stdout and one human sentence to stderr.

import type { ForgeAdapter } from "./forge-assignment.ts";
import { createAdapter } from "./forge-assignment.ts";
import { ForgeError, detectForge, parseRemote } from "./forge-detect.ts";
import type { AssignmentRecord, Verdict } from "./ticket-ownership.ts";
import { addCount, determine, norm, recordKey, verdictFor } from "./ticket-ownership.ts";
import type { Action, PickupDeps, Report, Timing } from "./ticket-pickup-contract.ts";
import {
  ASSIGN_REQUEST_MARKER,
  TIMING,
  USAGE,
  UsageError,
  loadDelays,
  parseArgs,
} from "./ticket-pickup-contract.ts";

export type { Action, PickupDeps, Report, Timing } from "./ticket-pickup-contract.ts";
export { ASSIGN_REQUEST_MARKER, TIMING } from "./ticket-pickup-contract.ts";

class Pickup {
  readonly a: ForgeAdapter;
  readonly self: string;
  readonly deps: PickupDeps;
  readonly report: Report;
  readonly t: Timing;
  wrote = false;
  restored = false;
  constructor(a: ForgeAdapter, self: string, deps: PickupDeps, report: Report) {
    this.a = a;
    this.self = self;
    this.deps = deps;
    this.report = report;
    this.t = pickupTiming(deps);
  }

  async write(op: Action["op"], target: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.report.actions.push({ op, target, ok: true });
    } catch (e) {
      this.report.actions.push({ op, target, ok: false, error: (e as Error).message });
      throw e;
    }
  }

  /** Restore the owner if displaced, then withdraw self — never through the empty set (R4). */
  async withdraw(owner: string, rec: AssignmentRecord): Promise<number> {
    const others = rec.current.filter((u) => u !== this.self && u !== owner);
    const setAtomic = this.a.setAtomic;
    if (setAtomic !== undefined) {
      const list = [owner, ...others];
      await this.write("set", list.join(","), () => setAtomic(list));
    } else {
      let current = rec.current;
      if (!current.includes(owner)) {
        await this.write("add", owner, () => this.a.add(owner, current));
        current = (await this.a.readRecord()).current;
        if (!current.includes(owner))
          throw new ForgeError(`owner '${owner}' not visible after restoring it`);
      }
      if (current.every((u) => u === this.self))
        throw new ForgeError("withdrawal would leave the issue free");
      const snapshot = current;
      await this.write("remove", this.self, () => this.a.remove(this.self, snapshot));
    }
    return this.stop(
      "owned-by-other",
      3,
      owner,
      `issue is owned by '${owner}'; own assignment withdrawn. ${PATHS}`,
    );
  }

  stop(verdict: string, code: number, owner: string | null, reason: string): number {
    this.report.verdict = verdict;
    this.report.owner = owner;
    this.report.reason = reason;
    return code;
  }

  async act(v: Verdict, rec: AssignmentRecord): Promise<number> {
    switch (v.kind) {
      case "undecidable":
        return this.stop(
          v.kind,
          4,
          null,
          `the order of assignments cannot be decided (${v.reason})${this.leftInPlace(rec)}; settle it by agreement on the issue (spec 0244 R4)`,
        );
      case "cannot-determine":
        return this.stop(v.kind, 2, null, v.reason);
      case "owned-by-other":
        return this.stop(v.kind, 3, v.owner, `issue is owned by '${v.owner}'. ${PATHS}`);
      case "withdraw":
        return this.withdraw(v.owner, rec);
      case "proceed":
        return this.confirm();
      case "restore-self":
        // R11: owned by self, so restoring is no R14 retry; at most one restore.
        if (this.restored)
          return this.stop(
            "cannot-determine",
            2,
            v.owner,
            "own assignment displaced again after restoring it; left as found (spec 0244 R13)",
          );
        this.restored = true;
        return this.assignSelf(rec, false);
      case "assign-self":
        // R14 applies only while the issue reads free: never retry the self-assignment.
        if (this.wrote)
          return this.stop(
            "cannot-determine",
            2,
            null,
            "issue reads free again after the own assignment was recorded; not retried (spec 0244 R14)",
          );
        return this.assignSelf(rec, true);
    }
  }

  leftInPlace(rec: AssignmentRecord): string {
    return rec.current.includes(this.self)
      ? `; own assignment of '${this.self}' left in place`
      : "";
  }

  /** Self-assign once (never retried, R14), wait for it to be visible, settle, confirm (v2-F2). */
  async assignSelf(rec: AssignmentRecord, wasFree: boolean): Promise<number> {
    const before = addCount(rec, this.self);
    this.wrote = true;
    await this.write("add", this.self, () => this.a.add(this.self, rec.current));
    // Wait until the write shows in the current list or the history (v2-F2):
    // only a record still free after `lagReads` reads is an R14 drop.
    for (let read = 1; ; read++) {
      const now = await this.a.readRecord();
      const inCurrent = now.current.includes(this.self);
      if (addCount(now, this.self) > before) break;
      if (read >= this.t.lagReads) {
        if (!inCurrent && now.current.length === 0 && wasFree) return this.requestAssignment(now);
        if (!inCurrent) return this.confirm();
        return this.stop(
          "cannot-determine",
          2,
          null,
          `own assignment not visible in the history after ${read} reads; left in place`,
        );
      }
      await this.deps.sleep(this.t.lagRetryMs);
    }
    await this.deps.sleep(this.t.settleMs);
    return this.confirm();
  }

  /** Two identical, consistent reads at least `confirmGapMs` apart decide the final verdict. */
  async confirm(): Promise<number> {
    for (let round = 0; round < this.t.confirmRounds; round++) {
      const r1 = await this.a.readRecord();
      await this.deps.sleep(this.t.confirmGapMs);
      const r2 = await this.a.readRecord();
      if (recordKey(r1) !== recordKey(r2)) continue;
      const v = verdictFor(
        determine(r2, this.wrote ? this.self : undefined),
        r2.current,
        this.self,
      );
      if (v.kind === "proceed")
        return this.stop("proceed", 0, v.owner, `issue is owned by '${v.owner}'; proceed`);
      return this.act(v, r2);
    }
    return this.stop(
      "cannot-determine",
      2,
      null,
      "the assignment record kept changing between confirming reads",
    );
  }

  /** R14: ask a maintainer once per free period, then stop. */
  async requestAssignment(rec: AssignmentRecord): Promise<number> {
    const det = determine(rec, this.self);
    const since = det.kind === "free" ? det.lastFreeAt : rec.createdAt;
    const mention = `@${this.self}`;
    const asked = (await this.a.comments()).some(
      (c) =>
        c.at >= since &&
        c.body.includes(ASSIGN_REQUEST_MARKER) &&
        c.body.toLowerCase().includes(mention),
    );
    if (!asked) {
      const body = `${ASSIGN_REQUEST_MARKER}\nThe ticket-pickup check could not record the assignment of ${mention} on this issue: the forge left it unassigned. A maintainer is asked to assign this ticket to ${mention} (spec 0244 R14).`;
      await this.write("comment", "assign-request", () => this.a.comment(body));
    }
    return this.stop(
      "assignment-not-recorded",
      5,
      null,
      `the forge did not record the assignment of '${this.self}'; ${asked ? "a maintainer request is already open" : "a maintainer was asked to assign it"}; not retried`,
    );
  }
}

function pickupTiming(deps: PickupDeps): Timing {
  return { ...TIMING, ...deps.timing };
}

const PATHS =
  "Permitted paths: ask the owner on the issue, wait for the stale-lock path (spec 0244 R8), or pick another ticket.";

function describeActions(actions: readonly Action[]): string {
  if (actions.length === 0) return "no write was made";
  return actions.map((x) => `${x.op} ${x.target}: ${x.ok ? "done" : "FAILED"}`).join("; ");
}

/** Run the check; returns the process exit code. */
export async function main(argv: readonly string[], deps: PickupDeps): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  let delays: Report["delays"];
  try {
    args = parseArgs(argv);
    if (args.help) {
      deps.err(USAGE);
      return 0;
    }
    delays = loadDelays(deps.readConfig());
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    deps.err(`ticket-pickup: ${e.message}\n${USAGE}`);
    return 1;
  }
  const report: Report = {
    verdict: "cannot-determine",
    issue: args.issue,
    owner: null,
    self: null,
    forge: null,
    actions: [],
    delays,
  };
  let code: number;
  try {
    code = await run(args, deps, report);
  } catch (e) {
    if (!(e instanceof ForgeError)) throw e;
    report.verdict = "cannot-determine";
    report.reason = `${e.message}; writes: ${describeActions(report.actions)}`;
    code = 2;
  }
  deps.out(JSON.stringify({ ...report, exit: code }));
  deps.err(`ticket-pickup #${args.issue}: ${report.reason ?? report.verdict}`);
  return code;
}

async function run(
  args: { issue: number; readOnly: boolean },
  deps: PickupDeps,
  report: Report,
): Promise<number> {
  const url = deps.remoteUrl();
  const repo = url === null ? null : parseRemote(url);
  if (repo === null)
    throw new ForgeError(
      `cannot identify the forge from git remote '${url ?? "(none)"}'; set BASE_REF=<remote>/main`,
    );
  repo.remote = deps.remoteName?.() ?? undefined;
  const forge = detectForge(repo.host, deps.env);
  report.forge = forge;
  const adapter = createAdapter(forge, repo, args.issue, deps.run);
  const self = norm(await adapter.whoami());
  report.self = self;
  let rec = await adapter.readRecord();
  let v = verdictFor(determine(rec), rec.current, self);
  if (v.kind === "cannot-determine") {
    // Re-read once: the issue and history GETs may straddle a rival write.
    await deps.sleep(pickupTiming(deps).confirmGapMs);
    rec = await adapter.readRecord();
    v = verdictFor(determine(rec), rec.current, self);
  }
  const pickup = new Pickup(adapter, self, deps, report);
  if (!args.readOnly) return pickup.act(v, rec);
  const owner = "owner" in v ? v.owner : null;
  if (v.kind === "undecidable") return pickup.stop(v.kind, 4, null, v.reason);
  if (v.kind === "cannot-determine") return pickup.stop(v.kind, 2, null, v.reason);
  return pickup.stop(
    v.kind,
    0,
    owner,
    owner === null
      ? "issue is free (read-only, nothing written)"
      : `issue is owned by '${owner}' (read-only, nothing written)`,
  );
}
