// manage-overlay-loop.test.ts — tests of scripts/lib/manage/overlay-loop.ts, the twin of the
// per-type dispatch of the four manage-*-component.sh scripts (spec 0255 R5, R6, R7). Every
// case runs over a sandbox repository and HOME (scripts/tests/lib/overlay-loop-box.ts).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import { ANTIGRAVITY, CLAUDE, COPILOT, GEMINI } from "../lib/manage/descriptors.ts";
import { runOverlayLoop } from "../lib/manage/overlay-loop.ts";
import { newPlaceCtx } from "../lib/manage/place.ts";
import { disposeBoxes, newBox, skill, write } from "./lib/overlay-loop-box.ts";
import type { Box } from "./lib/overlay-loop-box.ts";
import type { CliDescriptor } from "../lib/manage/types.ts";

after(disposeBoxes);

const stageClaude = (b: Box, name: string): void =>
  skill(path.join(b.repo, "dist/library/.claude/skills", name, "SKILL.md"), name, true);

describe("place types", () => {
  test("claude-skills: a named placement lands under HOME and prints Copied", () => {
    const b = newBox();
    stageClaude(b, "alpha");
    stageClaude(b, "beta");
    assert.deepEqual(b.run(CLAUDE, "claude-skills", "alpha"), { status: 0, abort: false });
    assert.deepEqual(b.out, ["  Copied: alpha"]);
    assert.ok(fs.existsSync(path.join(b.home, ".claude/skills/alpha/SKILL.md")));
    assert.ok(!fs.existsSync(path.join(b.home, ".claude/skills/beta")));
  });

  test("claude-skills: install-all places every component in name order", () => {
    const b = newBox();
    stageClaude(b, "beta");
    stageClaude(b, "alpha");
    assert.deepEqual(b.run(CLAUDE, "claude-skills"), { status: 0, abort: false });
    assert.deepEqual(b.out, ["  Copied: alpha", "  Copied: beta"]);
  });

  test("link mode prints Linked and the destination is a symlink", () => {
    const b = newBox();
    stageClaude(b, "alpha");
    assert.equal(b.run(CLAUDE, "claude-skills", "alpha", "link").status, 0);
    assert.deepEqual(b.out, ["  Linked: alpha"]);
    assert.ok(fs.lstatSync(path.join(b.home, ".claude/skills/alpha")).isSymbolicLink());
  });

  test("an unresolved name returns status 1, aborts and reports on the raw stream", () => {
    const b = newBox();
    stageClaude(b, "alpha");
    assert.deepEqual(b.run(CLAUDE, "claude-skills", "ghost"), { status: 1, abort: true });
    assert.match(b.raw.join(""), /Error: no component named 'ghost' of type 'claude-skills'/);
    assert.deepEqual(b.out, []);
  });

  test("policies land in the CLI's own directory, resolved from artifacts/", () => {
    const cases: [CliDescriptor, string][] = [
      [CLAUDE, ".claude/rules"],
      [ANTIGRAVITY, ".gemini/antigravity-cli/rules"],
      [GEMINI, ".gemini/policies"],
    ];
    for (const [cli, dest] of cases) {
      const b = newBox();
      write(path.join(b.repo, "artifacts/community/policies/p.md"), "rule\n");
      write(path.join(b.repo, "artifacts/community/policies/.gitkeep"), "");
      assert.deepEqual(b.run(cli, "policies"), { status: 0, abort: false }, cli.cli);
      assert.deepEqual(b.out, ["  Copied: p.md"], cli.cli);
      assert.equal(fs.readFileSync(path.join(b.home, dest, "p.md"), "utf8"), "rule\n", cli.cli);
    }
  });

  test("copilot commands share the skills landing zone and staging root", () => {
    const b = newBox();
    skill(path.join(b.repo, "dist/org/.github/skills/cmd/SKILL.md"), "cmd", true);
    assert.equal(b.run(COPILOT, "commands", "cmd").status, 0);
    assert.ok(fs.existsSync(path.join(b.home, ".copilot/skills/cmd/SKILL.md")));
  });

  test("gemini hooks resolve from artifacts, skills from the staging tree", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/library/hooks/h"), "x");
    skill(path.join(b.repo, "dist/library/.gemini/skills/s/SKILL.md"), "s", true);
    assert.equal(b.run(GEMINI, "hooks", "h").status, 0);
    assert.equal(b.run(GEMINI, "skills", "s").status, 0);
    assert.ok(fs.existsSync(path.join(b.home, ".gemini/hooks/h")));
    assert.ok(fs.existsSync(path.join(b.home, ".gemini/skills/s/SKILL.md")));
  });
});

