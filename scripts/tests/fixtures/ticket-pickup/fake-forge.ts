// fake-forge.ts — a stateful, in-process forge for the spec 0244 pickup tests.
//
// One `FakeForge` holds the server-side truth of a few issues: every
// assignment mutation (who, when, which users, whether the forge writes a
// history item for it, when it becomes visible to readers), the comments, and
// a virtual clock. The per-forge wire front-ends in `fake-wire.ts` answer the
// adapters' `gh api` / `glab api` / `tea api` argv from this state in each
// forge's own JSON shape; nothing is shimmed on PATH.
//
// Knobs (all per forge instance): write semantics (additive, replace-on-add,
// GitLab single-assignee tier, Gitea dedicated endpoints vs non-atomic PATCH),
// users the forge silently refuses to assign, lagged visibility of a
// mutation, a failure of the k-th write call, an unreachable forge, and an
// identity endpoint failure.

import type { Forge, RunResult } from "../../../lib/forge-detect.ts";
import type { PickupDeps } from "../../../lib/ticket-pickup.ts";
import { main } from "../../../lib/ticket-pickup.ts";
import { wire } from "./fake-wire.ts";

export const T0 = Date.parse("2026-09-01T09:00:00Z");
export const DAY = 86_400_000;

export interface Step {
  user: string;
  op: "add" | "remove";
}

export interface Mutation {
  id: number;
  issue: number;
  at: number;
  actor: string;
  steps: Step[];
  /** True for a write issued through the tool (the pickup under test), false for a human act. */
  agent: boolean;
  /** False when the forge writes no history item for it (GitLab creation assignees). */
  recorded: boolean;
  /** Readers see the mutation (state and history) only from this instant on. */
  visibleAt: number;
  /** Readers see its history item only from this instant on (history lag). */
  itemVisibleAt: number;
}

export interface Comment {
  id: number;
  issue: number;
  at: number;
  author: string;
  body: string;
}

export interface Issue {
  n: number;
  author: string;
  createdAt: number;
}

export interface Knobs {
  /** An agent's add replaces the current set in one change ("whatever the forge does", R4). */
  replaceOnAdd: boolean;
  /** GitLab single-assignee tier: a PUT keeps only its first id. */
  singleAssignee: boolean;
  /** Gitea server version answered by `/version` (selects dedicated endpoints vs PATCH). */
  giteaVersion: string;
  /** Gitea `[api] MAX_RESPONSE_ITEMS`: the server caps every page's `limit` at this (i1-F3). */
  pageCap: number;
  /** Users the forge silently refuses to assign (fork contributors, R14). */
  cannotAssign: Set<string>;
  /** Visibility lag applied to every subsequent agent write by these actors (ms). */
  lagFor: Map<string, number>;
  /** History-only lag applied to every subsequent agent write (ms). */
  itemLag: number;
  /** Fail the k-th write call (1-based) with a server error; 0 disables. */
  failWrite: number;
  unreachable: boolean;
  identityFails: boolean;
  /** Whether a pre-assigned creation writes a history item (defaults per forge). */
  recordsCreation: boolean;
}

export interface Observed {
  at: number;
  issue: number;
  set: string[];
  agent: boolean;
}

export class FakeForge {
  readonly forge: Forge;
  now = T0;
  /** Virtual time every forge call costs (lets a sequence cross second boundaries). */
  callMs = 0;
  readonly issues = new Map<number, Issue>();
  readonly mutations: Mutation[] = [];
  readonly comments: Comment[] = [];
  /** Extra GitLab system notes rendered verbatim (grammar tests). */
  readonly rawNotes: Comment[] = [];
  /** Every server-side assignee set after each mutation, for the never-empty invariant. */
  readonly states: Observed[] = [];
  /** Every call as `actor: argv…`, and the write calls alone. */
  readonly calls: string[] = [];
  readonly writes: string[] = [];
  readonly ids = new Map<string, number>();
  knobs: Knobs;
  /** Hook run after each agent write (inject a rival act at the same instant). */
  afterWrite: ((actor: string, issue: number) => void) | null = null;
  private seq = 1;

  constructor(forge: Forge, knobs: Partial<Knobs> = {}) {
    this.forge = forge;
    this.knobs = {
      replaceOnAdd: false,
      singleAssignee: false,
      giteaVersion: "1.27.1",
      pageCap: Number.POSITIVE_INFINITY,
      cannotAssign: new Set(),
      lagFor: new Map(),
      itemLag: 0,
      failWrite: 0,
      unreachable: false,
      identityFails: false,
      recordsCreation: forge !== "gitlab",
      ...knobs,
    };
  }

  host(): string {
    return this.forge === "github"
      ? "github.com"
      : this.forge === "gitlab"
        ? "gitlab.com"
        : "gitea.example.org";
  }

  userId(login: string): number {
    let id = this.ids.get(login);
    if (id === undefined) {
      id = 100 + this.ids.size;
      this.ids.set(login, id);
    }
    return id;
  }

  loginOf(id: number): string | undefined {
    for (const [login, v] of this.ids) if (v === id) return login;
    return undefined;
  }

