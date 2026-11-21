// agent-profile-web-pack-absent.test.ts — spec 0313 R6: the fifteen web and SEO pack components left
// CrewRig for the website repository. None of them may exist as an agent or skill entry under
// artifacts/, extensions/ or the four committed project trees, and the worker and coordinator Claude
// profiles name none of them. A hit fails the check and is reported with its path.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const AGENTS = [
  "accessibility-auditor",
  "accessibility-tester",
  "astro-developer",
  "copywriter",
  "designer",
  "frontend-developer",
  "regression-sentinel",
  "scenario-author",
  "seo-specialist",
  "visual-regression-tester",
  "web-conformity-checker",
];
const SKILLS = ["astro", "copywriting", "frontend", "web-tester"];
const TREES = [".claude", ".gemini", ".github", ".agents"];
const PROFILES = ["worker.settings.json", "coordinator.settings.json"];

const exists = (root: string, rel: string): boolean => fs.existsSync(path.join(root, rel));

// Every directory named agents/ or skills/ below `rel`, node_modules excluded.
const componentDirs = (root: string, rel: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "node_modules") continue;
      const sub = `${dir}/${e.name}`;
      if (e.name === "agents" || e.name === "skills") out.push(sub);
      else walk(sub);
    }
  };
  if (exists(root, rel)) walk(rel);
  return out;
};

/** Returns the repository-relative path of every surviving pack component under `root`. */
export const findPackHits = (root: string): string[] => {
  const hits: string[] = [];
  for (const base of ["artifacts", "extensions"]) {
    for (const dir of componentDirs(root, base)) {
      const names = dir.endsWith("/agents") ? AGENTS : SKILLS;
      for (const n of names) if (exists(root, `${dir}/${n}`)) hits.push(`${dir}/${n}`);
    }
  }
  for (const tree of TREES) {
    for (const n of AGENTS)
      for (const file of [`${n}.md`, `${n}.agent.md`])
        if (exists(root, `${tree}/agents/${file}`)) hits.push(`${tree}/agents/${file}`);
    for (const n of SKILLS)
      if (exists(root, `${tree}/skills/${n}`)) hits.push(`${tree}/skills/${n}`);
  }
  for (const file of PROFILES) {
    const rel = `artifacts/core/claude-profiles/${file}`;
    if (!exists(root, rel)) continue;
    const profile = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as {
      permissions?: { deny?: string[] };
      skillOverrides?: Record<string, unknown>;
    };
    for (const d of profile.permissions?.deny ?? []) {
      const name = /^Agent\((.+)\)$/.exec(d)?.[1];
      if (name !== undefined && AGENTS.includes(name)) hits.push(`${rel}: ${d}`);
    }
    for (const key of Object.keys(profile.skillOverrides ?? {}))
      if (SKILLS.includes(key)) hits.push(`${rel}: skillOverrides.${key}`);
  }
  return hits;
};

describe("spec 0313 R6 — the web and SEO pack is absent from CrewRig", () => {
  test("no pack component exists in a source tree, a committed tree or a profile", () => {
    assert.deepEqual(findPackHits(REPO), [], "pack component found (path listed above)");
  });

  test("the check detects a surviving component and names its path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-pack-absent-"));
    try {
      const put = (rel: string, content = ""): void => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
      };
      put("artifacts/library/agents/copywriter/AGENT.md");
      put("artifacts/core/skills/astro/SKILL.md");
      put("extensions/org/agents/seo-specialist/AGENT.md");
      put(".claude/agents/designer.md");
      put(".github/agents/designer.agent.md");
      put(".agents/skills/web-tester/SKILL.md");
      put(
        "artifacts/core/claude-profiles/worker.settings.json",
        JSON.stringify({
          permissions: { deny: ["Agent(designer)", "Artifact"] },
          skillOverrides: { frontend: "off" },
        }),
      );
      assert.deepEqual(findPackHits(root).sort(), [
        ".agents/skills/web-tester",
        ".claude/agents/designer.md",
        ".github/agents/designer.agent.md",
        "artifacts/core/claude-profiles/worker.settings.json: Agent(designer)",
        "artifacts/core/claude-profiles/worker.settings.json: skillOverrides.frontend",
        "artifacts/core/skills/astro",
        "artifacts/library/agents/copywriter",
        "extensions/org/agents/seo-specialist",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an empty tree passes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-pack-absent-"));
    try {
      assert.deepEqual(findPackHits(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
