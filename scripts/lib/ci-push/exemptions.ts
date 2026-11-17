// exemptions.ts — the push-on-main exemption list of the R6 wiring test (spec 0309 delta-02 R6
// exemption list and wiring test (f)): ci/push-main-exemptions.txt, one `kind<TAB>id<TAB>reason` line
// per entry.
//
// Usage: parseExemptions(text) -> {entries, problems}; checkExemptions(entries, facts) -> problems;
// formatExemptions(entries) -> the lines the test prints. Every problem is one line naming the entry.

export type ExemptionKind = "no-push" | "side-effect";

export interface Exemption {
  kind: ExemptionKind;
  id: string;
  reason: string;
  line: number;
}

export const EXEMPTION_FILE = "ci/push-main-exemptions.txt";

export function parseExemptions(text: string): { entries: Exemption[]; problems: string[] } {
  const entries: Exemption[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) return;
    const [kind = "", id = "", ...rest] = line.split("\t");
    const reason = rest.join("\t").trim();
    const where = `${EXEMPTION_FILE}:${i + 1}`;
    if (kind !== "no-push" && kind !== "side-effect") {
      problems.push(`${where}: unknown kind '${kind}' (no-push or side-effect)`);
      return;
    }
    if (id.trim() === "") {
      problems.push(`${where}: an entry with no id`);
      return;
    }
    if (reason === "") problems.push(`${where}: entry '${id}' has an empty reason`);
    if (seen.has(id)) problems.push(`${where}: entry '${id}' is listed twice`);
    seen.add(id);
    entries.push({ kind, id: id.trim(), reason, line: i + 1 });
  });
  return { entries, problems };
}

export function formatExemptions(entries: Exemption[]): string[] {
  return entries.map((e) => `${e.kind}\t${e.id}\t${e.reason}`);
}

export interface ExemptionFacts {
  /** Every capability id of the reference. */
  capabilities: Set<string>;
  /** Workflow files (`.github/workflows/x.yml`) and job ids an entry may name. */
  otherIds: Set<string>;
  /** Capabilities with a `push` trigger on `main`, filtered or not. */
  withPush: Set<string>;
  /** Capabilities with an unfiltered `push` trigger on `main`. */
  unfilteredPush: Set<string>;
  /** The tests and check scripts the task closure of a capability reaches. */
  reached: (id: string) => string[];
}

/** Wiring test (f): the stale, unlisted, reasonless, nonexistent and verifying entries. */
export function checkExemptions(entries: Exemption[], facts: ExemptionFacts): string[] {
  const problems: string[] = [];
  const listed = new Set(entries.map((e) => e.id));
  for (const e of entries) {
    const who = `exemption '${e.id}' (${e.kind})`;
    if (e.reason === "") problems.push(`${who}: empty reason`);
    const isCap = facts.capabilities.has(e.id);
    if (!isCap && !facts.otherIds.has(e.id)) {
      problems.push(`${who}: names no capability, workflow file or job (stale)`);
      continue;
    }
    if (facts.unfilteredPush.has(e.id))
      problems.push(`${who}: stale, the capability has an unfiltered push trigger on main`);
    else if (e.kind === "no-push" && facts.withPush.has(e.id))
      problems.push(`${who}: the capability has a push trigger on main, so it is not 'no-push'`);
    if (e.kind === "side-effect" && isCap) {
      const hit = facts.reached(e.id);
      if (hit.length > 0)
        problems.push(
          `${who}: runs a test or a check, it cannot be a side-effect (reaches ${hit.join(", ")})`,
        );
    }
  }
  for (const id of facts.capabilities)
    if (!facts.unfilteredPush.has(id) && !listed.has(id))
      problems.push(
        `capability '${id}': no unfiltered push trigger on main and no exemption entry (unlisted)`,
      );
  return problems;
}
