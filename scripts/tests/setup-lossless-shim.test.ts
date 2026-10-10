// setup-lossless-shim.test.ts — finding i1-F13, shim half: the subcommands of scripts/usage-capture-optin.ts
// that wrap a public function of usage-capture-optin.sh (`merge-session-recording-hooks`, `enable`, `remove`,
// `keep`) return a status, they never abort. A configuration holding a number that does not round-trip (a big
// integer, `1.0`, `1e3`) therefore ends the subcommand with status 1, ONE `Error:` line on standard error (not
// the writer's line and then the entry's copy of the exception), the file byte-identical and no backup. The
// `--result` side channel is written on that path too: `SR_ALL_HOOKS_DISABLED=0` for the merge.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { usageCaptureCli } from "../lib/setup/usage-capture-cli.ts";
import { cap, checkout, runCtx } from "./lib/usage-capture-rig.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";
import { POSIX_ONLY } from "./setup-flow-fixtures.ts";

after(cleanupAll);

const NUMBERS = [
  ["a big integer", "12345678901234567890"],
  ["1.0", "1.0"],
  ["1e3", "1e3"],
] as const;

const settings = (number: string, command: string): string =>
  `{\n  "limit": ${number},\n  "hooks": { "Stop": [ { "matcher": "*", "hooks": [ ${JSON.stringify({ type: "command", command })} ] } ] }\n}\n`;

interface Case {
  readonly argv: (config: string, dir: string, repo: string) => string[];
  /** The configuration text for `number`; the capture command is registered at `repo`. */
  readonly text: (number: string, repo: string) => string;
}

const CASES: Readonly<Record<string, Case>> = {
  "merge-session-recording-hooks": {
    argv: (config, dir) => {
      const patched = path.join(dir, "patched.json");
      fs.writeFileSync(
        patched,
        '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}',
      );
      return [
        "merge-session-recording-hooks",
        "--result",
        path.join(dir, "result"),
        "claude",
        config,
        patched,
        "",
      ];
    },
    text: (number) => `{ "limit": ${number}, "model": "opus" }\n`,
  },
  enable: {
    argv: (config, dir, repo) => [
      "enable",
      "--result",
      path.join(dir, "result"),
      "claude",
      config,
      repo,
    ],
    text: (number, repo) => settings(number, cap(repo, "claude")),
  },
  remove: {
    argv: (config, dir) => ["remove", "--result", path.join(dir, "result"), "claude", config],
    text: (number, repo) => settings(number, cap(repo, "claude")),
  },
  // `keep` writes only to re-point a registration whose script vanished: this one points nowhere.
  keep: {
    argv: (config, dir, repo) => [
      "keep",
      "--result",
      path.join(dir, "result"),
      "claude",
      config,
      repo,
    ],
    text: (number) => settings(number, cap("/nonexistent/crewrig-checkout", "claude")),
  },
};

describe("usage-capture shim on a lossy configuration", { skip: POSIX_ONLY }, () => {
  for (const [name, c] of Object.entries(CASES)) {
    for (const [label, number] of NUMBERS) {
      test(`${name}: ${label} gives status 1, one Error line, the file untouched`, async () => {
        const dir = realTmp("lossless-shim-");
        const repo = checkout();
        const config = path.join(dir, "settings.json");
        const text = c.text(number, repo);
        fs.writeFileSync(config, text);
        const { ctx, err } = runCtx(repo);
        const status = await usageCaptureCli(c.argv(config, dir, repo), ctx);
        assert.equal(status, 1, err.join("\n"));
        const lossy = err.filter((l) => l.includes("cannot be rewritten without loss: "));
        assert.equal(lossy.length, 1, `one Error line, got ${JSON.stringify(err)}`);
        assert.ok(lossy[0]?.startsWith(`Error: ${config} cannot be rewritten without loss: `));
        assert.equal(fs.readFileSync(config, "utf8"), text, "file bytes");
        assert.deepEqual(
          fs.readdirSync(dir).filter((n) => n.startsWith("settings.json.")),
          [],
          "no backup",
        );
        if (name === "merge-session-recording-hooks") {
          assert.equal(
            fs.readFileSync(path.join(dir, "result"), "utf8"),
            "SR_ALL_HOOKS_DISABLED=0\n",
          );
        }
      });
    }
  }
});
