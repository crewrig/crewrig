// economy-transform.ts — mechanical old-rules to new-rules transformation of a closed ticket's
// comment set, and the before/after measure (spec 0275 R-H2). Pure and deterministic; the input is
// the committed manifest produced by scripts/economy-snapshot.ts from real forge data.
//
// Old rules: the real comments, plus, per seated pass, the dossier re-read (the bodies of the
// seat's earlier verdict comments, voided ones included, because the pass must fetch them to
// know they are void).
// New rules (each rule is mechanical, nothing is tuned):
//   T1  Logbook comments are merged into one comment per stage transition (specs, plan, dev,
//       review, merge). Stage is positional: `specs` until the first plan comment, then `plan`,
//       `dev` from the "DEV started" logbook, `review` from the "ready for REVIEW" logbook,
//       `merge` from the "MERGED" logbook. A merged comment is one title line plus every member's
//       body without its own title line (one bullet group per member, as posted).
//   T2  Plan v2 and later are deltas: a link line, the title, each section whose sha256 differs
//       from the previous version in full, each unchanged section as one "unchanged from v(N-1)"
//       line, and the `Finding traceability` section always in full (cumulative, R-D2).
//   T3  Verdict comments keep their content (immutable audit trail, R-B3).
//   T5  R-E1/R-E3: every new-rules plan or verdict comment over 12288 bytes is cut to 12288 bytes
//       (content plus a 120-byte reference line); the bytes moved to a linked artifact are reported
//       separately as relocated, never counted as logbook or dossier bytes. The uncapped figure is
//       reported too.
//   T4  Each seat's dossier re-read is replaced by reading its ledger: the findings of its earlier
//       non-void verdicts, rendered in the R-B2 grammar. The seat's ledger comment is itself one
//       new comment, at its final size.
// Not measured: the diff-bounded read of pass 2 and later, which is not a comment.

import type { Manifest, SnapshotComment } from "../economy-snapshot.ts";
import { formatLedger, type Finding } from "./seat-ledger-parse.ts";

/** Floor from spec 0275 R-H2. Never lowered without a spec delta, never tuned to pass. */
export const MIN_SAVING = 0.5;

const enc = (s: string): number => Buffer.byteLength(s, "utf8");
const KINDS = ["logbook", "plan", "verdict", "ledger", "other"] as const;
type Kind = (typeof KINDS)[number];

export interface Transcript {
  comments: number;
  postedBytes: number;
  dossierReadBytes: number;
  totalBytes: number;
  byKind: Record<Kind, { comments: number; bytes: number }>;
}

export interface Measure {
  old: Transcript;
  /** New rules with the R-E1/R-E3 cap applied: this is the measured, floor-checked figure. */
  new: Transcript;
  /** Saving of `new` against `old`; the value MIN_SAVING is checked against. */
  saving: number;
  /** New rules without the cap (disclosure only). */
  uncapped: Transcript;
  uncappedSaving: number;
  /** Bytes moved out of over-budget plan and verdict comments to linked artifacts (R-E3); not counted in `new`. */
  relocatedBytes: number;
  cappedComments: number;
}

/** R-E1: a plan or verdict comment is at most 12288 bytes. */
export const COMMENT_BUDGET = 12288;
/** R-E3: the reference line left in an over-budget comment where the bulk moved to a linked artifact. */
export const REFERENCE_LINE_BYTES = 120;

function capped(size: number): { posted: number; relocated: number } {
  if (size <= COMMENT_BUDGET) return { posted: size, relocated: 0 };
  const kept = COMMENT_BUDGET - REFERENCE_LINE_BYTES;
  return { posted: COMMENT_BUDGET, relocated: size - kept };
}

function empty(): Transcript["byKind"] {
  return Object.fromEntries(
    KINDS.map((k) => [k, { comments: 0, bytes: 0 }]),
  ) as Transcript["byKind"];
}

function finish(byKind: Transcript["byKind"], dossierReadBytes: number): Transcript {
  let comments = 0;
  let postedBytes = 0;
  for (const k of KINDS) {
    comments += byKind[k].comments;
    postedBytes += byKind[k].bytes;
  }
  return {
    comments,
    postedBytes,
    dossierReadBytes,
    totalBytes: postedBytes + dossierReadBytes,
    byKind,
  };
}

type Stage = "specs" | "plan" | "dev" | "review" | "merge";

export function stageOf(comments: readonly SnapshotComment[]): Map<number, Stage> {
  const out = new Map<number, Stage>();
  let stage: Stage = "specs";
  for (const c of comments) {
    if (c.kind === "plan" && stage === "specs") stage = "plan";
    if (c.kind === "logbook") {
      if (c.title.startsWith("## Logbook — DEV started")) stage = "dev";
      else if (/ready for REVIEW/.test(c.title)) stage = "review";
      else if (/MERGED/.test(c.title)) stage = "merge";
    }
    out.set(c.id, stage);
  }
  return out;
}

