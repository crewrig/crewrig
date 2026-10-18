// setup-hooks-rewrite.test.ts — the pre-question rewrite of the installed guard and transcript
// commands (spec 0256 requirements 29 and 31; plan v2 step B3a.1). The Bash oracle went with
// retired scripts/lib/usage-capture-optin.sh (spec 0266); each case asserts the TypeScript outcome.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import {
  requireNodeFloor,
  rewriteInstalledHooks,
  type HooksCtx,
} from "../lib/setup/hooks-rewrite.ts";
import {
  configOf,
  directCmd,
  homeWithCopies,
  HOME_DIR,
  legacyForms,
  makeTranscriptCheckout,
  WIRED,
  type TranscriptCheckout,
  type WiredCli,
} from "./lib/transcript-fixtures.ts";
import { cleanupAll, read, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const SKIP = SKIP_POSIX || (which("jq") === null ? "SKIP: jq is needed" : false);
const OK: SpawnResult = { status: 0, stdout: "", stderr: "" };
const FLOOR_LINE = "crewrig: Node.js v20.0.0 detected; crewrig requires Node.js >= 24.";
const below: Spawner = () => ({ status: 1, stdout: "", stderr: `${FLOOR_LINE}\n` });

function makeCtx(repo: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  const ctx: HooksCtx = { io, env: {}, platform: process.platform, home: repo, repoDir: repo };
  return { ctx, out, err };
}

const norm = (text: string, file: string): string[] =>
  text === ""
    ? []
    : text
        .trimEnd()
        .split(file)
        .join("<F>")
        .replace(/\.bak\.\d{8}-\d{6}(\.\d\d)?/g, ".bak.<T>")
        .split("\n");

/** An installed configuration: the guard and a consented transcript command in their legacy forms. */
function installed(cli: WiredCli, co: TranscriptCheckout, home: string): unknown {
  const guard = `bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`;
  const env = cli === "claude" ? { MEMPALACE_TRANSCRIPT_ENABLED: "1" } : undefined;
  const forms = legacyForms(home, HOME_DIR[cli]);
  return configOf(cli, [forms["legacy-enabled"] ?? "", forms["legacy-unmarked"] ?? ""], {
    neighbours: [guard, "/opt/operator/notify.sh"],
    ...(env === undefined ? {} : { env }),
  });
}

function pair(
  cli: WiredCli,
  make: (co: TranscriptCheckout) => unknown,
): { co: TranscriptCheckout; a: string; b: string } {
  const co = makeTranscriptCheckout();
  const content = make(co);
  const a = path.join(path.dirname(co.repo), "a", `${cli}.json`);
  const b = path.join(path.dirname(co.repo), "b", `${cli}.json`);
  for (const f of [a, b]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o644 });
  }
  return { co, a, b };
}

describe("the rewrite", { skip: SKIP }, () => {
  for (const cli of WIRED) {
    test(`${cli}: legacy guard and consented transcript commands move to the direct form`, () => {
      const home = homeWithCopies();
      const copy = path.join(home, HOME_DIR[cli], "hooks", "mempalace-transcript.sh");
      const { co, b } = pair(cli, (c) => installed(cli, c, home));
      const run = makeCtx(co.repo);
      const spawn: Spawner = () => OK;
      const res = rewriteInstalledHooks({
        ctx: run.ctx,
        cli,
        settingsPath: b,
        spawn,
        unusedCopy: copy,
      });
      assert.deepEqual(res, { guard: 0, transcript: 0, usage: 0 });
      assert.equal(fs.statSync(b).mode & 0o777, 0o600);
      const tsOut = norm(run.out.join("\n"), b);
      assert.ok(tsOut.some((l) => l.includes("No longer used (left on disk)")));
      assert.ok(read(b).includes(directCmd(co, cli)) || read(b).includes(co.guard));
    });
  }
  test("a second run rewrites nothing and makes no backup", () => {
    const home = homeWithCopies();
    const { co, b } = pair("claude", (c) => installed("claude", c, home));
    const first = makeCtx(co.repo);
    const options = { cli: "claude", settingsPath: b, spawn: () => OK, unusedCopy: "" } as const;
    rewriteInstalledHooks({ ...options, ctx: first.ctx });
    const baks = fs.readdirSync(path.dirname(b)).length;
    const again = makeCtx(co.repo);
    rewriteInstalledHooks({ ...options, ctx: again.ctx });
    assert.equal(fs.readdirSync(path.dirname(b)).length, baks);
    assert.ok(
      again.out.every((l) => /already the direct form|nothing written/.test(l)),
      again.out.join("\n"),
    );
  });
});

