// manage-main.test.ts — tests of scripts/lib/manage/main.ts, the shared body of the four
// manage-*-component.sh scripts (spec 0255 R6, R7, R12, R22(i)). Every case runs over a sandbox
// repository and HOME; the staging rebuild is a stand-in and nothing touches the real HOME.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { ANTIGRAVITY, CLAUDE, COPILOT, GEMINI } from "../lib/manage/descriptors.ts";
import { usageLines } from "../lib/manage/main.ts";
import type { CliDescriptor } from "../lib/manage/types.ts";
import { disposeBoxes, write } from "./lib/overlay-loop-box.ts";
import { run, stage, warning } from "./lib/manage-main-run.ts";
import type { Run } from "./lib/manage-main-run.ts";

after(disposeBoxes);

describe("usage and unknown type", () => {
  const typesLines: [CliDescriptor, string][] = [
    [CLAUDE, "claude-skills, policies, mcp-servers"],
    [COPILOT, "skills, commands, mcp-servers"],
    [ANTIGRAVITY, "antigravity-skills, policies, mcp-servers"],
    [GEMINI, "commands, skills, hooks, agents, policies, mcp-servers, themes"],
  ];

  test("no type prints the bare-script Usage line and Types, exit 1", async () => {
    for (const [cli, types] of typesLines) {
      for (const argv of [[], ["install"], ["link", ""]]) {
        const r = await run(cli, argv);
        assert.equal(r.status, 1, cli.cli);
        assert.deepEqual(
          r.out,
          [`Usage: ${cli.script} <install|link> <type> [name]`, `Types: ${types}`],
          cli.cli,
        );
        assert.deepEqual(r.err, [], cli.cli);
      }
    }
    assert.deepEqual(usageLines(CLAUDE), [
      "Usage: manage-claude-component.sh <install|link> <type> [name]",
      "Types: claude-skills, policies, mcp-servers",
    ]);
  });

  test("an unknown type prints the error on standard output; only three list Types", async () => {
    for (const [cli, types] of typesLines) {
      const r = await run(cli, ["install", "nope"]);
      assert.equal(r.status, 1, cli.cli);
      const expected =
        cli === GEMINI
          ? ["Error: unknown component type 'nope'"]
          : ["Error: unknown type 'nope'", `Types: ${types}`];
      assert.deepEqual(r.out, expected, cli.cli);
    }
  });

  test("the usage check precedes the link warning", async () => {
    const r = await run(CLAUDE, ["link"]);
    assert.equal(r.status, 1);
    assert.equal(r.out.length, 2);
  });
});

