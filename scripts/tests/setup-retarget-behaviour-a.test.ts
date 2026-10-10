// setup-retarget-behaviour-a.test.ts — the BEHAVIOUR the three Bash suites test-setup-mcp-merge.sh,
// test-setup-catalogue-picker.sh and test-setup-usage-capture-optin.sh used to read off the text of
// the shell setups (spec 0256 requirement 9, PR D2): each case RUNS the TypeScript entry in the golden
// sandbox (`--answer` translated from the fzf table) and asserts on what it wrote and exited with.
// The Bash suites call this file (`node --test --test-name-pattern=<group>`); Linux only, like the
// golden suites. Pins against the unchanged shell: the golden cells operator-mcp-preserved,
// empty-catalogue(-stale-markers), declined-catalogue-pick / catalogue-pick-declined, usage-capture-*
// (setup-golden/<cli>/...), which the shell leg of the golden suites still reproduces. Retired with
// the shell (PR E) except for what is behaviour of the TypeScript entry (it stays).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";
import { OPERATOR, emptyCatalogues, home as seedHome } from "./lib/setup-golden-cases-pins-b2.ts";
import { noMempalace } from "./lib/setup-golden-cases-spec-b2.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import type { Cli, GoldenCase } from "./lib/setup-golden-types.ts";
import type { SetupSandbox } from "./lib/setup-sandbox.ts";
import { CANCEL, hasJq } from "./lib/setup-stubs.ts";

const skip =
  process.platform !== "linux"
    ? "the setup sandbox (systemd, stubs) is exercised on Linux only, like the golden suites"
    : hasJq()
      ? undefined
      : "a real jq is required";

interface Live {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Home files (relative path, text) as the run left them, read just before the sandbox goes. */
  readonly files: ReadonlyMap<string, string>;
}

/** Run `c` on the TypeScript leg; the sandbox home is read when the harness disposes it. */
async function live(c: GoldenCase): Promise<Live> {
  const files = new Map<string, string>();
  const res = await runSetupCase(
    {
      ...c,
      seed: (sb: SetupSandbox) => {
        c.seed?.(sb);
        const dispose = sb.dispose;
        Object.assign(sb, {
          dispose: () => {
            const walk = (dir: string): void => {
              for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name);
                const stat = fs.lstatSync(full);
                if (stat.isDirectory()) walk(full);
                else if (stat.isFile())
                  files.set(path.relative(sb.home, full), fs.readFileSync(full, "utf8"));
              }
            };
            walk(sb.home);
            dispose();
          },
        });
      },
    },
    "ts",
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, files };
}

const facts = (cli: Cli): Map<string, string> => {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const m = new Map(declarationFacts(descriptor));
  assert.ok(m.size > 0, `${cli}: the declaration is not empty (vacuity guard)`);
  return m;
};
/** `<HOME>/x` of a declaration fact to the home-relative `x`. */
const rel = (fact: string | undefined): string => {
  const text = fact ?? "";
  assert.ok(text.startsWith("<HOME>/"), `a <HOME> path, got ${text}`);
  return text.slice("<HOME>/".length);
};
const target = (fact: string | undefined): string => rel(fact?.split(" -> ")[1]);

const MCP_FILE: Partial<Record<Cli, string>> = {
  copilot: ".copilot/mcp-config.json",
  antigravity: ".gemini/config/mcp_config.json",
};

// Pin: golden <cli>/operator-mcp-preserved (copilot, antigravity).
describe("mcp-merge: the operator's non-reserved server survives the real run", { skip }, () => {
  for (const cli of ["copilot", "antigravity"] as const) {
    test(`${cli}: captured before the framework overwrite, merged back, backup kept`, async () => {
      const file = MCP_FILE[cli] ?? "";
      const r = await live({
        id: "operator-mcp-preserved-live",
        cli,
        note: "operator server preserved",
        seed: (sb) => seedHome(sb, file, `${JSON.stringify(OPERATOR, null, 2)}\n`),
      });
      assert.equal(r.status, 0, r.stderr);
      const written: unknown = JSON.parse(r.files.get(file) ?? "null");
      assert.ok(typeof written === "object" && written !== null, `${file} was written`);
      const servers = Reflect.get(written, "mcpServers") as Record<string, unknown>;
      // vacuity: the framework did overwrite the file (its own server is there)...
      assert.ok("mempalace" in servers, "the framework entry is present");
      // ... and the operator's entry came back verbatim (placeholder kept literal).
      assert.deepEqual(servers["operator-tool"], OPERATOR.mcpServers["operator-tool"]);
      assert.ok(
        [...r.files.keys()].some((k) => k.startsWith(`${file}.bak.`)),
        "the pre-run config was backed up",
      );
    });
  }
});

