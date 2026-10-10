// Differential leg of `geminiSettingsWrite` (spec 0256 requirements 27 and 31): the real
// `gemini_settings_write` of scripts/lib/gemini-settings.sh against the TypeScript write, over temporary
// homes: same return code, same file bytes, same messages. Needs bash and jq.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { geminiSettingsWrite } from "../lib/setup/gemini-settings.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const SEED = path.join(REPO, "config", "gemini", "settings.json");
const FAKE_REPO = "/fake/repo";
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function setup(file?: string): { home: string; target: string } {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-gsw-")));
  roots.push(home);
  const target = path.join(home, ".gemini", "settings.json");
  if (file !== undefined) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file);
  }
  return { home, target };
}

const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;
const SKIP = WINDOWS || !HAS_JQ ? "SKIP: needs a POSIX shell and jq" : false;

describe("differential against gemini_settings_write", { skip: SKIP }, () => {
  const normalise = (text: string, target: string): string =>
    text
      .split(target)
      .join("<T>")
      .replace(/\.bak\.\d{8}-\d{6}(?:\.\d{2})?/g, ".bak.<STAMP>");
  const cases: { name: string; file?: string; py?: string; org?: string; stale?: boolean }[] = [
    { name: "fresh with python", py: "/opt/py/bin/python3" },
    {
      name: "comments, operator reserved entry, org",
      file: '{\n // c\n "mcpServers":{"mempalace":{"command":"x"},"b":{"command":"o"}}\n}',
      py: "/p/py",
      org: '{"b":{"command":"n"}}',
    },
    { name: "stale target.tmp directory (rc 2)", file: '{"a":1}', stale: true },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const viaShell = setup(c.file);
      const viaTs = setup(c.file);
      for (const where of [viaShell, viaTs]) {
        if (!c.stale) continue;
        fs.mkdirSync(`${where.target}.tmp`, { recursive: true });
        fs.writeFileSync(path.join(`${where.target}.tmp`, "k"), "x");
      }
      const sh = bashLibs(
        [
          `source ${JSON.stringify(path.join(REPO, "scripts", "lib", "gemini-settings.sh"))}`,
          `gemini_settings_write ${JSON.stringify(viaShell.target)} ${JSON.stringify(SEED)} ${FAKE_REPO} "$PY" "$ORG"`,
          'echo "__RC__$?"',
        ].join("\n"),
        { ...process.env, PY: c.py ?? "", ORG: c.org ?? "" },
      );
      const rcShell = Number(/__RC__(\d+)/.exec(sh.stdout)?.[1] ?? 99);
      const out: string[] = [];
      const err: string[] = [];
      const rc = geminiSettingsWrite({
        ctx: {
          io: { out: (l) => void out.push(l), err: (l) => void err.push(l) },
          platform: process.platform,
          home: viaTs.home,
          repoDir: FAKE_REPO,
        },
        settingsTarget: viaTs.target,
        settingsSrc: SEED,
        python: c.py ?? "",
        orgNative: c.org,
      });
      assert.equal(rc, rcShell);
      assert.equal(fs.readFileSync(viaTs.target, "utf8"), fs.readFileSync(viaShell.target, "utf8"));
      const shellOut = sh.stdout.replace(/__RC__\d+\s*$/, "");
      assert.equal(
        normalise(out.map((l) => `${l}\n`).join(""), viaTs.target),
        normalise(shellOut, viaShell.target),
      );
      assert.equal(
        normalise(err.map((l) => `${l}\n`).join(""), viaTs.target),
        normalise(
          sh.stderr
            .split("\n")
            .filter((l) => !l.startsWith("rm: "))
            .join("\n"),
          viaShell.target,
        ),
      );
    });
  }
});
