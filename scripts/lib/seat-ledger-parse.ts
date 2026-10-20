// seat-ledger-parse.ts — ledger and verdict parsing, reconstruction and rebuild (spec 0275 R-B1, R-B2, R-F1).
// Re-exported by seat-ledger.ts. Header of the format follows.
//
//
// Ledger comment:
//   ledger: <surface>/<ticket>[#<generation>]
//   examined: <revision>
//   rev: <n>
//   - <id> | <class> | <blocking> | <status> | <revision> | <ref>
//
// Verdict (the immutable audit trail) carries a `seat:` line and, per finding, the header and
// `class:` line of docs/plan-format.md -> Finding tag schema, plus an optional `blocking:` line
// (default `yes`):
//   **Finding <n> (<id>)**
//   class: tech|arch|spec
//   blocking: yes|no
// The revision a verdict examined is its `examined:` / `revision:` line, else the `review of <rev>`
// of its title, else the revision encoded in a plan finding id (`v<N>`).
//
// A verdict does not record how a later revision disposed of a finding, so a rebuild from verdicts
// yields every finding as `open`, plus the dispositions given as an explicit input (the disposition
// record on the PR surfaces, the plan's `### Finding traceability` table on the plan surface).

export const SURFACES = ["specs", "plan", "review"] as const;
export type Surface = (typeof SURFACES)[number];
export const CLASSES = ["tech", "arch", "spec"] as const;
export const STATUSES = ["open", "addressed", "superseded", "withdrawn", "ledger"] as const;
export type Status = (typeof STATUSES)[number];

export interface Finding {
  id: string;
  class: string;
  blocking: boolean;
  status: Status;
  revision: string;
  ref: string;
}

export interface Ledger {
  seat: string;
  examined: string;
  rev: number;
  findings: Finding[];
}

export interface VerdictFinding {
  id: string;
  class: string;
  blocking: boolean;
  revision: string;
}

export interface Verdict {
  seat: string;
  void: boolean;
  revision: string | null;
  findings: VerdictFinding[];
}