  /** Create issue `n`, optionally pre-assigned (recorded or not per `recordsCreation`). */
  issue(n: number, author = "author", preassigned: string[] = []): this {
    this.issues.set(n, { n, author, createdAt: this.now });
    if (preassigned.length > 0) {
      // GitHub and Gitea write the creation assignment item 1-2 s after created_at.
      if (this.knobs.recordsCreation) this.now += 1000;
      this.mutate(
        n,
        author,
        preassigned.map((user) => ({ user, op: "add" })),
        {
          recorded: this.knobs.recordsCreation,
        },
      );
    }
    return this;
  }

  advance(ms: number): this {
    this.now += ms;
    return this;
  }

  /** One human act (web UI): every step in one change, at one instant, by one actor. */
  human(actor: string, n: number, change: { add?: string[]; remove?: string[] }): this {
    const steps: Step[] = [
      ...(change.remove ?? []).map((user) => ({ user, op: "remove" as const })),
      ...(change.add ?? []).map((user) => ({ user, op: "add" as const })),
    ];
    this.mutate(n, actor, steps, {});
    return this;
  }

  say(author: string, n: number, body: string): this {
    this.comments.push({ id: this.seq++, issue: n, at: this.now, author, body });
    return this;
  }

  mutate(
    n: number,
    actor: string,
    steps: Step[],
    o: { agent?: boolean; recorded?: boolean; at?: number },
  ): void {
    if (steps.length === 0) return;
    const at = o.at ?? this.now;
    const agent = o.agent ?? false;
    const lag = agent ? (this.knobs.lagFor.get(actor) ?? 0) : 0;
    this.mutations.push({
      id: this.seq++,
      issue: n,
      at,
      actor,
      steps,
      agent,
      recorded: o.recorded ?? true,
      visibleAt: at + lag,
      itemVisibleAt: at + lag + (agent ? this.knobs.itemLag : 0),
    });
    this.states.push({ at, issue: n, set: this.assignees(n), agent });
  }

  /** Server-side truth, or the view a reader gets at `now` (lagged mutations hidden). */
  assignees(n: number, view = false): string[] {
    const set: string[] = [];
    for (const m of this.mutations) {
      if (m.issue !== n || (view && m.visibleAt > this.now)) continue;
      for (const s of m.steps) {
        const i = set.indexOf(s.user);
        if (s.op === "add" && i < 0) set.push(s.user);
        if (s.op === "remove" && i >= 0) set.splice(i, 1);
      }
    }
    return set;
  }

  /** History items a reader sees at `now`. */
  visibleMutations(n: number): Mutation[] {
    return this.mutations.filter(
      (m) => m.issue === n && m.recorded && m.visibleAt <= this.now && m.itemVisibleAt <= this.now,
    );
  }

  /** The `Run` seam for one contributor's forge CLI credential. */
  runAs(login: string): (argv: readonly string[]) => Promise<RunResult> {
    return async (argv) => {
      this.calls.push(`${login}: ${argv.join(" ")}`);
      this.now += this.callMs;
      if (this.knobs.unreachable)
        return { status: 1, stdout: "", stderr: `error connecting to ${this.host()}` };
      return wire(this, login, argv);
    };
  }

  /** Count a write call; true when the failure knob fires for it. */
  writeFails(login: string, what: string): boolean {
    this.writes.push(`${login}: ${what}`);
    return this.knobs.failWrite === this.writes.length;
  }

  /** Every state after an agent write, including intermediate states, that is empty. */
  emptyAfterAgentWrite(n: number): Observed[] {
    const first = this.states.findIndex((s) => s.issue === n && s.agent);
    if (first < 0) return [];
    return this.states.slice(first).filter((s) => s.issue === n && s.set.length === 0);
  }

  remoteUrl(): string {
    return this.forge === "gitlab"
      ? `git@${this.host()}:acme/tools/widgets.git`
      : `https://${this.host()}/acme/widgets.git`;
  }
}

export interface PickupResult {
  code: number;
  report: {
    verdict: string;
    owner: string | null;
    self: string | null;
    forge: string | null;
    actions: { op: string; target: string; ok: boolean }[];
    delays: { nudge_days: number; grace_days: number };
    reason?: string;
    exit: number;
  };
  stderr: string;
}

/** Deps for one contributor's pickup; `sleep` advances the virtual clock. */
export function depsFor(f: FakeForge, login: string, over: Partial<PickupDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: PickupDeps = {
    run: f.runAs(login),
    env: {},
    remoteUrl: () => f.remoteUrl(),
    readConfig: () => null,
    sleep: async (ms) => void (f.now += ms),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...over,
  };
  return { deps, out, err };
}

export function parseResult(code: number, out: string[], err: string[]): PickupResult {
  const report = JSON.parse(out[0] ?? "null") as PickupResult["report"];
  return { code, report, stderr: err.join("\n") };
}

/** Run one full pickup of issue `n` by `login`. */
export async function pickup(
  f: FakeForge,
  login: string,
  n: number,
  extra: string[] = [],
  over: Partial<PickupDeps> = {},
): Promise<PickupResult> {
  const { deps, out, err } = depsFor(f, login, over);
  const code = await main(["--issue", String(n), ...extra], deps);
  return parseResult(code, out, err);
}
