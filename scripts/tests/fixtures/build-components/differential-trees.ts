// differential-trees.ts — the source trees of the differential matrix (spec 0250 R33, plan step
// 22): `rich` exercises every emitter, tier, resource rule, symbolic link, provenance carrier,
// profile and organisation mapping the build knows; the small trees isolate one behaviour.

import fs from "node:fs";
import path from "node:path";

import { agent, command, CONFIG, orgMapping, skill, source } from "./entry-kit.ts";
import type { Put } from "./differential-kit.ts";
import { REPO } from "./entry-kit.ts";
import { SKILL_FILES, writeSkill } from "./skill-fixture.ts";

const PROV = [
  "metadata:",
  "  provenance:",
  '    canonical: "${CANONICAL_REPO}"',
  '    feedback: "${FEEDBACK_REPO}"',
  "    version: 1.0",
];
const TOOLS = ["claude:", "  allowed-tools:", "    - Read", "    - Bash", "  user-invocable: true"];

/** The committed `model-mappings/` plus an organisation channel for `claude`. */
export function mappings(put: Put, root: string, withOrg = true): void {
  fs.cpSync(path.join(REPO, "model-mappings"), path.join(root, "model-mappings"), {
    recursive: true,
  });
  if (withOrg) put("model-mappings/claude.org.yml", orgMapping("claude"));
}

/** Every emitter, tier and rule at once. */
export function rich(put: Put, root: string): void {
  put("crewrig.config.toml", CONFIG);
  mappings(put, root);
  put(
    "artifacts/core/skills/plain/SKILL.md",
    skill("plain", "Links ../../../../docs/a.md and ../../../../specs/b.md\n", [
      "license: MIT",
      'compatibility: "node"',
      ...TOOLS,
      ...PROV,
    ]),
  );
  writeSkill(path.join(root, "artifacts/core/skills/res"), SKILL_FILES, true);
  put(
    "artifacts/core/skills/folded/SKILL.md",
    source(
      [
        "name: folded",
        "description: >",
        "  first",
        "  second",
        "",
        "  after blank",
        "license: 007",
      ],
      "B\n\n\n",
    ),
  );
  put("artifacts/core/commands/hello.md", command("hello", "Say hello.\n", [...TOOLS, ...PROV]));
  put(
    "artifacts/core/agents/prof/AGENT.md",
    agent("prof", "Profile body.\n", [
      "license: MIT",
      "metadata:",
      "  model:",
      "    intelligence: high",
      "    reasoning: medium",
      "  provenance:",
      '    canonical: "${CANONICAL_REPO}"',
      "    version: 2.0",
    ]),
  );
  put(
    "artifacts/core/agents/bashy/AGENT.md",
    agent("bashy", "Bashy.\n", [
      "compatibility: c",
      "claude:",
      "  allowed-tools:",
      "    - Bash",
      "antigravity:",
      "  enable_mcp_tools: false",
      "  enable_subagent_tools: true",
    ]),
  );
  put("artifacts/library/skills/lib/SKILL.md", skill("lib", "../../../../docs/x.md\n", PROV));
  put(
    "artifacts/library/agents/libag/AGENT.md",
    agent("libag", "L.\n", ["metadata:", "  model:", "    intelligence: medium"]),
  );
  put("artifacts/community/skills/com/SKILL.md", skill("com"));
  put("artifacts/community/commands/ccmd.md", command("ccmd"));
  put(
    "artifacts/org/agents/orgag/AGENT.md",
    agent("orgag", "O.\n", ["metadata:", "  model:", "    intelligence: high"]),
  );
  put("artifacts/README.md", "not a tier\n");
  put("artifacts/.hidden/skills/h/SKILL.md", skill("h"));
  put("elsewhere/linked-skill/SKILL.md", skill("linked-skill"));
  put("elsewhere/linked-agent/AGENT.md", agent("linked-agent"));
  fs.mkdirSync(path.join(root, "artifacts/core/skills"), { recursive: true });
  fs.mkdirSync(path.join(root, "artifacts/core/agents"), { recursive: true });
  fs.symlinkSync(
    "../../../elsewhere/linked-skill",
    path.join(root, "artifacts/core/skills/linked-skill"),
  );
  fs.symlinkSync(
    "../../../elsewhere/linked-agent",
    path.join(root, "artifacts/core/agents/linked-agent"),
  );
}

/** A `core` skill and a `core` command that both install as `probe`. */
export function collision(put: Put): void {
  put("crewrig.config.toml", CONFIG);
  put("artifacts/core/skills/probe/SKILL.md", skill("probe"));
  put("artifacts/core/commands/probe.md", command("probe"));
  put("artifacts/library/skills/other/SKILL.md", skill("other"));
}

/** One ordinary skill and one agent, with the given configuration text (none: no file). */
export function small(config: string | null): (put: Put) => void {
  return (put) => {
    if (config !== null) put("crewrig.config.toml", config);
    put("artifacts/core/skills/s/SKILL.md", skill("s", "B ${CANONICAL_REPO}\n", PROV));
    put("artifacts/core/agents/a/AGENT.md", agent("a"));
  };
}
