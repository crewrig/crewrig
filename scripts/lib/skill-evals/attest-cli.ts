// attest-cli.ts — the attestation check entry logic (spec 0290 R17, R20-R22, R37-R39).
//
// Makes no model call and reads no credential variable. For the skills whose content hash differs
// between the base (BASE_REF, else the preferred remote's main) and the working tree, or that are
// new, decides one status each (attest.ts), prints one line per skill and appends the same lines
// to $GITHUB_STEP_SUMMARY when set. Trust model (R38): the results file is self-declared; this
// check proves freshness, not truth.
//
// Usage: node scripts/skill-evals-attestation.ts [<base-ref>]   (BASE_REF is read when no argument)
// Exit: 0 clean, 1 a blocking outcome (invalid, stale, and no-evals / fail / regression under their
// settings), 2 base ref unresolvable.
// Finding line: `<skill>: <status>[: <reason>]`.

import fs from "node:fs";

import {
  defaultBaseRef,
  ensureBaseResolvable,
  normalizeBaseRef,
  preferredRemote,
  unresolvableBaseLines,
} from "../governance/base-ref.ts";
import { attestSelection, DEFAULT_ATTEST_SETTINGS } from "./attest.ts";
import type { AttestSettings } from "./attest.ts";
import { selectChanged } from "./select.ts";

export interface AttestIo {
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
}

export function attestMain(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
  io: AttestIo,
  settings: AttestSettings = DEFAULT_ATTEST_SETTINGS,
): number {
  const given = normalizeBaseRef(argv[0] ?? env["BASE_REF"] ?? "");
  const baseRef = given !== "" ? given : defaultBaseRef(preferredRemote(repoRoot), repoRoot);
  if (!ensureBaseResolvable(baseRef, repoRoot)) {
    for (const l of unresolvableBaseLines(baseRef)) io.stderr(`${l}\n`);
    return 2;
  }
  const sel = selectChanged(repoRoot, baseRef);
  if ("error" in sel) {
    io.stderr(`${sel.error}\n`);
    return 2;
  }
  if (sel.selections.length === 0) {
    io.stdout("skill-evals-attestation: no skill content changed; nothing to check\n");
    return 0;
  }
  const lines: string[] = [];
  let blocking = false;
  for (const s of sel.selections) {
    const o = attestSelection(s, settings);
    blocking ||= o.blocking;
    lines.push(
      `${o.skill}: ${o.status}${o.status === "pass" ? "" : `: ${o.reason}`}${o.blocking ? " [blocking]" : ""}`,
    );
  }
  const text = `${lines.join("\n")}\n`;
  io.stdout(text);
  const summary = env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") {
    try {
      fs.appendFileSync(
        summary,
        `### skill-evals-attestation\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`,
      );
    } catch {
      // the summary is a convenience; never fail the check on it
    }
  }
  return blocking ? 1 : 0;
}
