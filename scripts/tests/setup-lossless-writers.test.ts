// setup-lossless-writers.test.ts — finding i1-F11: a layer-3 writer of scripts/lib/setup/ refuses to
// rewrite a settings, hooks or config file holding a number that does not round-trip through a JS number
// (the shell's jq keeps `12345678901234567890`, `1.0` and `1e3`; it prints `1e3` as `1E+3`). The refusal is
// the lossless reader of scripts/lib/hook-config.ts: one `Error:` line on standard error, `SetupExit(1)`,
// the file byte-identical and no backup made. The two best-effort rewrite steps (the guard and usage-capture
// rewrites) print the same line but return status 1 and let the run go on (the shell's `|| true`).
// Numbers that round-trip (`1.5`, `2`) still go through.
// Every case runs in a sandboxed home under the OS temporary directory; the real home is never read.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { Io } from "../lib/setup/context.ts";
import { agyPaths, type AgyCtx } from "../lib/setup/antigravity-hooks.ts";
import { removeStatusline } from "../lib/setup/antigravity-statusline.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { rewriteInstalledGuard } from "../lib/setup/hooks-rewrite.ts";
import { mergeSessionRecordingHooks } from "../lib/setup/session-recording.ts";
import { usageCaptureRemove, usageCaptureRewrite } from "../lib/setup/usage-capture.ts";
import { cap, checkout, floorOk } from "./lib/usage-capture-rig.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const sandboxes: string[] = [];
after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lossless-")));
  sandboxes.push(dir);
  return dir;
}

const NUMBERS = [
  ["a big integer", "12345678901234567890"],
  ["1.0", "1.0"],
  ["1e3", "1e3"],
] as const;

interface Harness {
  readonly home: string;
  readonly err: string[];
  readonly io: Io;
  readonly ctx: AgyCtx;
}