describe("antigravity superseded migration", () => {
  const superseded = (b: Box, name: string): string =>
    path.join(b.home, ".gemini/antigravity-cli/skills", name, "SKILL.md");
  const stage = (b: Box, name: string): void =>
    skill(path.join(b.repo, "dist/library/.agents/skills", name, "SKILL.md"), name, true);

  test("skills land under the customization root; only placed names are migrated", () => {
    const b = newBox();
    stage(b, "alpha");
    stage(b, "beta");
    skill(superseded(b, "alpha"), "alpha", true);
    skill(superseded(b, "beta"), "beta", true);
    assert.deepEqual(b.run(ANTIGRAVITY, "antigravity-skills", "alpha"), {
      status: 0,
      abort: false,
    });
    assert.ok(fs.existsSync(path.join(b.home, ".gemini/config/skills/alpha/SKILL.md")));
    assert.ok(!fs.existsSync(superseded(b, "alpha")), "the placed name was migrated away");
    assert.ok(fs.existsSync(superseded(b, "beta")), "an unplaced name stays");
    assert.ok(b.out.some((l) => l.startsWith("  Migrated away: ")));
  });

  test("nothing placed means no migration at all", () => {
    const b = newBox();
    fs.mkdirSync(path.join(b.repo, "dist/library/.agents/skills"), { recursive: true });
    skill(superseded(b, "alpha"), "alpha", true);
    assert.deepEqual(b.run(ANTIGRAVITY, "antigravity-skills"), { status: 0, abort: false });
    assert.deepEqual(b.out, []);
    assert.ok(fs.existsSync(superseded(b, "alpha")));
  });

  test("a failed install skips the migration and returns the driver status", () => {
    const b = newBox();
    skill(superseded(b, "alpha"), "alpha", true);
    assert.deepEqual(b.run(ANTIGRAVITY, "antigravity-skills", "alpha"), {
      status: 1,
      abort: true,
    });
    assert.ok(fs.existsSync(superseded(b, "alpha")));
  });
});

