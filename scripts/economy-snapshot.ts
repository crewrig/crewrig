// economy-snapshot.ts — reduces the real comment set of a closed ticket to the committed
// manifest consumed by scripts/lib/economy-transform.ts (spec 0275 R-H2).
//
// Usage:
//   gh api repos/crewrig/crewrig/issues/1410/comments --paginate > comments.json
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/economy-snapshot.ts comments.json \
//     > scripts/tests/fixtures/economy-1410/manifest.json
//
// The manifest keeps, per comment and in forge order: id, real UTF-8 byte size, title line, its
// byte size, kind, and per `### ` section its heading, real byte size and sha256 (a section is
// "unchanged" between plan versions when its hash is equal). Verdicts also keep their parsed
// findings (id, class, blocking) and void flag. Bodies are not committed: only sizes and hashes.
// Pure function of the input; no network.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parseVerdict } from "./lib/seat-ledger.ts";

export interface SnapshotSection {
  heading: string;
  bytes: number;
  sha256: string;
}

export interface SnapshotComment {
  id: number;
  bytes: number;
  title: string;
  titleBytes: number;
  kind: "logbook" | "plan" | "verdict" | "other";
  planVersion?: number;
  seat?: string;
  void?: boolean;
  revision?: string | null;
  findings?: { id: string; class: string; blocking: boolean }[];
  sections: SnapshotSection[];
}

export interface Manifest {
  source: string;
  comments: SnapshotComment[];
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

function sectionsOf(body: string): SnapshotSection[] {
  const out: SnapshotSection[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join("\n");
    if (heading !== "" || text !== "") out.push({ heading, bytes: bytes(text), sha256: sha(text) });
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("### ")) {
      flush();
      heading = line.slice(4).trim();
      buf = [line];
    } else buf.push(line);
  }
  flush();
  return out;
}

export function snapshot(source: string, raw: { id: number; body: string }[]): Manifest {
  const comments = raw.map((c): SnapshotComment => {
    const title = c.body.split("\n")[0] as string;
    const base = {
      id: c.id,
      bytes: bytes(c.body),
      title,
      titleBytes: bytes(title) + 1,
      sections: sectionsOf(c.body),
    };
    if (title.startsWith("## Logbook")) return { ...base, kind: "logbook" };
    const plan = /^## PLAN v(\d+)\b/.exec(title);
    if (plan) return { ...base, kind: "plan", planVersion: Number(plan[1]) };
    if (title.startsWith("## PLAN — ")) return { ...base, kind: "plan", planVersion: 1 };
    if (/^## PLAN review of v\d+/.test(title)) {
      const v = parseVerdict(c.body);
      return {
        ...base,
        kind: "verdict",
        seat: v.seat,
        void: v.void,
        revision: v.revision,
        findings: v.findings.map((f) => ({ id: f.id, class: f.class, blocking: f.blocking })),
      };
    }
    return { ...base, kind: "other" };
  });
  return { source, comments };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2];
  if (!input) {
    process.stderr.write("usage: economy-snapshot.ts <comments.json>\n");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(input, "utf8")) as { id: number; body: string }[];
  process.stdout.write(
    `${JSON.stringify(snapshot("crewrig/crewrig#1410 issue comments (gh api, closed ticket)", raw), null, 1)}\n`,
  );
}
