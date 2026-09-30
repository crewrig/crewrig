// ticket-ownership.ts — pure ownership model of the ticket-pickup check
// (spec 0244 R1, R4, R11, R13; PLAN v2 step 1 with review edit v2-F1).
//
// No I/O. The forge adapters (scripts/lib/forge-assignment.ts) normalise an
// issue's assignment record into `AssignmentRecord`; this module replays it
// and names the owner, and `verdictFor` maps the result to the R11 branch.
// Every login is compared case-insensitively (lower-cased on entry).

export type Op = "add" | "remove";

/** One recorded assignment item: `actor` added or removed `user` at `at` (epoch ms). */
export interface AssignmentItem {
  at: number;
  actor: string;
  user: string;
  op: Op;
  /**
   * Forge-native change id (a GitLab system note). When absent, items that
   * share both `at` and `actor` form one change (GitHub, Gitea).
   */
  group?: string;
}

/** An issue's assignment record, as one adapter read returns it. */
export interface AssignmentRecord {
  current: readonly string[];
  items: readonly AssignmentItem[];
  createdAt: number;
  author: string;
  /** False when the forge records no item for assignees set at creation (seeding applies). */
  recordsCreationAssignees: boolean;
}

/** One change of the assignment set: items applied together, in recorded order. */
export interface Change {
  at: number;
  actor: string;
  items: { user: string; op: Op }[];
  synthetic: boolean;
}

export type Determination =
  | { kind: "free"; lastFreeAt: number }
  | { kind: "owned"; owner: string; since: number }
  | { kind: "tie"; reason: string }
  | { kind: "inconsistent"; reason: string };

export type Verdict =
  | { kind: "proceed"; owner: string }
  | { kind: "restore-self"; owner: string }
  | { kind: "withdraw"; owner: string; restoreOwner: boolean }
  | { kind: "owned-by-other"; owner: string }
  | { kind: "assign-self" }
  | { kind: "undecidable"; reason: string }
  | { kind: "cannot-determine"; reason: string };

/** Above this many orderings of same-instant changes, the record is a tie. */
export const MAX_ORDERINGS = 720;

export function norm(login: string): string {
  return login.trim().toLowerCase();
}

function sortedItems(items: readonly AssignmentItem[]): AssignmentItem[] {
  // Array.prototype.sort is stable: equal instants keep their recorded order.
  return items
    .map((i) => ({ ...i, actor: norm(i.actor), user: norm(i.user) }))
    .sort((a, b) => a.at - b.at);
}

/** Group recorded items into changes (a forge `group` id, else shared instant and actor). */
export function groupChanges(items: readonly AssignmentItem[]): Change[] {
  const byKey = new Map<string, Change>();
  const order: Change[] = [];
  for (const it of sortedItems(items)) {
    const key = it.group !== undefined ? `g:${it.group}` : `t:${it.at}\u0000${it.actor}`;
    let change = byKey.get(key);
    if (change === undefined) {
      change = { at: it.at, actor: it.actor, items: [], synthetic: false };
      byKey.set(key, change);
      order.push(change);
    }
    change.items.push({ user: it.user, op: it.op });
  }
  return order;
}

/**
 * The synthetic creation change of a forge that does not record creation
 * assignees (PLAN v2 step 1, as amended by v2-F1). S0 holds every user whose
 * first recorded item is a removal, plus the current assignees with no
 * recorded item — the latter only when the history holds no assignment item
 * at all. Any other unrecorded current assignee makes the record inconsistent.
 * `excludeSelf` is set by a pickup that wrote its own assignment: its user is
 * never seeded, its add must appear as a recorded item.
 */
export function creationSeed(
  rec: AssignmentRecord,
  excludeSelf?: string,
): { seed: Change | null } | { inconsistent: string } {
  if (rec.recordsCreationAssignees) return { seed: null };
  const items = sortedItems(rec.items);
  const first = new Map<string, Op>();
  for (const it of items) if (!first.has(it.user)) first.set(it.user, it.op);
  const self = excludeSelf === undefined ? undefined : norm(excludeSelf);
  const s0 = new Set<string>();
  for (const [user, op] of first) if (op === "remove") s0.add(user);
  for (const user of rec.current.map(norm)) {
    if (first.has(user) || user === self) continue;
    if (items.length > 0) {
      return { inconsistent: `current assignee '${user}' has no recorded assignment item` };
    }
    s0.add(user);
  }
  if (s0.size === 0) return { seed: null };
  const seedItems = [...s0].sort().map((user) => ({ user, op: "add" as Op }));
  return {
    seed: { at: rec.createdAt, actor: norm(rec.author), items: seedItems, synthetic: true },
  };
}

function sameSet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  const bs = new Set(b.map(norm));
  if (a.size !== bs.size) return false;
  for (const x of a) if (!bs.has(x)) return false;
  return true;
}