function harness(): Harness {
  const home = sandbox();
  const err: string[] = [];
  const io: Io = {
    out: () => undefined,
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  return { home, err, io, ctx: { io, env: {}, platform: process.platform, home, repoDir: home } };
}

/** `settings.json` text of `claude` holding the capture hook (`legacy` or direct) and `number`. */
function settingsText(number: string, command: string): string {
  const hook = { type: "command", command };
  return `{\n  "limit": ${number},\n  "hooks": { "Stop": [ { "matcher": "*", "hooks": [ ${JSON.stringify(hook)} ] } ] }\n}\n`;
}

/** Run `step`: it must throw `SetupExit(1)` after one `Error:` line naming `file`; `file` stays as it was. */
function assertRefused(h: Harness, file: string, before: string, step: () => unknown): void {
  assert.throws(step, (e: unknown) => e instanceof SetupExit && e.status === 1);
  assert.equal(h.err.length, 1, `one line on standard error, got ${JSON.stringify(h.err)}`);
  assert.match(h.err[0] ?? "", /^Error: /);
  assert.ok((h.err[0] ?? "").includes(`${file} cannot be rewritten without loss: `));
  assert.match(h.err[0] ?? "", /does not round-trip\.$/);
  assert.equal(fs.readFileSync(file, "utf8"), before, "file bytes");
  const siblings = fs.readdirSync(path.dirname(file)).filter((n) => n !== path.basename(file));
  assert.deepEqual(siblings, [], "no backup and no temporary file");
}

/** Run best-effort `step`: status 1, one `Error:` line naming `file`, `file` as it was, no backup, no throw. */
function assertKeptGoing(h: Harness, file: string, before: string, step: () => number): void {
  assert.equal(step(), 1, "the step's failure status, not a SetupExit");
  assert.equal(h.err.length, 1, `one line on standard error, got ${JSON.stringify(h.err)}`);
  assert.ok((h.err[0] ?? "").startsWith(`Error: ${file} cannot be rewritten without loss: `));
  assert.equal(fs.readFileSync(file, "utf8"), before, "file bytes");
  const siblings = fs.readdirSync(path.dirname(file)).filter((n) => n !== path.basename(file));
  assert.deepEqual(siblings, [], "no backup and no temporary file");
}

function write(h: Harness, name: string, text: string): string {
  const file = path.join(h.home, name);
  fs.writeFileSync(file, text);
  return file;
}

describe("usage-capture writers (usage-capture*.ts)", () => {
  for (const [label, number] of NUMBERS) {
    test(`usageCaptureRemove refuses ${label}`, () => {
      const h = harness();
      const text = settingsText(number, cap(h.home, "claude"));
      const file = write(h, "settings.json", text);
      assertRefused(h, file, text, () =>
        usageCaptureRemove({ ctx: h.ctx, cli: "claude", settingsPath: file }),
      );
    });

    test(`usageCaptureRewrite (best effort) returns 1 on ${label}`, () => {
      const h = harness();
      const repo = checkout();
      const text = settingsText(number, cap(repo, "claude", "sh"));
      const file = write(h, "settings.json", text);
      assertKeptGoing(h, file, text, () =>
        usageCaptureRewrite({
          ctx: h.ctx,
          cli: "claude",
          settingsPath: file,
          repoDir: repo,
          deps: { spawn: floorOk },
        }),
      );
    });
  }

  test("numbers that round-trip (1.5 and 2) are rewritten as before", () => {
    const h = harness();
    const file = write(h, "settings.json", settingsText("1.5", cap(h.home, "claude")));
    const text = fs.readFileSync(file, "utf8").replace('"limit": 1.5', '"limit": 2');
    fs.writeFileSync(file, text);
    assert.equal(usageCaptureRemove({ ctx: h.ctx, cli: "claude", settingsPath: file }), 0);
    assert.deepEqual(h.err, []);
    const rewritten = JSON.parse(fs.readFileSync(file, "utf8")) as { limit: number };
    assert.equal(rewritten.limit, 2);
  });
});

describe("session recording merge (session-recording.ts)", () => {
  const patched = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } };
  for (const [label, number] of NUMBERS) {
    test(`mergeSessionRecordingHooks refuses ${label}`, () => {
      const h = harness();
      const text = `{ "limit": ${number}, "model": "opus" }\n`;
      const file = write(h, "settings.json", text);
      assertRefused(h, file, text, () =>
        mergeSessionRecordingHooks({ ctx: h, cli: "claude", config: file, patched }),
      );
    });
  }
});

describe("worktree guard rewrite (hooks-rewrite.ts)", () => {
  for (const [label, number] of NUMBERS) {
    test(`rewriteInstalledGuard (best effort) returns 1 on ${label}`, () => {
      const h = harness();
      const legacy = `bash "${REPO}/hooks/worktree-git-guard.sh"`;
      const text = settingsText(number, legacy);
      const file = write(h, "settings.json", text);
      assertKeptGoing(h, file, text, () =>
        rewriteInstalledGuard({
          ctx: { ...h.ctx, repoDir: REPO },
          cli: "claude",
          settingsPath: file,
          spawn: floorOk,
        }),
      );
    });
  }
});

describe("antigravity statusline removal (antigravity-statusline.ts)", () => {
  for (const [label, number] of NUMBERS) {
    test(`removeStatusline refuses ${label}`, () => {
      const h = harness();
      const paths = agyPaths(h.ctx);
      fs.mkdirSync(paths.agyHome, { recursive: true });
      const text = `{ "limit": ${number}, "statusLine": { "command": "x" } }\n`;
      fs.writeFileSync(paths.settings, text);
      const before = fs.readdirSync(paths.agyHome).length;
      assert.throws(
        () => removeStatusline(h.ctx, paths),
        (e: unknown) => e instanceof SetupExit && e.status === 1,
      );
      assert.equal(h.err.length, 1);
      assert.ok(
        h.err[0]?.startsWith(`Error: ${paths.settings} cannot be rewritten without loss: `),
      );
      assert.equal(fs.readFileSync(paths.settings, "utf8"), text);
      assert.equal(fs.readdirSync(paths.agyHome).length, before, "no backup");
    });
  }
});
