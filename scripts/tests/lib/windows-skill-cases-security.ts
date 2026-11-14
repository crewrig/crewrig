// windows-skill-cases-security.ts — the additive case of the cross-system proof for the security skill
// (spec 0303 R10, R13). dep-audit.ts is POSIX only: on win32 it exits 3 with a `precondition` finding
// of cause `unsupported-platform`, after the argument check and before any tool is looked up. On any
// other host the direct leg runs a root with no manifest and expects exit 0 with `nothing-to-audit`
// and no tool lookup. security-finding.ts reads a report on every system.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { attempt, exec } from "./windows-skill-proof.ts";
import type { Ctx } from "./windows-skill-proof.ts";
import { expectStatus, why } from "./windows-proof-support.ts";

const SKILLS = path.resolve(import.meta.dirname, "..", "..", "..", "artifacts", "core", "skills");
const SEC = (name: string): string => path.join(SKILLS, "security", "scripts", `${name}.ts`);

export function securityCases(c: Ctx): void {
  const empty = path.join(c.box.work, "sec-empty");
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(path.join(c.box.work, "sec-report.md"), "No findings.\r\nExamined: sec-report.md:1.\r\n");

  attempt(c, "ws-dep-audit-platform", () => {
    const r = exec(c, SEC("dep-audit"), ["--json", "--root", "sec-empty"]);
    const line = r.out.split("\n").filter((l) => l !== "");
    assert.equal(line.length, 1, why(r, "one stdout line"));
    const env = JSON.parse(line[0] as string) as {
      findings: { rule: string; cause?: string; severity?: string }[];
      data: { audited: unknown[] } | null;
    };
    if (process.platform === "win32") {
      expectStatus(r, 3);
      assert.equal(env.findings[0]?.rule, "precondition", why(r, "precondition"));
      assert.equal(env.findings[0]?.cause, "unsupported-platform", why(r, "cause"));
    } else {
      expectStatus(r, 0);
      assert.equal(env.findings[0]?.rule, "nothing-to-audit", why(r, "nothing-to-audit"));
      assert.deepEqual(env.data?.audited, [], why(r, "audited list"));
    }
  });
  attempt(c, "ws-dep-audit-usage", () => {
    // the argument check comes first, on every system
    expectStatus(exec(c, SEC("dep-audit"), ["--ecosystem", "rust"]), 2);
  });
  attempt(c, "ws-security-finding", () => {
    const r = exec(c, SEC("security-finding"), ["sec-report.md"]);
    expectStatus(r, 0);
    assert.equal(r.out, "security-finding: the report is well formed\n", why(r, "stdout"));
  });
}
