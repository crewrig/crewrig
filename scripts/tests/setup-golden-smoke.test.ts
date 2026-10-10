// setup-golden-smoke.test.ts — each setup runs to completion in the sandbox with the stubs and its
// default answers (spec 0256, plan v2 step A4), through the forwarding shim `scripts/<entry>.sh`
// (the TypeScript entry; the answers are the `--answer` translation of the `default-answers` cell),
// then runs a second time (re-run idempotence).
// Linux only: the golden matrix is generated on ubuntu-latest.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  baseStubs,
  commonTools,
  exposeTools,
  seedMempalaceVenv,
  startChromaHeartbeat,
} from "./lib/setup-golden-common.ts";
import type { Cli } from "./lib/setup-golden-types.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";
import { casesFor } from "./lib/setup-golden-all.ts";
import { translateAnswers } from "./lib/setup-golden-answers.ts";
import { startGoldenDaemon } from "./lib/setup-golden-daemon.ts";
import { createSetupSandbox } from "./lib/setup-sandbox.ts";
import { hasJq, installStubs } from "./lib/setup-stubs.ts";

const skip = process.platform !== "linux" || !hasJq();

// Where each setup writes the rule files, relative to the sandbox home, and how many at least.
const RULES: Record<Cli, { dir: string; match: RegExp; min: number }> = {
  claude: { dir: ".claude/rules", match: /\.md$/, min: 8 },
  gemini: { dir: ".gemini", match: /^\d\d_.*\.md$/, min: 7 },
  copilot: { dir: ".copilot/instructions", match: /\.instructions\.md$/, min: 7 },
  antigravity: { dir: ".gemini/config", match: /\.md$/, min: 1 },
};

// The closing line of each setup, after the "Setup complete" banner.
const LAST: Record<Cli, RegExp> = {
  claude: /^Restart any running Claude Code session/,
  gemini: /^Restart any running Gemini CLI session/,
  copilot: /./,
  antigravity: /^Restart any running Antigravity CLI session/,
};

function lastLine(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines[lines.length - 1] ?? "";
}

describe("setup golden smoke (shim leg, Linux)", { skip }, () => {
  for (const cli of ["claude", "gemini", "copilot", "antigravity"] as const) {
    it(`${cli}: runs to completion twice with the default answers`, async () => {
      const guard = realHomeGuard();
      const cell = casesFor(cli).find((x) => x.id === "default-answers");
      assert.ok(cell !== undefined, `${cli}: no default-answers cell`);
      // The answers of the cell as `runSetupCase` builds it: the CLI's base stubs under the cell's own.
      const base = baseStubs(cli);
      const answers = translateAnswers({
        ...cell,
        stubs: { ...base, ...cell.stubs, fzf: { ...base.fzf, ...cell.stubs?.fzf } },
      });
      const beat = await startChromaHeartbeat();
      const daemon = await startGoldenDaemon({ probe: 0, port: "0" });
      const sb = createSetupSandbox();
      try {
        installStubs(sb.bin, base);
        exposeTools(sb, commonTools);
        seedMempalaceVenv(sb);
        for (const pass of ["first", "second"]) {
          const res = sb.run(`setup-${cli}-interactive`, answers, {
            timeoutMs: 180_000,
            env: {
              MEMPALACE_CHROMA_PORT: String(beat.port),
              MEMPALACE_MCP_PORT: String(daemon.port),
              CREWRIG_TEST_SERVICE_BIN_DIR: sb.bin,
            },
          });
          assert.equal(
            res.status,
            0,
            `${cli} ${pass} run: ${res.stderr}\n${res.stdout.slice(-800)}`,
          );
          assert.match(res.stdout, /Setup complete/);
          assert.match(lastLine(res.stdout), LAST[cli]);
          const rules = RULES[cli];
          const dir = path.join(sb.home, rules.dir);
          const files = fs.readdirSync(dir).filter((n) => rules.match.test(n));
          assert.ok(files.length >= rules.min, `${cli}: ${files.length} rule files in ${dir}`);
        }
        guard.assertUnchanged();
      } finally {
        beat.stop();
        daemon.stop();
        sb.dispose();
      }
    });
  }
});