const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

// Pins: golden <cli>/empty-catalogue, <cli>/empty-catalogue-stale-markers, <cli>/declined-catalogue-pick
// (catalogue-pick-declined for claude and gemini).
describe(
  "catalogue-picker: empty, declined and picked categories never abort the run",
  { skip },
  () => {
    for (const cli of CLIS) {
      test(`${cli}: empty team catalogue + declined expertise + picked level`, async () => {
        const f = facts(cli);
        const marker = (c: string): string => rel(f.get(`rules.marker.${c}`));
        const picked = (c: string): string => target(f.get(`rules.selection.${c}`));
        const r = await live({
          id: "picker-live",
          cli,
          note: "empty team, declined expertise, picked level",
          stubs: { fzf: { "config/expertise": CANCEL, "config/level": "JUNIOR" } },
          seed: (sb) => {
            emptyCatalogues(sb);
            // only the level catalogue keeps an entry: the picked one.
            fs.writeFileSync(path.join(sb.repo, "config/level/JUNIOR.md"), "# fixture\n");
            fs.writeFileSync(path.join(sb.repo, "config/expertise/BACKEND-JAVA.md"), "# fixture\n");
            for (const c of ["team", "expertise"]) seedHome(sb, marker(c), "STALE\n");
          },
        });
        assert.equal(r.status, 0, r.stderr); // R2: the skip continues rather than terminates
        assert.match(r.stderr, /No team catalogue entries found/); // R4: empty catalogue, named
        assert.match(r.stderr, /No expertise selected/); // R4: declined pick, named
        assert.ok(r.files.has(marker("level")), "the third category still ran (level marker)");
        assert.equal(r.files.get(marker("level"))?.trim(), "JUNIOR");
        assert.ok(r.files.has(picked("level")), "the level rule was installed");
        assert.ok(!r.files.has(marker("team")), "R3: stale team marker removed");
        assert.ok(!r.files.has(marker("expertise")), "R3: stale expertise marker removed");
        assert.ok(!r.files.has(picked("team")) && !r.files.has(picked("expertise")));
      });
    }
  },
);

const UC_HEADER: Record<string, string> = {
  claude: "Capture token usage for Claude Code?",
  gemini: "Capture token usage for Gemini CLI?",
  copilot: "Capture token usage for Copilot CLI?",
};

// Pins: golden <cli>/usage-capture-{absent-yes,absent-no,installed-*} and copilot/usage-capture-unreadable-hooks.
describe("usage-capture: a step failure does not abort the setup", { skip }, () => {
  test("copilot: an unreadable hooks file is left byte-identical, warned about, and the next step still runs", async () => {
    const f = facts("copilot");
    const hooks = rel(f.get("usage-capture.target"));
    const r = await live({
      id: "uc-unreadable-live",
      cli: "copilot",
      note: "unreadable hooks file",
      stubs: { fzf: { [UC_HEADER["copilot"] ?? ""]: "yes" } },
      seed: (sb) => seedHome(sb, hooks, "not json {\n"),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.files.get(hooks), "not json {\n", "the unreadable file is never rewritten");
    assert.match(r.stderr + r.stdout, /usage|Usage/, "the failure is reported");
    // the step after usage-capture (session-check) ran: the run did not stop at the failure.
    assert.ok(
      r.files.has(".crewrig/hooks/session-check/mempalace-session-check.ts"),
      "the session-check step still ran",
    );
  });
});

// Gap i1-F14 of the review seat: no golden cell covers it (the cell would need regenerating
// byte-identically in both Linux images), so it is asserted here.
describe("usage-capture: enabled with MemPalace absent still runs (R3)", { skip }, () => {
  for (const cli of ["claude", "gemini", "copilot"] as const) {
    test(`${cli}: the capture entry is registered although the MemPalace layer is skipped`, async () => {
      const target_ = rel(facts(cli).get("usage-capture.target"));
      const r = await live({
        id: "uc-no-mempalace-live",
        cli,
        note: "usage capture without MemPalace",
        stubs: { mempalaceMissing: true, fzf: { [UC_HEADER[cli] ?? ""]: "yes" } },
        seed: noMempalace, // python3 and the pipx venv absent: the MemPalace layer is skipped
      });
      assert.equal(r.status, 0, `${r.stdout.slice(-600)}\n${r.stderr}`);
      assert.match(r.files.get(target_) ?? "", /usage-capture\.ts/, `${target_} registers capture`);
      // wired by in-repo absolute path: no copy of usage-capture.sh under any CLI home.
      assert.deepEqual(
        [...r.files.keys()].filter((k) => k.endsWith("usage-capture.sh")),
        [],
      );
    });
  }
});
