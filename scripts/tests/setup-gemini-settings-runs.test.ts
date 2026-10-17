// setup-gemini-settings-runs.test.ts — groups G3, G9, G13 and G14 of
// scripts/tests/test-setup-gemini-settings-merge.sh (spec 0263): whole setup runs composed in the setup's
// own order (settings write, HTTP registration of mempalace, session-recording merge, usage-capture
// answer) over a scratch home. G13 first half duplicates setup-retarget-others.test.ts (L94-103); only a
// vacuity guard on the declaration is added here, the second half (the nested `node --test`) is dropped.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { registerAssistant } from "../lib/service/assistant-config.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import {
  mergeSessionRecordingHooks,
  renderSessionRecordingManifest,
} from "../lib/setup/session-recording.ts";
import { usageCaptureApply } from "../lib/setup/usage-capture.ts";
import { usageCaptureKeep } from "../lib/setup/usage-capture-keep.ts";
import { capturePaths, captureState, readCaptureConfig } from "../lib/setup/usage-capture-state.ts";
import {
  COMMENT_WARN,
  FAKE_PY,
  FAKE_REPO,
  MODE_SKIP,
  ORACLE_SEQ,
  caseWith,
  canon,
  expectMode600,
  gsWrite,
  readDoc,
  stdout,
  type Case,
} from "./lib/gemini-settings-rig.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const OK: SpawnResult = { status: 0, stdout: "", stderr: "" };
const floorOk: Spawner = () => OK;
const MANIFEST = path.join(REPO, "hooks", "gemini-transcript-hooks.json");
const SEQ = JSON.parse(canon(ORACLE_SEQ).replaceAll(FAKE_REPO, REPO)) as unknown;
type Obj = Record<string, unknown>;
const hooksOf = (c: Case): Obj => readDoc(c)["hooks"] as Obj;
const commandsOf = (hooks: Obj): string[] =>
  Object.values(hooks).flatMap((groups) =>
    (groups as { hooks?: { command: string }[] }[]).flatMap((g) =>
      (g.hooks ?? []).map((h) => h.command),
    ),
  );

/** One setup run, in the setup's order; the repository is this checkout (its hooks and fragments are real). */
function setupRun(c: Case, session: boolean, capture: string, http: boolean, py = FAKE_PY): void {
  const io = {
    out: (l: string) => void c.out.push(l),
    err: (l: string) => void c.err.push(l),
    errRaw: (t: string) => void c.err.push(t.replace(/\n$/, "")),
  };
  const ctx = { io, env: {}, platform: process.platform, home: c.home, repoDir: REPO };
  gsWriteAt(c, py);
  if (c.rc !== 0) return;
  if (http) registerAssistant("gemini", c.home, "http://127.0.0.1:41893/mcp", "test-token-0214");
  if (session) {
    const rendered = renderSessionRecordingManifest({
      ctx,
      cli: "gemini",
      manifestSrc: MANIFEST,
      spawn: floorOk,
    });
    assert.ok(rendered !== null, "manifest rendered");
    assert.ok(
      mergeSessionRecordingHooks({
        ctx,
        cli: "gemini",
        config: c.target,
        patched: rendered.manifest,
      }).ok,
    );
  }
  const state = captureState("gemini", readCaptureConfig(c.target));
  const options = {
    ctx,
    cli: "gemini",
    settingsPath: c.target,
    repoDir: REPO,
    deps: { spawn: floorOk },
  };
  c.rc = usageCaptureApply({
    ...options,
    state,
    answer: capture,
    keep: (o) =>
      usageCaptureKeep({
        ctx: o.ctx,
        cli: "gemini",
        settingsPath: o.settingsPath,
        repoDir: REPO,
        deps: { spawn: floorOk },
      }),
  });
}
/** The settings write with this checkout as the repository. */
function gsWriteAt(c: Case, py: string): void {
  gsWrite(c, py, undefined, undefined, REPO);
}

