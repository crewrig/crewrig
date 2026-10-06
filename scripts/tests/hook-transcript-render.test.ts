// hook-transcript-render.test.ts — the transcript manifests rendered for each CLI
// and platform (spec 0247 R20, R21, R22; scenario "Antigravity CLI on Windows
// receives the guarded form").
//
// `hook-wiring.ts transcript render <cli> --manifest <m> --platform <p>` over
// the real manifests: only the transcript commands change, into the forms
// R20 fixes; a refusal (a checkout path cmd.exe cannot read, a missing hook
// script) drops the transcript handlers with an ERROR line and leaves every
// other entry as it was. The Windows strings are produced on any host (the
// module takes the platform as a parameter).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { antigravityState, MEASURED_SURFACES } from "../lib/hook-command.ts";
import { renderTranscriptManifest } from "../lib/hook-transcript-manifest.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { backups, handler, handlers, wiring, type Json } from "./lib/guard-wiring-fixtures.ts";
import {
  AGY_HOOK,
  CLI_ID,
  configOf,
  makeTranscriptCheckout,
  MANIFEST,
  q,
  transcriptCommands,
  WIRED,
  writeConfig,
  type TranscriptCheckout,
} from "./lib/transcript-fixtures.ts";
import { cleanupAll, read, realTmp, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

type AnyCli = "claude" | "gemini" | "copilot" | "antigravity";
const ALL: readonly AnyCli[] = [...WIRED, "antigravity"];
const PLATFORMS = ["darwin", "linux", "win32"] as const;
const GUARDED = "set NoDefaultCurrentDirectoryInExePath=1&& ";

function render(
  co: TranscriptCheckout,
  cli: AnyCli,
  platform: string,
  manifest = co.manifest(cli),
) {
  return wiring(
    "transcript",
    "render",
    cli,
    "--manifest",
    manifest,
    "--repo",
    co.repo,
    "--platform",
    platform,
  );
}

/** The manifest with every transcript handler's command blanked: what must not change. */
function skeleton(config: unknown, cli: AnyCli): string {
  const copy = structuredClone(config) as Json;
  const targets = cli === "antigravity" ? handlers(copy[AGY_HOOK]) : handlers(copy);
  for (const h of targets) {
    if (String(h["command"]).includes("mempalace-transcript")) h["command"] = "<transcript>";
  }
  return JSON.stringify(copy);
}

function expectedCommand(co: TranscriptCheckout, cli: AnyCli, platform: string): string {
  if (cli === "antigravity") {
    return platform === "win32"
      ? `${GUARDED}node ${co.ts} antigravity-cli Stop`
      : `node "${co.ts}" antigravity-cli Stop`;
  }
  return `node "${co.ts}" ${CLI_ID[cli]}`;
}

describe("R20: the command line each CLI receives, on each platform", () => {
  test("the Antigravity CLI hooks entry of the measured-surface constant is in state (e)", () => {
    const entry = MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === "hooks");
    assert.equal(antigravityState(entry), "e");
  });

  for (const cli of ALL) {
    for (const platform of PLATFORMS) {
      test(`${cli} on ${platform}`, () => {
        const co = makeTranscriptCheckout();
        const res = render(co, cli, platform);
        assert.equal(res.status, 0, res.stderr);
        assert.equal(res.stderr, "");
        assert.equal(res.stdout.split("\n").length, 2, "one line of compact JSON");
        const out = JSON.parse(res.stdout) as Json;
        const manifest = JSON.parse(read(MANIFEST(cli))) as Json;
        const rendered = transcriptCommands(cli === "antigravity" ? out[AGY_HOOK] : out);
        assert.ok(rendered.length >= 1);
        for (const command of rendered) {
          assert.equal(command, expectedCommand(co, cli, platform));
          const body = command.startsWith(GUARDED) ? command.slice(GUARDED.length) : command;
          assert.doesNotMatch(body, /(^|\s)[A-Za-z_][A-Za-z0-9_]*=\S/, "no NAME=value prefix");
          assert.doesNotMatch(command, /\$|PROJECT_DIR|\bbash\b/, "no token, no shell");
        }
        assert.equal(skeleton(out, cli), skeleton(manifest, cli), "every other byte as read");
        if (cli === "copilot") {
          for (const h of handlers(out)) {
            assert.deepEqual(
              Object.keys(h).sort(),
              ["command", "type"],
              "Copilot keeps the command key",
            );
          }
        }
      });
    }
  }

  test("guard entries are left exactly as the manifest has them", () => {
    for (const cli of ALL) {
      const co = makeTranscriptCheckout();
      const out = JSON.parse(render(co, cli, "linux").stdout) as Json;
      const guard = (config: unknown) =>
        handlers(config).filter((h) => String(h["command"]).includes("worktree-git-guard"));
      assert.deepEqual(guard(out), guard(JSON.parse(read(MANIFEST(cli)))), cli);
    }
  });
});

