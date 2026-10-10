// setup-gemini-settings-rc.test.ts — geminiSettingsWrite's status 2 ("merged but incomplete") when
// the merged file is in place and only its mode could not be narrowed, against a temporary home.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, test, mock } from "node:test";

import { geminiSettingsWrite } from "../lib/setup/gemini-settings.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const roots: string[] = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});
afterEach(() => mock.restoreAll());

test("a chmod that fails after the rename returns 2, with the shell's two lines", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-gsrc-")));
  roots.push(home);
  const target = path.join(home, ".gemini", "settings.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{"theme":"x"}');
  const real = fs.chmodSync;
  mock.method(fs, "chmodSync", ((p: fs.PathLike, m: fs.Mode) => {
    if (p === target) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    return real(p, m);
  }) as typeof fs.chmodSync);
  const err: string[] = [];
  const rc = geminiSettingsWrite({
    ctx: {
      io: { out: () => undefined, err: (l) => void err.push(l) },
      platform: "linux",
      home,
      repoDir: "/fake/repo",
    },
    settingsTarget: target,
    settingsSrc: path.join(REPO, "config", "gemini", "settings.json"),
    python: "",
  });
  assert.equal(rc, 2);
  assert.equal((JSON.parse(fs.readFileSync(target, "utf8")) as { theme: string }).theme, "x");
  assert.equal(
    err[0],
    `  ERROR: ${target} holds the merged settings, but restricting it to 0600 did not complete.`,
  );
  assert.match(err[1] ?? "", /The prior file is preserved in the timestamped backup: /);
});