function planDeltaBytes(cur: SnapshotComment, prev: SnapshotComment, previousUrl: string): number {
  let total = enc(
    `Delta against [v${prev.planVersion}](${previousUrl}); not self-contained except through that link.\n\n`,
  );
  total += cur.titleBytes;
  const before = new Set(prev.sections.map((s) => s.sha256));
  for (const s of cur.sections) {
    if (s.heading === "" || /^Finding traceability$/i.test(s.heading) || !before.has(s.sha256))
      total += s.bytes + 1;
    else total += enc(`Unchanged from v${prev.planVersion}: ${s.heading}\n`);
  }
  return total;
}

function ledgerFor(seat: string, prior: readonly SnapshotComment[]): string {
  const live = prior.filter((v) => !v.void);
  const findings: Finding[] = live.flatMap((v) =>
    (v.findings ?? []).map((f) => ({
      id: f.id,
      class: f.class,
      blocking: f.blocking,
      status: "open" as const,
      revision: v.revision ?? "-",
      ref: "-",
    })),
  );
  const examined = live.at(-1)?.revision ?? "-";
  return formatLedger({ seat, examined, rev: live.length + 1, findings });
}

export function measure(manifest: Manifest): Measure {
  const withCap = measureWith(manifest, true);
  const without = measureWith(manifest, false);
  return {
    old: withCap.old,
    new: withCap.new,
    saving: withCap.saving,
    uncapped: without.new,
    uncappedSaving: without.saving,
    relocatedBytes: withCap.relocated,
    cappedComments: withCap.cappedComments,
  };
}

function measureWith(manifest: Manifest, cap: boolean) {
  let relocated = 0;
  let cappedComments = 0;
  const post = (size: number): number => {
    if (!cap) return size;
    const c = capped(size);
    if (c.relocated > 0) cappedComments += 1;
    relocated += c.relocated;
    return c.posted;
  };
  const cs = manifest.comments;
  // Old rules.
  const oldKinds = empty();
  for (const c of cs) {
    const k: Kind = c.kind === "verdict" ? "verdict" : c.kind;
    oldKinds[k].comments += 1;
    oldKinds[k].bytes += c.bytes;
  }
  const verdicts = cs.filter((c) => c.kind === "verdict");
  let oldRead = 0;
  let newRead = 0;
  const seats = new Set(verdicts.map((v) => v.seat as string));
  verdicts.forEach((v, i) => {
    const prior = verdicts.slice(0, i).filter((p) => p.seat === v.seat);
    oldRead += prior.reduce((a, p) => a + p.bytes, 0);
    if (prior.length > 0) newRead += enc(ledgerFor(v.seat as string, prior));
  });

  // New rules.
  const newKinds = empty();
  const stages = stageOf(cs);
  const groups = new Map<Stage, number>();
  const order: Stage[] = [];
  const plans = cs.filter((c) => c.kind === "plan");
  for (const c of cs) {
    if (c.kind === "logbook") {
      const st = stages.get(c.id) as Stage;
      if (!groups.has(st)) {
        order.push(st);
        groups.set(st, enc(`## Logbook — ${st}\n\n`));
      }
      groups.set(st, (groups.get(st) as number) + c.bytes - c.titleBytes);
    } else if (c.kind === "plan") {
      const i = plans.indexOf(c);
      const prev = plans[i - 1];
      const size = prev
        ? planDeltaBytes(
            c,
            prev,
            `https://github.com/crewrig/crewrig/issues/1410#issuecomment-${prev.id}`,
          )
        : c.bytes;
      newKinds.plan.comments += 1;
      newKinds.plan.bytes += post(size);
    } else {
      const k: Kind = c.kind === "verdict" ? "verdict" : c.kind;
      newKinds[k].comments += 1;
      newKinds[k].bytes += k === "verdict" ? post(c.bytes) : c.bytes;
    }
  }
  for (const st of order) {
    newKinds.logbook.comments += 1;
    newKinds.logbook.bytes += groups.get(st) as number;
  }
  for (const seat of seats) {
    newKinds.ledger.comments += 1;
    newKinds.ledger.bytes += enc(
      ledgerFor(
        seat,
        verdicts.filter((v) => v.seat === seat),
      ),
    );
  }

  const o = finish(oldKinds, oldRead);
  const n = finish(newKinds, newRead);
  return { old: o, new: n, saving: 1 - n.totalBytes / o.totalBytes, relocated, cappedComments };
}