describe("Antigravity CLI: each event of the named hook is rendered with its own key", () => {
  for (const platform of PLATFORMS) {
    test(`flat and grouped elements, on ${platform}`, () => {
      const co = makeTranscriptCheckout();
      const manifest = path.join(realTmp("crewrig-agy-manifest-"), "manifest.json");
      fs.writeFileSync(
        manifest,
        JSON.stringify({
          [AGY_HOOK]: {
            Stop: [
              handler("node hooks/mempalace-transcript.ts antigravity-cli Stop", { timeout: 10 }),
            ],
            AfterTool: [
              {
                matcher: "",
                hooks: [handler("node hooks/mempalace-transcript.ts antigravity-cli Stop")],
              },
            ],
          },
        }),
      );
      const res = render(co, "antigravity", platform, manifest);
      assert.equal(res.status, 0, res.stderr);
      const named = (JSON.parse(res.stdout) as Json)[AGY_HOOK] as Json;
      const form = (event: string) =>
        platform === "win32"
          ? `${GUARDED}node ${co.ts} antigravity-cli ${event}`
          : `node "${co.ts}" antigravity-cli ${event}`;
      assert.deepEqual(named["Stop"], [handler(form("Stop"), { timeout: 10 })]);
      assert.deepEqual(named["AfterTool"], [{ matcher: "", hooks: [handler(form("AfterTool"))] }]);
    });
  }
});

describe("a checkout path cmd.exe cannot read is refused (R20, R33)", () => {
  const manifest = (): Json => JSON.parse(read(MANIFEST("antigravity"))) as Json;

  test("from C:/Users/ana/crewrig: the guarded form; from C:/Users/Ana Diaz/crewrig: nothing, the diagnostic names the space and the path", () => {
    const ok = renderTranscriptManifest(manifest(), {
      cli: "antigravity",
      platform: "win32",
      scriptPath: "C:/Users/ana/crewrig/hooks/mempalace-transcript.ts",
    });
    assert.equal(ok.refusal, null);
    assert.deepEqual(transcriptCommands(ok.manifest[AGY_HOOK]), [
      `${GUARDED}node C:/Users/ana/crewrig/hooks/mempalace-transcript.ts antigravity-cli Stop`,
    ]);

    const spaced = renderTranscriptManifest(manifest(), {
      cli: "antigravity",
      platform: "win32",
      scriptPath: "C:/Users/Ana Diaz/crewrig/hooks/mempalace-transcript.ts",
    });
    assert.match(
      spaced.refusal ?? "",
      /C:\/Users\/Ana Diaz\/crewrig\/hooks\/mempalace-transcript\.ts contains whitespace, which cmd\.exe/,
    );
    assert.ok(!(AGY_HOOK in spaced.manifest), "the emptied named hook is dropped");
    assert.deepEqual(
      spaced.manifest["crewrig-worktree-git-guard"],
      manifest()["crewrig-worktree-git-guard"],
    );
  });

  test(
    "end to end: render refuses with ERROR, and the merge after it writes nothing",
    { skip: SKIP_POSIX },
    () => {
      const co = makeTranscriptCheckout("Ana Diaz");
      const res = render(co, "antigravity", "win32");
      assert.equal(res.status, 0);
      assert.match(
        res.stderr,
        /^ {2}ERROR: the checkout path .*Ana Diaz.* contains whitespace, which cmd\.exe/m,
      );
      const out = JSON.parse(res.stdout) as Json;
      assert.ok(!(AGY_HOOK in out));
      const rendered = path.join(path.dirname(co.repo), "rendered.json");
      fs.writeFileSync(rendered, res.stdout);
      const target = path.join(path.dirname(co.repo), "hooks.json");
      const installed = `${JSON.stringify({ [AGY_HOOK]: { Stop: [handler("MEMPALACE_TRANSCRIPT_ENABLED=1 bash /h/mempalace-transcript.sh Stop")] } })}\n`;
      fs.writeFileSync(target, installed);
      const merge = wiring(
        "transcript",
        "antigravity-merge",
        "--hooks",
        target,
        "--manifest",
        rendered,
        "--repo",
        co.repo,
      );
      assert.equal(merge.status, 0, merge.stderr);
      assert.equal(read(target), installed);
      assert.deepEqual(backups(target), []);
    },
  );

  test("the same spaced checkout is accepted by the other CLIs on Windows, quoted", () => {
    const co = makeTranscriptCheckout("Ana Diaz");
    for (const cli of WIRED) {
      const res = render(co, cli, "win32");
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stderr, "", cli);
      assert.deepEqual(
        [...new Set(transcriptCommands(JSON.parse(res.stdout)))],
        [`node "${co.ts}" ${CLI_ID[cli]}`],
      );
    }
  });
});

