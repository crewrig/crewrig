// windows-setup-e2e.ts — the end-to-end "install CrewRig from PowerShell" proof for the Claude entry
// (spec 0256 R34, scenario "Windows user installs from PowerShell with no POSIX shell"): a REAL
// `npm ci --omit=dev --workspaces=false` (npm resolved from node's own directory, no stub), a `claude mcp`
// call recorded by the `.cmd` stub, every question answered with `--answer`, then the assertions on what
// landed under the sandbox home: rules, validation.conf, the MCP registration, the production dependencies.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { answerArgs, CLAUDE_ANSWERS } from "./windows-setup-cases.ts";
import type { Harness } from "./windows-setup-proof.ts";
import { productionClosure } from "./build-fixture-tree.ts";
import { expectStatus, why } from "./windows-proof-support.ts";
import { noCarriageReturn } from "./windows-setup-cases.ts";

export function runE2e(h: Harness): void {
  h.check("install CrewRig from PowerShell (Claude entry, real npm ci)", () => {
    const sb = h.sandbox({ npm: "real" });
    // A Windows-installed Claude registers servers through `claude mcp add`; the stub only records it.
    const answers = CLAUDE_ANSWERS.filter((a) => !a.startsWith("install-seqthink=")).concat(
      "install-seqthink=yes",
    );
    const res = h.run(sb, "claude", answerArgs(answers));
    expectStatus(res, 0);
    assert.match(
      res.out,
      /Production dependencies: running 'npm ci --omit=dev --workspaces=false'/,
      why(res, "the real npm ci did not run"),
    );
    const modules = path.join(sb.repo, "node_modules");
    for (const name of productionClosure())
      assert.ok(
        fs.existsSync(path.join(modules, name)),
        `production dependency ${name} is not installed`,
      );
    assert.ok(
      fs.existsSync(path.join(sb.repo, ".crewrig-state", "production-deps.sha256")),
      "the lockfile stamp is not recorded",
    );
    const files = [...h.landed(sb).keys()];
    assert.ok(
      files.some((f) => f.startsWith(".claude/rules/")),
      `no rules deployed: ${files.join(", ")}`,
    );
    assert.ok(files.includes(".crewrig/validation.conf"), "validation.conf is not written");
    const conf = fs.readFileSync(path.join(sb.home, ".crewrig", "validation.conf"), "utf8");
    assert.match(conf, /^backend=internal$/m, "validation.conf does not hold the answered backend");
    assert.ok(
      h.calls(sb, "claude").some((l) => /^mcp add\b/.test(l)),
      why(res, "no `claude mcp add` call recorded"),
    );
    noCarriageReturn(h, sb);
  });
}
