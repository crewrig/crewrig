// report.ts — the A/B table recorded on issue #1990 (spec 0308 R12). Only `pass`, `fail` and
// `invalid` appear as statuses; a truncation shows as an `invalid` cell with its subtype note.

import type { RunRecord, ScenarioVerdict } from "./compare.ts";

export interface ReportInput {
  records: RunRecord[];
  verdicts: Record<number, ScenarioVerdict>;
  spent: number;
  cap: number;
  stopped: { reason: string } | null;
}

const usd = (n: number): string => n.toFixed(2);

export function renderReport(r: ReportInput): string {
  const out: string[] = ["# Rules-split A/B report", ""];
  if (r.stopped) {
    out.push(
      `**Run stopped:** ${r.stopped.reason}. The coordinator must approve before the runner continues.`,
      "",
    );
  }
  out.push(
    "| Scenario | Arm | Run | Status | Attempts (status, subtype, cost USD) | First-call tokens |",
    "|---|---|---|---|---|---|",
  );
  const sorted = [...r.records].sort(
    (x, y) => x.scenario - y.scenario || x.runIndex - y.runIndex || x.arm.localeCompare(y.arm),
  );
  for (const rec of sorted) {
    const att = rec.attempts
      .map(
        (a) =>
          `${a.status}${a.subtype && a.subtype !== "success" ? ` ${a.subtype}` : ""} ${usd(a.charged)}`,
      )
      .join("; ");
    const last = rec.attempts[rec.attempts.length - 1];
    const note = rec.truncatedTwice ? " (truncated twice)" : "";
    out.push(
      `| ${rec.scenario} | ${rec.arm} | ${rec.runIndex} | ${rec.status}${note} | ${att} | ${last?.firstCallTokens ?? ""} |`,
    );
  }
  out.push(
    "",
    "## Cost and first-call tokens per scenario and arm",
    "",
    "| Scenario | Arm | Runs | Pass | Fail | Invalid | Cost USD | Mean first-call tokens |",
    "|---|---|---|---|---|---|---|---|",
  );
  const groups = new Map<string, RunRecord[]>();
  for (const rec of sorted) {
    const k = `${rec.scenario}|${rec.arm}`;
    groups.set(k, [...(groups.get(k) ?? []), rec]);
  }
  for (const [k, recs] of groups) {
    const [sc, arm] = k.split("|");
    const cost = recs.reduce((n, x) => n + x.attempts.reduce((m, a) => m + a.charged, 0), 0);
    const toks = recs
      .map((x) => x.attempts[x.attempts.length - 1]?.firstCallTokens)
      .filter((t): t is number => typeof t === "number");
    const mean = toks.length ? Math.round(toks.reduce((a, b) => a + b, 0) / toks.length) : "";
    const n = (s: string) => recs.filter((x) => x.status === s).length;
    out.push(
      `| ${sc} | ${arm} | ${recs.length} | ${n("pass")} | ${n("fail")} | ${n("invalid")} | ${usd(cost)} | ${mean} |`,
    );
  }
  out.push("", "## Verdict per scenario", "", "| Scenario | Verdict |", "|---|---|");
  for (const [id, v] of Object.entries(r.verdicts)) out.push(`| ${id} | ${v.verdict} |`);

  const tokens = (arm: "A" | "B"): number | null => {
    const rec = r.records.find((x) => x.scenario === 2 && x.arm === arm && x.attempts.length > 0);
    return rec?.attempts[rec.attempts.length - 1]?.firstCallTokens ?? null;
  };
  const ta = tokens("A");
  const tb = tokens("B");
  if (ta !== null && tb !== null) {
    out.push(
      "",
      "## Scenario 2 first-call tokens",
      "",
      `Arm A ${ta}, arm B ${tb}, delta ${tb - ta} (B minus A).`,
    );
  }
  out.push("", `## Cost`, "", `Total ${usd(r.spent)} USD of a ${r.cap} USD cap.`, "");
  return out.join("\n");
}
