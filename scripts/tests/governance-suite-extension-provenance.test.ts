// governance-suite-extension-provenance.test.ts — Replaces scripts/tests/test-check-extension-provenance.sh
// (Part A; Part B is governance-suite-extension-provenance-r4.test.ts). Pins spec 0043: every
// skill/agent under an upstream-owned extension tier carries a complete, self-routing carrier
// as its first body line. The guard walks extensions/{core,library} from the CWD (org exempt).
// Spec 0265 P5. The twins (Case 5 carrier-less agent, Case 6 same tree under core) make the
// pass cases non-vacuous.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-extension-provenance.ts");
const CANON = "https://github.com/crewrig/crewrig";
const COMPLETE = `<!-- crewrig-provenance: version="1.0.0" canonical="${CANON}" feedback="${CANON}" -->`;

type Files = Record<string, string>;

function skill(carrier: string, tail = ["", "# X Skill", "", "Body."]): string {
  const head = ["---", "name: x", 'description: "A skill"', "---"];
  return [...head, ...(carrier === "" ? [] : [carrier]), ...tail].join("\n") + "\n";
}

function agent(carrier: string): string {
  const head = ["---", "name: a", 'description: "An agent"', "---"];
  return [...head, ...(carrier === "" ? [] : [carrier]), "", "System prompt."].join("\n") + "\n";
}

const S = "extensions/core/demo/skills/x/SKILL.md";
const AGENT_LIB = "extensions/library/demo/agents/a/AGENT.md";
const AGENT_LIB_B = "extensions/library/demo/agents/b/AGENT.md";
const ORG = "extensions/org/demo/skills/x/SKILL.md";

interface Case {
  readonly label: string;
  readonly files: Files;
  readonly dirs?: readonly string[];
  readonly status: 0 | 1;
  readonly stdout: readonly (string | RegExp)[];
}

const cases: readonly Case[] = [
  {
    label: "Case 1 - skill with complete carrier passes",
    files: { [S]: skill(COMPLETE) },
    status: 0,
    stdout: [`  OK   ${S}`, "OK: 1 upstream-owned extension skill/agent(s) carry a complete"],
  },
  {
    label: "Case 2 - skill missing carrier fails (R7)",
    files: { [S]: skill("") },
    status: 1,
    stdout: [`  FAIL ${S} — missing crewrig-provenance carrier on first body line (R7)`],
  },
  {
    label: "Case 3 - feedback != canonical fails (R5)",
    files: {
      [S]: skill(
        `<!-- crewrig-provenance: version="1.0.0" canonical="${CANON}" feedback="https://github.com/other/fork" -->`,
      ),
    },
    status: 1,
    stdout: [`  FAIL ${S} — feedback 'https://github.com/other/fork' != canonical '${CANON}' (R5)`],
  },
  {
    label: "Case 4 - carrier missing a field fails (R1)",
    files: { [S]: skill(`<!-- crewrig-provenance: version="1.0.0" canonical="${CANON}" -->`) },
    status: 1,
    stdout: [`  FAIL ${S} — provenance carrier missing field(s): feedback (R1)`],
  },
  {
    label: "Case 5 - agent with complete carrier passes (library tier)",
    files: { [AGENT_LIB]: agent(COMPLETE) },
    status: 0,
    stdout: [`  OK   ${AGENT_LIB}`],
  },
  {
    label: "Case 5 twin - carrier-less agent under library fails",
    files: { [AGENT_LIB]: agent(COMPLETE), [AGENT_LIB_B]: agent("") },
    status: 1,
    stdout: [`  OK   ${AGENT_LIB}`, `  FAIL ${AGENT_LIB_B} — missing crewrig-provenance carrier`],
  },
  {
    label: "Case 6 - adopter-owned extensions/org is exempt",
    files: { [ORG]: skill("") },
    dirs: ["extensions/core"],
    status: 0,
    stdout: ["OK: 0 upstream-owned extension skill/agent(s)"],
  },
  {
    label: "Case 6 twin - the same carrier-less skill under core fails",
    files: { [S]: skill("") },
    status: 1,
    stdout: [`  FAIL ${S}`],
  },
  {
    label: "Case 7 - empty extensions tree passes",
    files: {},
    dirs: ["extensions/core"],
    status: 0,
    stdout: ["OK: 0 upstream-owned extension skill/agent(s)"],
  },
  {
    label: "Case 8 - carrier not on first body line fails (R-2 pin)",
    files: { [S]: skill("", ["", "# X Skill", "", COMPLETE, "Body."]) },
    status: 1,
    stdout: [`  FAIL ${S} — missing crewrig-provenance carrier on first body line (R7)`],
  },
];

describe("check-extension-provenance, Part A (presence / routing)", () => {
  it("count sentinel: 8 Bash cases + Case 5 twin + Case 6 twin", () => {
    assert.equal(cases.length, 10);
  });

  for (const c of cases) {
    it(c.label, () => {
      const dir = makeSandbox("ext-provenance-");
      writeTree(dir, c);
      const res = runEntry(ENTRY, { cwd: dir });
      assert.equal(res.status, c.status, `${res.stdout}${res.stderr}`);
      for (const s of c.stdout) assert.ok(res.stdout.includes(String(s)), `${s}\n${res.stdout}`);
      assert.equal(res.stderr, "");
    });
  }
});

function writeTree(dir: string, c: Case): void {
  for (const d of c.dirs ?? []) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const [rel, text] of Object.entries(c.files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}
