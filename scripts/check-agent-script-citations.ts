// check-agent-script-citations.ts — fails when an agent body cites a `scripts/...` path outside a
// crewrig-repo-only fence (issue #1863, extending spec 0289 R1/R2 from skill bodies to agent bodies).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-agent-script-citations.ts
// `CREWRIG_REPO_DIR` overrides the repository root (default: this repository).
//
// Exit: 0 clean, 1 findings.
// Finding lines (stdout): `FAIL <file>:<line>: <message>`.

import path from "node:path";
import { agentBodies, findAgentCitations } from "./lib/governance/agent-script-citations.ts";
import { fail, ok } from "./lib/governance/report.ts";
import { repoRootFrom } from "./lib/paths.ts";

const envRoot = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envRoot !== undefined && envRoot !== "" ? envRoot : path.resolve(repoRootFrom(import.meta.url));

const findings = findAgentCitations(repoDir);
if (findings.length === 0) {
  ok(`OK: no unfenced script citation in ${agentBodies(repoDir).length} agent bodies`);
} else {
  fail(findings.map((f) => `FAIL ${f.file}:${f.line}: ${f.message}`).join("\n"));
  process.exitCode = 1;
}