describe("a missing hook script drops the transcript handlers with an ERROR (R20, R21)", () => {
  for (const cli of ALL) {
    test(cli, () => {
      const co = makeTranscriptCheckout("co", { entry: false });
      const res = render(co, cli, "linux");
      assert.equal(res.status, 0);
      assert.match(
        res.stderr,
        /^ {2}ERROR: transcript hook not found at .*mempalace-transcript\.ts; no session-recording command is written\.$/m,
      );
      const out = JSON.parse(res.stdout) as Json;
      assert.deepEqual(transcriptCommands(out), []);
      const guard = (config: unknown) =>
        handlers(config).filter((h) => String(h["command"]).includes("worktree-git-guard"));
      assert.deepEqual(
        guard(out),
        guard(JSON.parse(read(MANIFEST(cli)))),
        "guard entries untouched",
      );
      if (cli === "claude")
        assert.ok(!("Stop" in (out["hooks"] as Json)), "an emptied event is dropped");
    });
  }

  test("a missing or non-object manifest exits 1 with nothing on stdout", () => {
    const co = makeTranscriptCheckout();
    const bad = path.join(path.dirname(co.repo), "bad.json");
    fs.writeFileSync(bad, "[]");
    for (const manifest of [path.join(co.repo, "absent.json"), bad]) {
      const res = render(co, "claude", "linux", manifest);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
    }
  });

  test(
    "through the Bash render: SR_TRANSCRIPT_WIRED=0 and the installed command byte-identical after the merge",
    { skip: SKIP_POSIX },
    () => {
      for (const cli of WIRED) {
        const co = makeTranscriptCheckout("co", { entry: false });
        const legacy = 'MEMPALACE_TRANSCRIPT_ENABLED=1 bash "/h/hooks/mempalace-transcript.sh"';
        const file = writeConfig(co, `${cli}.json`, configOf(cli, [legacy]));
        const res = bashLibs(
          `render_session_recording_manifest ${cli} ${q(co.repo)} ${q(co.manifest(cli))} r.json
         merge_session_recording_hooks ${cli} ${q(file)} r.json; echo "rc=$? wired=$SR_TRANSCRIPT_WIRED"`,
        );
        assert.match(res.stdout, /rc=0 wired=0/, res.stdout + res.stderr);
        assert.match(res.stderr, /ERROR: transcript hook not found/);
        assert.deepEqual(transcriptCommands(JSON.parse(read(file))), [legacy], cli);
      }
    },
  );
});
