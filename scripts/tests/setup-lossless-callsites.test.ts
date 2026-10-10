// setup-lossless-callsites.test.ts — finding i1-F13: the session-recording merge is best effort in the
// shell (`if ! merge_session_recording_hooks ...` and `if ! deploy_antigravity_transcript_hooks ...` print
// "Transcript activation FAILED — setup continues without it." and go on). A settings or hooks file
// holding a number that does not round-trip (a big integer, `1.0`, `1e3`) must therefore NOT abort the
// run: one `Error: <file> cannot be rewritten without loss: ...` line, the failure status, the file
// byte-identical, no backup, and the flow reaches the next step with status 0.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { deployAntigravityTranscriptHooks, agyPaths } from "../lib/setup/antigravity-hooks.ts";
import type { StepFn } from "../lib/setup/descriptor.ts";
import { agySessionRecording } from "../lib/setup/steps-agy.ts";
import { mergeSessionRecordingHooks } from "../lib/setup/session-recording.ts";
import { descriptor, POSIX_ONLY, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";
import { copyRepoHooks, okSpawn as agySpawn } from "./setup-steps-agy-fixtures.ts";
import {
  hooksFileOf,
  HOOK_CLIS,
  put,
  rig,
  runHooks,
  useRig,
} from "./setup-steps-hooks-fixtures.ts";

const NUMBERS = [
  ["a big integer", "12345678901234567890"],
  ["1.0", "1.0"],
  ["1e3", "1e3"],
] as const;

const FAILED = "  Transcript activation FAILED — setup continues without it.";
const lossyLines = (err: string): string[] =>
  err.split("\n").filter((l) => l.includes("cannot be rewritten without loss: "));

describe("session-recording step of the hook-file CLIs", { skip: POSIX_ONLY }, () => {
  useRig();
  for (const cli of HOOK_CLIS) {
    for (const [label, number] of NUMBERS) {
      test(`${cli}: ${label} reports, leaves the file and reaches the next step`, async () => {
        const text = `{ "limit": ${number}, "model": "opus" }\n`;
        const file = put(hooksFileOf(cli), text);
        const reached: string[] = [];
        const next: StepFn = async () => void reached.push("next");
        const result = await runHooks(cli, {
          steps: ["mcp", "session-recording", "summary"],
          answers: { transcripts: "yes", "transcripts-confirm": "yes" },
          extra: { summary: next },
        });
        assert.equal(result.status, 0, result.err);
        const lines = lossyLines(result.err);
        assert.equal(lines.length, 1, result.err);
        assert.match(lines[0] ?? "", /^Error: .*\/\.[a-z]+\/.*cannot be rewritten without loss: /); // scrubbed path
        assert.ok(result.err.includes(FAILED), result.err);
        assert.equal(fs.readFileSync(file, "utf8"), text, "file bytes");
        assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)], "no backup");
        assert.deepEqual(reached, ["next"]);
        assert.ok(!result.out.includes("Transcript hooks merged"), result.out);
      });
    }
  }

  test("mergeSessionRecordingHooks returns the failure status with no allHooksDisabled", () => {
    const text = '{ "limit": 1.0 }\n';
    const file = put(hooksFileOf("copilot"), text);
    const err: string[] = [];
    const io = {
      out: () => undefined,
      err: (l: string) => void err.push(l),
      errRaw: (t: string) => void err.push(t),
    };
    const result = mergeSessionRecordingHooks({
      ctx: { io },
      cli: "copilot",
      config: file,
      patched: { hooks: {} },
    });
    assert.deepEqual(result, { ok: false, allHooksDisabled: false });
    assert.equal(err.length, 1);
    assert.equal(fs.readFileSync(file, "utf8"), text);
    assert.equal(rig.home.length > 0, true);
  });
});

describe("session-recording step of Antigravity CLI", { skip: POSIX_ONLY }, () => {
  useSandbox();
  const HOOKS = ".gemini/config/hooks.json";
  for (const [label, number] of NUMBERS) {
    test(`${label} reports, leaves hooks.json and reaches the next step`, async () => {
      copyRepoHooks();
      const file = path.join(sandbox.tmp, HOOKS);
      const text = `{ "limit": ${number} }\n`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      const reached: string[] = [];
      const next: StepFn = async () => void reached.push("next");
      const result = await run(
        descriptor(["session-recording", "summary"], "antigravity"),
        { "session-recording": agySessionRecording, summary: next },
        {
          argv: ["--answer", "transcripts=yes", "--answer", "transcripts-confirm=yes"],
          spawn: agySpawn,
        },
      );
      assert.equal(result.status, 0, result.err);
      const lines = lossyLines(result.err);
      assert.equal(lines.length, 1, result.err);
      assert.ok(lines[0]?.startsWith(`Error: ${file} cannot be rewritten without loss: `));
      assert.ok(result.err.includes(FAILED), result.err);
      assert.equal(fs.readFileSync(file, "utf8"), text, "file bytes");
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ["hooks.json"], "no backup");
      assert.deepEqual(reached, ["next"]);
      assert.ok(!result.out.includes("Transcript hooks deployed"), result.out);
    });
  }

  test("deployAntigravityTranscriptHooks returns ok=false, wired=false", () => {
    copyRepoHooks();
    const err: string[] = [];
    const io = { out: () => undefined, err: (l: string) => void err.push(l) };
    const ctx = {
      io: { ...io, errRaw: io.err },
      env: {},
      platform: process.platform,
      home: sandbox.tmp,
      repoDir: sandbox.tmp,
    };
    const paths = agyPaths(ctx);
    const text = '{ "limit": 1.0 }\n';
    fs.mkdirSync(path.dirname(paths.hooksJson), { recursive: true });
    fs.writeFileSync(paths.hooksJson, text);
    const hooks = path.join(sandbox.tmp, "hooks");
    const result = deployAntigravityTranscriptHooks(ctx, agySpawn, {
      manifestSrc: path.join(hooks, "antigravity-transcript-hooks.json"),
      hooksDir: path.join(paths.agyHome, "hooks"),
      manifestTarget: paths.hooksJson,
      guardSrc: path.join(hooks, "worktree-git-guard.ts"),
    });
    assert.deepEqual(result, { ok: false, wired: false });
    assert.equal(lossyLines(err.join("\n")).length, 1);
    assert.equal(fs.readFileSync(paths.hooksJson, "utf8"), text);
  });
});