describe("normalisation and placement", () => {
  test("a singular alias reaches the plural type, in every CLI", async () => {
    const policy = (repo: string): void =>
      write(path.join(repo, "artifacts/community/policies/p.md"), "rule\n");
    const r1 = await run(CLAUDE, ["install", "policy"], { prepare: policy });
    assert.deepEqual([r1.status, r1.out], [0, ["  Copied: p.md"]]);
    assert.ok(fs.existsSync(path.join(r1.home, ".claude/rules/p.md")));

    const r2 = await run(COPILOT, ["install", "skill", "s"], {
      prepare: (repo) => stage(repo, COPILOT, "s"),
    });
    assert.deepEqual([r2.status, r2.out], [0, ["  Copied: s"]]);
    assert.ok(fs.existsSync(path.join(r2.home, ".copilot/skills/s/SKILL.md")));

    const r3 = await run(GEMINI, ["install", "hook"], {
      prepare: (repo) => write(path.join(repo, "artifacts/library/hooks/h"), "x"),
    });
    assert.deepEqual([r3.status, r3.out], [0, ["  Copied: h"]]);
    assert.ok(fs.existsSync(path.join(r3.home, ".gemini/hooks/h")));
  });

  test("the mode defaults to install, and an unknown mode word installs too", async () => {
    const prepare = (repo: string): void => stage(repo, CLAUDE, "alpha");
    for (const argv of [
      ["", "claude-skills", "alpha"],
      ["copy", "claude-skills", "alpha"],
    ]) {
      const r = await run(CLAUDE, argv, { prepare });
      assert.deepEqual([r.status, r.out], [0, ["  Copied: alpha"]], argv[0]);
      assert.ok(!fs.lstatSync(path.join(r.home, ".claude/skills/alpha")).isSymbolicLink());
    }
  });

  test("install-all in link mode prints the warning, then exact Linked lines", async () => {
    const r = await run(CLAUDE, ["link", "claude-skills"], {
      answer: "y",
      prepare: (repo) => {
        stage(repo, CLAUDE, "beta");
        stage(repo, CLAUDE, "alpha");
      },
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.out, [...warning(CLAUDE), "", "  Linked: alpha", "  Linked: beta"]);
    assert.deepEqual(r.err, []);
    assert.ok(fs.lstatSync(path.join(r.home, ".claude/skills/alpha")).isSymbolicLink());
  });
});

describe("link-mode prompt", () => {
  const asking: CliDescriptor[] = [CLAUDE, COPILOT, ANTIGRAVITY];
  const prepare = (cli: CliDescriptor) => (repo: string) => stage(repo, cli, "alpha");
  const typeOf = (cli: CliDescriptor): string => (cli === COPILOT ? "skills" : `${cli.cli}-skills`);
  const placed = (r: Run, cli: CliDescriptor): boolean => {
    const dir = cli === ANTIGRAVITY ? ".gemini/config/skills" : `.${cli.cli}/skills`;
    return fs.existsSync(path.join(r.home, dir, "alpha"));
  };

  test("y and Y continue", async () => {
    for (const cli of asking) {
      for (const answer of ["y", "Y"]) {
        const r = await run(cli, ["link", typeOf(cli), "alpha"], { answer, prepare: prepare(cli) });
        assert.equal(r.status, 0, `${cli.cli} ${answer}`);
        assert.deepEqual(r.out, [...warning(cli), "", "  Linked: alpha"], cli.cli);
        assert.ok(placed(r, cli), cli.cli);
      }
    }
  });

  test("n, any other key and end of input stop with exit 1 and nothing more", async () => {
    for (const cli of asking) {
      for (const answer of ["n", "x", "e", undefined]) {
        const r = await run(cli, ["link", typeOf(cli), "alpha"], { answer, prepare: prepare(cli) });
        assert.equal(r.status, 1, `${cli.cli} ${String(answer)}`);
        assert.deepEqual(r.out, [...warning(cli), ""], cli.cli);
        assert.deepEqual(r.err, []);
        assert.ok(!placed(r, cli), cli.cli);
      }
    }
  });

  test("workspace prints the warning and never reads standard input", async () => {
    let touched = false;
    const stdin = {
      on: () => (touched = true),
      removeListener: () => (touched = true),
      resume: () => (touched = true),
      pause: () => (touched = true),
    };
    const r = await run(GEMINI, ["link", "hooks", "h"], {
      prepare: (repo) => write(path.join(repo, "artifacts/library/hooks/h"), "x"),
      ctx: { stdin },
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.out, [...warning(GEMINI), "  Linked: h"]);
    assert.equal(touched, false);
  });
});

describe("fallback notice and statuses", () => {
  const refuse = (): void => {
    throw Object.assign(new Error("refused"), { code: "ENOTSUP" });
  };

  test("a forced refusal gives Copied lines and exactly one notice naming every destination", async () => {
    const r = await run(CLAUDE, ["link", "claude-skills"], {
      answer: "y",
      prepare: (repo) => {
        stage(repo, CLAUDE, "alpha");
        stage(repo, CLAUDE, "beta");
      },
      ctx: { linkOptions: { symlinkImpl: refuse } },
    });
    assert.equal(r.status, 0);
    assert.deepEqual(r.out.slice(-2), ["  Copied: alpha", "  Copied: beta"]);
    assert.equal(r.err.length, 1, "one notice, not one per component");
    const dest = (n: string): string => path.join(r.home, ".claude/skills", n);
    assert.match(r.err[0] ?? "", /^Symbolic links were refused \(ENOTSUP\); these destinations/);
    assert.ok((r.err[0] ?? "").includes(`  ${dest("alpha")}\n  ${dest("beta")}\n`));
    assert.ok(fs.existsSync(path.join(dest("alpha"), "SKILL.md")));
  });

  test("no notice when every link succeeded, or in install mode", async () => {
    const prepare = (repo: string): void => stage(repo, COPILOT, "s");
    const linked = await run(COPILOT, ["link", "skills"], { answer: "y", prepare });
    assert.deepEqual(linked.err, []);
    const copied = await run(COPILOT, ["install", "skills"], {
      prepare,
      ctx: { linkOptions: { symlinkImpl: refuse } },
    });
    assert.deepEqual([copied.status, copied.err], [0, []]);
  });

  test("a failing component sets status 1 and its siblings still install", async () => {
    const r = await run(GEMINI, ["install", "mcp-servers"], {
      prepare: (repo) => {
        const dir = path.join(repo, "artifacts/library/mcp-servers");
        write(path.join(dir, "a.json"), '{"command":"x"}\n');
        write(path.join(dir, "b.txt"), "not json\n");
        write(path.join(dir, "c.json"), '{"command":"y"}\n');
      },
    });
    assert.equal(r.status, 1);
    const bad = path.join(r.repo, "artifacts/library/mcp-servers/b.txt");
    assert.deepEqual(r.err, [`Error: '${bad}' is not a JSON mcp-servers declaration.`]);
    const settings = fs.readFileSync(path.join(r.home, ".gemini/settings.json"), "utf8");
    assert.ok(settings.includes('"a"') && settings.includes('"c"'), settings);
  });

  test("an aborting status stops the run at the first component", async () => {
    const r = await run(CLAUDE, ["install", "mcp-servers"], {
      prepare: (repo) => {
        const dir = path.join(repo, "artifacts/library/mcp-servers");
        write(path.join(dir, "a.json"), '{"command":"x"}\n');
        write(path.join(dir, "b.json"), '{"command":"y"}\n');
      },
      ctx: {
        claude: {
          env: { PATH: "" },
          platform: process.platform,
          spawn: () => ({ status: 0, stdout: "" }),
        },
      },
    });
    assert.equal(r.status, 1);
    assert.deepEqual(r.out, ["Error: 'claude' CLI required to register MCP servers."]);
  });

  test("an unresolved name returns 1 and Copilot agents are refused on standard error", async () => {
    const ghost = await run(CLAUDE, ["install", "claude-skills", "ghost"]);
    assert.equal(ghost.status, 1);
    assert.match(ghost.raw.join(""), /no component named 'ghost'/);
    const agents = await run(COPILOT, ["install", "agent"]);
    assert.equal(agents.status, 1);
    assert.deepEqual(agents.out, []);
    assert.match(agents.err[0] ?? "", /^Error: this command installs no Copilot agent\./);
  });
});