export interface Disposition {
  id: string;
  status: Status;
  ref?: string;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const SEAT_RE = /^(specs|plan|review)\/\d+(?:#\d+)?$/;
const ID_RE = /^([vsi])\d+-F\d+[A-Za-z0-9._-]*$/;
const PREFIX: Record<Surface, string> = { plan: "v", specs: "s", review: "i" };

export function surfaceOf(seat: string): Surface {
  return seat.split("/")[0] as Surface;
}

function checkId(id: string, seat: string, where: string): void {
  const m = ID_RE.exec(id);
  if (!m) throw new LedgerError(`${where}: malformed finding id '${id}'`);
  if (PREFIX[surfaceOf(seat)] !== m[1])
    throw new LedgerError(`${where}: id '${id}' does not belong to surface '${surfaceOf(seat)}'`);
}

export function parseLedger(text: string): Ledger {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const head = (i: number, key: string): string => {
    const line = lines[i] ?? "";
    if (!line.startsWith(`${key}: `))
      throw new LedgerError(`line ${i + 1}: expected '${key}: ...'`);
    return line.slice(key.length + 2).trim();
  };
  const seat = head(0, "ledger");
  if (!SEAT_RE.test(seat)) throw new LedgerError(`line 1: malformed seat '${seat}'`);
  const examined = head(1, "examined");
  if (examined === "") throw new LedgerError("line 2: empty examined revision");
  const revText = head(2, "rev");
  if (!/^\d+$/.test(revText)) throw new LedgerError(`line 3: malformed rev '${revText}'`);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (let i = 3; i < lines.length; i++) {
    const where = `line ${i + 1}`;
    const line = lines[i] as string;
    if (!line.startsWith("- ")) throw new LedgerError(`${where}: malformed line`);
    const cells = line
      .slice(2)
      .split("|")
      .map((c) => c.trim());
    if (cells.length !== 6) throw new LedgerError(`${where}: malformed line (6 fields expected)`);
    const [id, cls, blocking, status, revision, ref] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    checkId(id, seat, where);
    if (!(CLASSES as readonly string[]).includes(cls))
      throw new LedgerError(`${where}: malformed class '${cls}'`);
    if (blocking !== "yes" && blocking !== "no")
      throw new LedgerError(`${where}: malformed blocking '${blocking}'`);
    if (!(STATUSES as readonly string[]).includes(status))
      throw new LedgerError(`${where}: malformed status '${status}'`);
    if (revision === "") throw new LedgerError(`${where}: empty revision`);
    if (seen.has(id)) throw new LedgerError(`${where}: duplicate id '${id}'`);
    seen.add(id);
    findings.push({
      id,
      class: cls,
      blocking: blocking === "yes",
      status: status as Status,
      revision,
      ref,
    });
  }
  return { seat, examined, rev: Number(revText), findings };
}

export function formatLedger(ledger: Ledger): string {
  const head = `ledger: ${ledger.seat}\nexamined: ${ledger.examined}\nrev: ${ledger.rev}\n`;
  const body = ledger.findings.map(
    (f) =>
      `- ${f.id} | ${f.class} | ${f.blocking ? "yes" : "no"} | ${f.status} | ${f.revision} | ${f.ref}\n`,
  );
  return head + body.join("");
}

export function parseVerdict(text: string): Verdict {
  const lines = text.split("\n");
  let seat = "";
  let isVoid = false;
  let revision: string | null = null;
  const findings: VerdictFinding[] = [];
  let cur: { id: string; class?: string; blocking?: boolean } | null = null;
  const flush = (): void => {
    if (!cur) return;
    if (!cur.class) throw new LedgerError(`finding ${cur.id} has no class: line`);
    findings.push({ id: cur.id, class: cur.class, blocking: cur.blocking ?? true, revision: "" });
    cur = null;
  };
  for (const line of lines) {
    const seatM = /^seat: (\S+)(.*)$/.exec(line);
    if (seatM && seat === "") {
      seat = seatM[1] as string;
      isVoid = /\bVOID\b/.test(seatM[2] as string);
      continue;
    }
    const titleM = /^## .*review of (\S+)/.exec(line);
    if (titleM && revision === null) revision = (titleM[1] as string).replace(/[^\w.-]+$/, "");
    const revM = /^(?:examined|revision): (\S+)\s*$/.exec(line);
    if (revM && !cur) revision = revM[1] as string;
    const fM = /^\*\*Finding \d+ \(([^)]+)\)\*\*\s*$/.exec(line);
    if (fM) {
      flush();
      cur = { id: fM[1] as string };
      continue;
    }
    if (cur) {
      const c = /^class: (\S+)\s*$/.exec(line);
      if (c) cur.class = c[1];
      const b = /^blocking: (yes|no)\s*$/.exec(line);
      if (b) cur.blocking = b[1] === "yes";
    }
  }
  flush();
  if (seat === "") throw new LedgerError("verdict has no seat: line");
  if (!SEAT_RE.test(seat)) throw new LedgerError(`malformed seat '${seat}'`);
  const seen = new Set<string>();
  for (const f of findings) {
    checkId(f.id, seat, "verdict");
    if (!(CLASSES as readonly string[]).includes(f.class))
      throw new LedgerError(`verdict: malformed class '${f.class}' on ${f.id}`);
    if (seen.has(f.id)) throw new LedgerError(`verdict: duplicate id '${f.id}'`);
    seen.add(f.id);
    f.revision = revision ?? (f.id.startsWith("v") ? `v${/^v(\d+)/.exec(f.id)?.[1]}` : "");
  }
  return { seat, void: isVoid, revision, findings };
}

function sortKey(id: string): (string | number)[] {
  return id
    .split(/(\d+)/)
    .filter((s) => s !== "")
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

export function compareIds(a: string, b: string): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    const x = ka[i] as string | number;
    const y = kb[i] as string | number;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return ka.length - kb.length;
}

/** The finding set held by the ledger alone (R-F1), sorted by id. */
export function reconstructFromLedger(ledger: Ledger | string): Finding[] {
  const l = typeof ledger === "string" ? parseLedger(ledger) : ledger;
  return [...l.findings].sort((a, b) => compareIds(a.id, b.id));
}

/**
 * The finding set of a full read of the seat's verdicts: voided passes are dropped, every
 * finding is `open`, dispositions are an explicit input. Sorted by id.
 */
export function rebuildFromVerdicts(
  verdicts: readonly Verdict[],
  dispositions: readonly Disposition[] = [],
): Finding[] {
  const byId = new Map<string, Disposition>(dispositions.map((d) => [d.id, d]));
  const out = new Map<string, Finding>();
  for (const v of verdicts) {
    if (v.void) continue;
    for (const f of v.findings) {
      if (out.has(f.id)) throw new LedgerError(`duplicate id '${f.id}' across verdicts`);
      const d = byId.get(f.id);
      out.set(f.id, {
        id: f.id,
        class: f.class,
        blocking: f.blocking,
        status: d?.status ?? "open",
        revision: f.revision,
        ref: d?.ref ?? "-",
      });
    }
  }
  return [...out.values()].sort((a, b) => compareIds(a.id, b.id));
}

/** Earlier of two revisions. `order` lists revisions oldest first; else both must be `v<N>`/`<N>`. */
export function earlierRevision(a: string, b: string, order?: readonly string[]): string {
  if (a === b) return a;
  if (order) {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia < 0 || ib < 0) throw new LedgerError(`revision not in the given order: ${a}, ${b}`);
    return ia <= ib ? a : b;
  }
  const na = /^v?(\d+)$/.exec(a);
  const nb = /^v?(\d+)$/.exec(b);
  if (!na || !nb)
    throw new LedgerError(`revisions '${a}' and '${b}' are not comparable without an order`);
  return Number(na[1]) <= Number(nb[1]) ? a : b;
}
