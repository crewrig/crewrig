// component-twins-conformance-migrate.test.ts — `migrateAntigravitySupersededComponents`
// (scripts/lib/antigravity-migrate.ts) against `migrate_antigravity_superseded_components`
// (scripts/lib/common.sh), on stdout, stderr, status and the tree left behind (spec 0255, row F2).
// Linux and macOS only: it spawns `bash`, and retires with the shell library (row J4).

import { after, describe, test } from "node:test";

import { migrateAntigravitySupersededComponents } from "../lib/antigravity-migrate.ts";
import {
  cleanup,
  runShell,
  runTwin,
  same,
  SKIP,
  type Layout,
} from "./lib/component-twins-harness.ts";

after(cleanup);

const PROV = ["metadata:", "  provenance:", '    canonical: "https://github.com/crewrig/crewrig"'];
/** A component marker: `name` line optional, provenance block optional, quoted body optional. */
function marker(name: string | null, prov: boolean, body = "Body."): string {
  const fm = ["---", ...(name === null ? [] : [`name: ${name}`]), ...(prov ? PROV : []), "---"];
  return `${fm.join("\n")}\n\n${body}\n`;
}
const QUOTED = '    metadata:\n      provenance:\n        canonical: "https://example.org/x"';

const layout: Layout = {
  // the served names, across the three tiers
  "art/library/skills/alpha/SKILL.md": marker("alpha", true),
  "art/community/skills/beta/SKILL.md": marker('"beta"', true),
  "art/org/skills/gamma/SKILL.md": marker("gamma", true),
  "art/library/agents/ag/AGENT.md": marker("ag", true),
  "art/org/agents/dir-ag/AGENT.md": marker("dir-ag", true),
  // the superseded placement
  "sup/skills/alpha/SKILL.md": marker("alpha", true),
  "sup/skills/alpha/extra/deep.txt": "x",
  "sup/skills/renamed/SKILL.md": marker("beta", true),
  "sup/skills/gamma/SKILL.md": marker(null, true),
  "sup/skills/user-own/SKILL.md": marker("alpha2", false),
  "sup/skills/served-no-prov/SKILL.md": marker("gamma", false),
  "sup/skills/quoted/SKILL.md": marker("quoted", false, QUOTED),
  "sup/skills/org-orphan/SKILL.md": marker("org-orphan", true),
  "sup/skills/no-marker/readme.txt": "x",
  "sup/skills/stray.txt": "x",
  "sup/agents/ag.md": marker("ag", true),
  "sup/agents/dir-ag/AGENT.md": marker(null, true),
  "sup/agents/orphan-agent.md": marker("orphan-agent", true),
  "sup/agents/other.json": "{}",
};

/** Compare the shell call `migrate ... <kind> <names>` with the twin on `lay`. */
function check(lay: Layout, kind: string, names: string[] = []): void {
  const body = `migrate_antigravity_superseded_components "$SB/sup" "$SB/art" ${kind} ${names.join(" ")}`;
  const shell = runShell(lay, `${body}\nexit $?`);
  const twin = runTwin(lay, (s) => {
    const r = migrateAntigravitySupersededComponents(`${s.sb}/sup`, `${s.sb}/art`, kind, names, {
      out: (l) => s.out(`${l}\n`),
      err: (l) => s.err(`${l}\n`),
    });
    return r.status;
  });
  same(shell, twin);
}

describe("migrate_antigravity_superseded_components", { skip: SKIP }, () => {
  test("all kinds: served and provenance removed, user content kept, orphans reported", () =>
    check(layout, "all"));
  test("kind filter: skills only", () => check(layout, "skills"));
  test("kind filter: agents only", () => check(layout, "agents"));
  test("explicit names narrow the sweep, the rest is reported as residue", () =>
    check(layout, "all", ["alpha", "ag"]));
  test("explicit names bypass the served-name read", () =>
    check({ ...layout, "art/library/skills/alpha/SKILL.md": marker(null, true) }, "skills", [
      "alpha",
    ]));
  test("a source directory that yields no name is an error, nothing removed", () =>
    check(
      {
        ...layout,
        "art/library/skills/alpha/SKILL.md": marker(null, true),
        "art/community/skills/beta/SKILL.md": marker(null, true),
        "art/org/skills/gamma/SKILL.md": marker(null, true),
      },
      "skills",
    ));
  test("no superseded placement at all is a clean no-op", () =>
    check({ "art/library/skills/alpha/SKILL.md": marker("alpha", true) }, "all"));
  test("a fork that ships no components of a kind is fine", () =>
    check({ "sup/skills/x/SKILL.md": marker("x", true) }, "skills"));
});