/** Replay one ordering of changes from the empty set (R1). */
export function replay(changes: readonly Change[], current: readonly string[]): Determination {
  const set = new Set<string>();
  let lastFree = -1;
  let lastFreeAt = Number.NEGATIVE_INFINITY;
  for (const [idx, change] of changes.entries()) {
    for (const it of change.items) {
      if (it.op === "add") set.add(it.user);
      else if (!set.delete(it.user)) {
        return { kind: "inconsistent", reason: `removal of unassigned '${it.user}'` };
      }
    }
    if (set.size === 0) {
      lastFree = idx;
      lastFreeAt = change.at;
    }
  }
  if (!sameSet(set, current)) {
    return {
      kind: "inconsistent",
      reason: `replayed assignees [${[...set].sort().join(", ")}] differ from current [${current.map(norm).sort().join(", ")}]`,
    };
  }
  if (set.size === 0) return { kind: "free", lastFreeAt };
  const taker = changes[lastFree + 1];
  if (taker === undefined) return { kind: "inconsistent", reason: "no change after last free" };
  const added = [...new Set(taker.items.filter((i) => i.op === "add").map((i) => i.user))];
  if (added.length !== 1 || added[0] === undefined) {
    return {
      kind: "tie",
      reason: `the first change since last free adds ${added.length} users (${added.join(", ")})`,
    };
  }
  return { kind: "owned", owner: added[0], since: taker.at };
}

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      out.push([x, ...rest]);
  });
  return out;
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

/** Every admissible ordering: same-instant changes by different actors may be in any order. */
function orderings(changes: readonly Change[]): Change[][] | null {
  const clusters: Change[][] = [];
  for (const c of changes) {
    const last = clusters[clusters.length - 1];
    const head = last?.[0];
    if (
      last !== undefined &&
      head !== undefined &&
      head.at === c.at &&
      !head.synthetic &&
      !c.synthetic
    )
      last.push(c);
    else clusters.push([c]);
  }
  let total = 1;
  for (const cl of clusters) {
    if (new Set(cl.map((c) => c.actor)).size > 1) total *= factorial(cl.length);
    if (total > MAX_ORDERINGS) return null;
  }
  let acc: Change[][] = [[]];
  for (const cl of clusters) {
    const variants = new Set(cl.map((c) => c.actor)).size > 1 ? permutations(cl) : [cl];
    acc = acc.flatMap((prefix) => variants.map((v) => [...prefix, ...v]));
  }
  return acc;
}

function outcomeKey(d: Determination): string {
  return d.kind === "owned" ? `owned:${d.owner}` : d.kind;
}

/**
 * Determine the owner of an issue (R1), or why it cannot be (R4, R13):
 * a tie (first change adding several users, or same-instant changes whose
 * order matters) or an inconsistent record (replay differs from current).
 */
export function determine(rec: AssignmentRecord, excludeSelf?: string): Determination {
  const seeded = creationSeed(rec, excludeSelf);
  if ("inconsistent" in seeded) return { kind: "inconsistent", reason: seeded.inconsistent };
  const changes = groupChanges(rec.items);
  if (seeded.seed !== null) changes.unshift(seeded.seed);
  const all = orderings(changes);
  if (all === null) return { kind: "tie", reason: "too many same-instant changes to order" };
  const results = all.map((o) => replay(o, rec.current));
  const consistent = results.filter((r) => r.kind !== "inconsistent");
  const first = consistent[0];
  if (first === undefined) return results[0] ?? { kind: "inconsistent", reason: "empty record" };
  if (new Set(consistent.map(outcomeKey)).size > 1) {
    return {
      kind: "tie",
      reason: "changes by different actors share an instant and their order decides the owner",
    };
  }
  return first;
}

/** Map a determination and the current list to the R11 branch for `self`. */
export function verdictFor(det: Determination, current: readonly string[], self: string): Verdict {
  const me = norm(self);
  const present = current.map(norm).includes(me);
  switch (det.kind) {
    case "free":
      return { kind: "assign-self" };
    case "tie":
      return { kind: "undecidable", reason: det.reason };
    case "inconsistent":
      return { kind: "cannot-determine", reason: `assignment record inconsistent: ${det.reason}` };
    case "owned": {
      if (det.owner === me)
        return present ? { kind: "proceed", owner: me } : { kind: "restore-self", owner: me };
      if (!present) return { kind: "owned-by-other", owner: det.owner };
      return {
        kind: "withdraw",
        owner: det.owner,
        restoreOwner: !current.map(norm).includes(det.owner),
      };
    }
  }
}

/** Number of recorded additions of `user` — the pickup's own-write visibility probe. */
export function addCount(rec: AssignmentRecord, user: string): number {
  const u = norm(user);
  return rec.items.filter((i) => i.op === "add" && norm(i.user) === u).length;
}

/** Canonical form of a read, so two confirming reads can be compared for identity. */
export function recordKey(rec: AssignmentRecord): string {
  const items = sortedItems(rec.items).map((i) => [i.at, i.actor, i.user, i.op, i.group ?? ""]);
  return JSON.stringify([rec.current.map(norm).sort(), items]);
}