describe("below the floor, with nothing registered, with a broken file", () => {
  test("below the floor the diagnostic is printed and the file is untouched", () => {
    const home = homeWithCopies();
    const { co, b } = pair("claude", (c) => installed("claude", c, home));
    const before = read(b);
    const run = makeCtx(co.repo);
    const res = rewriteInstalledHooks({
      ctx: run.ctx,
      cli: "claude",
      settingsPath: b,
      spawn: below,
    });
    assert.deepEqual(res, { guard: 1, transcript: 1, usage: 0 });
    assert.equal(read(b), before);
    // R7 (spec 0268): each stale entry is listed after the generic line, by hook name and event.
    const kept = run.err.filter((l) => !l.includes(": stale "));
    assert.deepEqual(kept, [
      FLOOR_LINE,
      "  Installed worktree git guard command left as it is.",
      FLOOR_LINE,
      "  Installed session-recording commands left as they are.",
    ]);
    assert.ok(
      run.err.some((l) => l.includes("Worktree git guard: stale") && l.includes(" on Stop")),
    );
    assert.ok(
      run.err.some((l) => l.includes("Session recording: stale") && l.includes(" on Stop")),
    );
  });
  test("a file naming neither hook needs no Node.js: nothing is spawned", () => {
    const { co, b } = pair("gemini", () => ({ ui: { theme: "dark" } }));
    const calls: string[] = [];
    const spawn: Spawner = (argv) => {
      calls.push(argv.join(" "));
      return OK;
    };
    const run = makeCtx(co.repo);
    const res = rewriteInstalledHooks({
      ctx: run.ctx,
      cli: "gemini",
      settingsPath: b,
      spawn,
      unusedCopy: "",
    });
    assert.deepEqual(res, { guard: 0, transcript: 0, usage: 0 });
    assert.deepEqual([calls, run.out, run.err], [[], [], []]);
  });
  test("an absent file is a no-op", () => {
    const run = makeCtx(homeWithCopies());
    const missing = path.join(run.ctx.home, "nope.json");
    const res = rewriteInstalledHooks({
      ctx: run.ctx,
      cli: "copilot",
      settingsPath: missing,
      spawn: below,
    });
    assert.deepEqual(res, { guard: 0, transcript: 0, usage: 0 });
    assert.equal(fs.existsSync(missing), false);
  });
  test("a file that is not a JSON object names the file, changes nothing and returns a status", () => {
    const { co, b } = pair("claude", () => ({}));
    fs.writeFileSync(b, '["worktree-git-guard", "mempalace-transcript"]\n');
    const run = makeCtx(co.repo);
    const res = rewriteInstalledHooks({
      ctx: run.ctx,
      cli: "claude",
      settingsPath: b,
      spawn: () => OK,
      unusedCopy: "",
    });
    assert.deepEqual(res, { guard: 1, transcript: 1, usage: 0 });
    assert.equal(read(b), '["worktree-git-guard", "mempalace-transcript"]\n');
    assert.ok(
      run.err.every((l) => l.includes(b)),
      run.err.join("\n"),
    );
  });
  test("no node on PATH prints its diagnostic line", () => {
    const run = makeCtx(homeWithCopies());
    const none: Spawner = () => ({ status: 127, stdout: "", stderr: "" });
    assert.equal(requireNodeFloor(run.ctx, none), false);
    assert.match(
      run.err[0] ?? "",
      /^ {2}ERROR: crewrig: Node\.js was not found on PATH; this step requires Node\.js >= 24\./,
    );
  });
});