describe("mcp types", () => {
  test("copilot: merges a .json declaration and creates the config", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/community/mcp-servers/pw.json"), '{"command":"npx"}');
    assert.deepEqual(b.run(COPILOT, "mcp-servers", "pw"), { status: 0, abort: false });
    assert.deepEqual(b.out, ["  Merged: pw into mcpServers"]);
    const cfg: unknown = JSON.parse(
      fs.readFileSync(path.join(b.home, ".copilot/mcp-config.json"), "utf8"),
    );
    assert.deepEqual(cfg, { mcpServers: { pw: { command: "npx" } } });
    assert.ok(fs.existsSync(path.join(b.home, ".copilot/mcp-config.json.bak")));
  });

  test("antigravity: merges into its own settings.json", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/org/mcp-servers/s.json"), '{"command":"x"}');
    assert.equal(b.run(ANTIGRAVITY, "mcp-servers").status, 0);
    assert.ok(fs.existsSync(path.join(b.home, ".gemini/antigravity-cli/settings.json")));
  });

  test("gemini: themes merge under the themes key, mcp-servers under mcpServers", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/library/themes/dark.json"), '{"name":"dark"}');
    write(path.join(b.repo, "artifacts/library/mcp-servers/m.json"), '{"command":"m"}');
    assert.equal(b.run(GEMINI, "themes").status, 0);
    assert.equal(b.run(GEMINI, "mcp-servers").status, 0);
    assert.deepEqual(b.out, ["  Merged: dark into themes", "  Merged: m into mcpServers"]);
    const cfg: unknown = JSON.parse(
      fs.readFileSync(path.join(b.home, ".gemini/settings.json"), "utf8"),
    );
    assert.deepEqual(cfg, {
      themes: { dark: { name: "dark" } },
      mcpServers: { m: { command: "m" } },
    });
  });

  test("a non-.json declaration is refused per component, the rest still install", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/library/mcp-servers/a.txt"), "x");
    write(path.join(b.repo, "artifacts/library/mcp-servers/b.json"), "{}");
    assert.deepEqual(b.run(COPILOT, "mcp-servers"), { status: 1, abort: true });
    assert.equal(b.err.length, 1);
    assert.match(b.err[0] ?? "", /^Error: '.*a\.txt' is not a JSON MCP declaration\.$/);
    assert.deepEqual(b.out, ["  Merged: b into mcpServers"]);
  });

  test("gemini words the refusal after the type", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/library/themes/a.txt"), "x");
    assert.equal(b.run(GEMINI, "themes", "a.txt").status, 1);
    assert.match(b.err[0] ?? "", /is not a JSON themes declaration\.$/);
  });

  test("a malformed declaration reports an error and returns 1", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/library/mcp-servers/bad.json"), "{nope");
    assert.equal(b.run(COPILOT, "mcp-servers", "bad").status, 1);
    assert.match(b.err[0] ?? "", /^Error: /);
    assert.deepEqual(b.out, []);
  });

  test("claude: registers through the spawn seam with the script's lines", () => {
    const b = newBox();
    write(
      path.join(b.repo, "artifacts/community/mcp-servers/pw.json"),
      '{"command":"npx","args":["-y","pkg"]}',
    );
    assert.deepEqual(b.run(CLAUDE, "mcp-servers", "pw"), { status: 0, abort: false });
    assert.deepEqual(b.out, ["  pw: registered (scope=user)"]);
    assert.deepEqual(b.claudeCalls[1], [
      "mcp",
      "add",
      "--scope",
      "user",
      "pw",
      "--",
      "npx",
      "-y",
      "pkg",
    ]);
  });

  test("claude: a missing 'claude' CLI is the shell's exit 1 and stops the loop", () => {
    const b = newBox();
    write(path.join(b.repo, "artifacts/library/mcp-servers/a.json"), '{"command":"x"}');
    write(path.join(b.repo, "artifacts/library/mcp-servers/b.json"), '{"command":"y"}');
    const io: Io = { out: (l) => b.out.push(l), err: () => {}, errRaw: () => {} };
    const result = runOverlayLoop(
      {
        cli: CLAUDE,
        type: "mcp-servers",
        name: "",
        mode: "install",
        repoDir: b.repo,
        home: b.home,
      },
      {
        io,
        place: newPlaceCtx(io, {}, process.platform),
        claude: {
          env: { PATH: path.join(b.home, "nowhere") },
          platform: process.platform,
          spawn: () => ({ status: 0, stdout: "" }),
        },
      },
    );
    assert.deepEqual(result, { status: 1, abort: true });
    assert.deepEqual(b.out, ["Error: 'claude' CLI required to register MCP servers."]);
  });
});

describe("refused and unknown types", () => {
  test("copilot agents is refused with the five-line error on standard error", () => {
    const b = newBox();
    assert.deepEqual(b.run(COPILOT, "agents", "x"), { status: 1, abort: true });
    assert.equal(b.err.length, 5);
    assert.equal(b.err[0], "Error: this command installs no Copilot agent.");
    assert.deepEqual(b.out, []);
    assert.ok(!fs.existsSync(path.join(b.home, ".copilot")));
  });

  test("an unknown type prints the error and the types line on standard output", () => {
    const b = newBox();
    assert.deepEqual(b.run(CLAUDE, "widgets"), { status: 1, abort: true });
    assert.deepEqual(b.out, [
      "Error: unknown type 'widgets'",
      "Types: claude-skills, policies, mcp-servers",
    ]);
  });

  test("gemini's unknown type has its own wording and no types line", () => {
    const b = newBox();
    assert.equal(b.run(GEMINI, "widgets").status, 1);
    assert.deepEqual(b.out, ["Error: unknown component type 'widgets'"]);
  });
});