describe("G3 hooks across an accepting then a declining run", () => {
  test("3a accepting run registers session recording and capture, keeps the operator hook; 3b declining run changes nothing", () => {
    const notify = {
      Notification: [{ matcher: "*", hooks: [{ type: "command", command: "notify-send gemini" }] }],
    };
    const c = caseWith(JSON.stringify({ hooks: notify }));
    setupRun(c, true, "yes", false);
    assert.equal(c.rc, 0, c.err.join("\n"));
    const wanted = commandsOf(
      (JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { hooks: Obj }).hooks,
    ).length;
    assert.ok(wanted > 0, "the manifest declares commands (vacuity guard)");
    const have = commandsOf(hooksOf(c));
    assert.ok(
      have.some((x) => x.includes("worktree-git-guard")),
      "worktree git guard registered",
    );
    assert.ok(
      have.some((x) => x.includes("mempalace-transcript")),
      "session recording registered",
    );
    assert.deepEqual(hooksOf(c)["Notification"], notify.Notification);
    assert.ok(
      commandsOf({ Notification: hooksOf(c)["Notification"] }).includes("notify-send gemini"),
    );
    assert.equal(captureState("gemini", readCaptureConfig(c.target)), "installed");
    const run1 = canon(hooksOf(c));
    const paths1 = capturePaths("gemini", readCaptureConfig(c.target));
    assert.ok(paths1.length > 0);

    setupRun(c, false, "", false);
    assert.equal(c.rc, 0, c.err.join("\n"));
    assert.equal(canon(hooksOf(c)), run1, "a declining run leaves every hook entry in place (R4)");
    assert.equal(captureState("gemini", readCaptureConfig(c.target)), "installed");
    assert.deepEqual(capturePaths("gemini", readCaptureConfig(c.target)), paths1);
    if (!MODE_SKIP) expectMode600(c);
  });
});

describe("G9 re-runs are idempotent", () => {
  test("9 three runs: no comment warning, run 3 equals run 2, wrapper once, nothing duplicated", () => {
    const c = caseWith(
      JSON.stringify({
        ui: { theme: "Dracula" },
        context: { fileName: ["LOCAL.md", "AGENTS.md"] },
        hooks: {
          Notification: [
            { matcher: "*", hooks: [{ type: "command", command: "notify-send gemini" }] },
          ],
        },
        mcpServers: { "acme-tools": { command: "acme" } },
      }),
    );
    setupRun(c, true, "yes", true);
    assert.equal(c.rc, 0, c.err.join("\n"));
    c.out.length = 0;
    setupRun(c, true, "keep", true);
    assert.equal(c.rc, 0, c.err.join("\n"));
    assert.ok(!stdout(c).includes(COMMENT_WARN));
    const run2 = canon(readDoc(c));
    setupRun(c, true, "keep", true);
    assert.equal(c.rc, 0, c.err.join("\n"));
    assert.equal(canon(readDoc(c)), run2);
    const d = readDoc(c) as {
      mcpServers: Obj;
      context: { fileName: string[] };
      hooks: Obj;
      ui: unknown;
    };
    const seq = d.mcpServers["sequentialthinking"] as { args: string[] };
    assert.equal(seq.args.filter((a) => a.endsWith("tls-exec.sh")).length, 1);
    assert.equal(canon(seq), canon(SEQ));
    assert.equal((d.mcpServers["mempalace"] as { type: string }).type, "http");
    for (const groups of Object.values(d.hooks)) {
      const cmds = commandsOf({ x: groups });
      assert.equal(cmds.length, new Set(cmds).size, "no hook command duplicated on an event");
    }
    assert.equal(d.context.fileName.length, new Set(d.context.fileName).size);
    assert.deepEqual(d.ui, { theme: "Dracula" });
    assert.deepEqual(d.mcpServers["acme-tools"], { command: "acme" });
    assert.ok(commandsOf({ n: d.hooks["Notification"] }).includes("notify-send gemini"));
    if (!MODE_SKIP) expectMode600(c);
  });
});

describe("G13 declared order", () => {
  test("the Gemini declaration is not empty and runs mcp before session-recording and usage-capture", () => {
    const { steps } = geminiDescriptor;
    assert.ok(steps.length > 0, "empty declaration is a failure");
    assert.ok(steps.indexOf("mcp") >= 0);
    assert.ok(steps.indexOf("mcp") < steps.indexOf("session-recording"));
    assert.ok(steps.indexOf("mcp") < steps.indexOf("usage-capture"));
  });
});

describe("G14 a wrapped-form playwright entry survives a setup run", () => {
  test("14 playwright entry preserved verbatim, key order included, no warning names it", () => {
    const pw =
      '{"command":"bash","args":["/old/clone/scripts/lib/tls-exec.sh","npx","@playwright/mcp@latest"]}';
    const c = caseWith(`{"mcpServers":{"playwright":${pw},"acme-tools":{"command":"acme"}}}\n`);
    setupRun(c, true, "yes", true);
    assert.equal(c.rc, 0, c.err.join("\n"));
    assert.equal(JSON.stringify((readDoc(c)["mcpServers"] as Obj)["playwright"]), pw);
    assert.ok(!stdout(c).includes("'playwright'"));
    assert.ok(!c.err.join("\n").includes("'playwright'"));
  });
});
