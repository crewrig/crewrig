// hook-transcript-floor.test.ts — a `node` below the floor stops the transcript
// rewiring (spec 0247 R27; scenario "An unsupported Node.js version stops the
// rewrite"; seat findings v1-F2, v1-F3).
//
// With C2's fake Node.js 20 first on PATH (shim-env.ts `fakeNodeFirst`), each
// of the four setups' session-recording steps runs as on a `yes`: the
// pre-question rewrite, then the render and merge (Claude Code, Gemini CLI,
// Copilot CLI) or the Antigravity deployment. The floor guard's diagnostic is
// printed, no direct-form command is written, the legacy command and its
// installed copy stay, Claude Code's env patch is withheld and recording is
// not reported active; Antigravity CLI's installed transcript hook stays
// byte-identical. POSIX only (Bash libraries, a fake `node`).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { serialiseJson } from "../lib/hook-config.ts";
import { classifyTranscript } from "../lib/transcript-recognition.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { backups, handler, type Json } from "./lib/guard-wiring-fixtures.ts";
import {
  AGY_GUARD,
  AGY_HOOK,
  configOf,
  homeWithCopies,
  makeTranscriptCheckout,
  q,
  transcriptCommands,
  WIRED,
  writeConfig,
  type WiredCli,
} from "./lib/transcript-fixtures.ts";
import { fakeNodeFirst } from "./lib/shim-env.ts";
import { cleanupAll, read, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const FLOOR = /requires Node\.js >= 24/;
const HOME_DIR: Readonly<Record<WiredCli, string>> = {
  claude: ".claude",
  gemini: ".gemini",
  copilot: ".copilot",
};

/** No command of the configuration is in the direct form, and none names the `.ts` entry. */
function assertNoDirect(text: string): void {
  const config = JSON.parse(text) as unknown;
  for (const command of transcriptCommands(config)) {
    assert.notEqual(classifyTranscript(command), "direct", command);
  }
  assert.ok(!text.includes("mempalace-transcript.ts"), "no direct-form command written");
}

describe(
  "R27: a yes answer below the floor writes no direct form (scenario 25)",
  { skip: SKIP_POSIX },
  () => {
    for (const cli of WIRED) {
      test(`${cli}: the diagnostic, the legacy command and its copy in place, recording not wired`, () => {
        const co = makeTranscriptCheckout();
        const home = homeWithCopies();
        const copy = path.join(home, HOME_DIR[cli], "hooks", "mempalace-transcript.sh");
        const copyBefore = read(copy);
        const legacy =
          cli === "claude" ? `bash "${copy}"` : `MEMPALACE_TRANSCRIPT_ENABLED=1 bash "${copy}"`;
        const file = writeConfig(co, `${cli}.json`, configOf(cli, [legacy]));
        const res = bashLibs(
          `transcript_rewrite_installed ${cli} ${q(co.repo)} ${q(file)}; echo "pre=$?"
         render_session_recording_manifest ${cli} ${q(co.repo)} ${q(co.manifest(cli))} r.json
         patch='{}'; [ "$SR_TRANSCRIPT_WIRED" = 1 ] && patch='{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}'
         merge_session_recording_hooks ${cli} ${q(file)} r.json "$patch"
         echo "rc=$? wired=$SR_TRANSCRIPT_WIRED"`,
          fakeNodeFirst(),
        );
        assert.match(res.stdout, /pre=1/, "the pre-question rewrite stops at the floor");
        assert.match(res.stdout, /rc=0 wired=0/, res.stdout + res.stderr);
        assert.match(res.stderr, FLOOR);
        assert.match(res.stderr, /Installed session-recording commands left as they are/);
        const text = read(file);
        assertNoDirect(text);
        assert.deepEqual(
          transcriptCommands(JSON.parse(text)),
          [legacy],
          "the legacy command stays",
        );
        assert.equal(read(copy), copyBefore, "the installed copy stays");
        if (cli === "claude") {
          assert.ok(!("env" in (JSON.parse(text) as Json)), "no env patch below the floor (v1-F3)");
        }
      });

      test(`${cli}: the pre-question rewrite alone leaves a legacy-enabled command byte-identical, with no backup`, () => {
        const co = makeTranscriptCheckout();
        const copy = path.join(homeWithCopies(), HOME_DIR[cli], "hooks", "mempalace-transcript.sh");
        const file = writeConfig(
          co,
          `${cli}.json`,
          configOf(cli, [`MEMPALACE_TRANSCRIPT_ENABLED=1 bash "${copy}"`]),
        );
        const before = read(file);
        const res = bashLibs(
          `transcript_rewrite_installed ${cli} ${q(co.repo)} ${q(file)}; echo "rc=$?"`,
          fakeNodeFirst(),
        );
        assert.match(res.stdout, /rc=1/);
        assert.match(res.stderr, FLOOR);
        assert.equal(read(file), before);
        assert.deepEqual(backups(file), []);
      });
    }

    test("each setup reports recording active, and Claude Code patches env, only when SR_TRANSCRIPT_WIRED is 1", () => {
      for (const cli of [...WIRED, "antigravity"]) {
        const lines = read(path.join(REPO, "scripts", `setup-${cli}-interactive.sh`)).split("\n");
        const at = lines.findIndex((line) => line.includes('echo "  Session recording wired to'));
        assert.ok(at > 0, cli);
        assert.match(
          lines[at - 1] ?? "",
          /if \[ "\$\{SR_TRANSCRIPT_WIRED:-0\}" = "1" \]; then/,
          cli,
        );
      }
      const claude = read(path.join(REPO, "scripts", "setup-claude-interactive.sh"));
      assert.match(
        claude,
        /ENV_PATCH='\{\}'\n\s+if \[ "\$\{SR_TRANSCRIPT_WIRED:-0\}" = "1" \]; then\n\s+ENV_PATCH='\{"MEMPALACE_TRANSCRIPT_ENABLED": "1"\}'/,
      );
    });
  },
);

describe(
  "R27 on Antigravity CLI: the installed transcript hook is byte-identical (v1-F2)",
  { skip: SKIP_POSIX },
  () => {
    test("a yes answer below the floor: diagnostic, no direct form, the named hook and its copy untouched", () => {
      const co = makeTranscriptCheckout();
      const home = homeWithCopies();
      const copy = path.join(
        home,
        ".gemini",
        "antigravity-cli",
        "hooks",
        "mempalace-transcript.sh",
      );
      const installed = {
        "operator-audit": { Stop: [handler("/opt/audit/log.sh")] },
        [AGY_HOOK]: {
          Stop: [handler(`MEMPALACE_TRANSCRIPT_ENABLED=1 bash "${copy}" Stop`, { timeout: 10 })],
        },
        [AGY_GUARD]: {
          PreToolUse: [
            {
              matcher: "run_command",
              hooks: [handler(`bash "${co.repo}/hooks/worktree-git-guard.sh"`, { timeout: 5 })],
            },
          ],
        },
      };
      const target = path.join(path.dirname(co.repo), "hooks.json");
      fs.writeFileSync(target, serialiseJson(installed));
      const res = bashLibs(
        `transcript_rewrite_installed antigravity ${q(co.repo)} ${q(target)}; echo "pre=$?"
       deploy_antigravity_transcript_hooks ${q(co.manifest("antigravity"))} "" ${q(path.join(home, "agy-hooks"))} ${q(target)} "" ${q(co.guard)}
       echo "rc=$? wired=$SR_TRANSCRIPT_WIRED"`,
        fakeNodeFirst(),
      );
      assert.match(res.stdout, /pre=1/);
      assert.match(res.stdout, /rc=0 wired=0/, res.stdout + res.stderr);
      assert.match(res.stderr, FLOOR);
      assert.match(
        res.stderr,
        /Session recording not wired this run; an installed transcript hook is left as it is/,
      );
      const text = read(target);
      assertNoDirect(text);
      const after = JSON.parse(text) as Json;
      assert.deepEqual(
        after[AGY_HOOK],
        installed[AGY_HOOK],
        "the transcript named hook byte-identical",
      );
      assert.equal(JSON.stringify(after[AGY_HOOK]), JSON.stringify(installed[AGY_HOOK]));
      assert.deepEqual(after[AGY_GUARD], installed[AGY_GUARD], "the guard is not rendered either");
      assert.deepEqual(after["operator-audit"], installed["operator-audit"]);
      assert.ok(fs.existsSync(copy), "the installed copy stays");
    });

    test("with no transcript hook installed, nothing is deployed below the floor", () => {
      const co = makeTranscriptCheckout();
      const target = path.join(path.dirname(co.repo), "hooks.json");
      fs.writeFileSync(
        target,
        serialiseJson({ "operator-audit": { Stop: [handler("/opt/audit/log.sh")] } }),
      );
      const res = bashLibs(
        `deploy_antigravity_transcript_hooks ${q(co.manifest("antigravity"))} "" ${q(path.join(path.dirname(co.repo), "agy"))} ${q(target)} "" ${q(co.guard)}
       echo "rc=$? wired=$SR_TRANSCRIPT_WIRED"`,
        fakeNodeFirst(),
      );
      assert.match(res.stdout, /rc=0 wired=0/, res.stdout + res.stderr);
      assert.ok(!(AGY_HOOK in (JSON.parse(read(target)) as Json)));
    });
  },
);
