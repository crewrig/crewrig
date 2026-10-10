// install-differential.test.ts — the differential proof of the install, manage and link entries
// (spec 0255 R27; ticket #1334, PR C step 16): the UNCHANGED shell script and the TypeScript entry
// run over identical sandboxes and must agree on status, stdout, stderr and every written tree
// (file set, bytes, modes, link kind), temporary names normalised. Each expected difference is a
// tagged deviation (`deviation: R22(<letter>)`); an unlisted real difference is a `todo` finding.
// Linux and macOS only; retires with the shell scripts (PR E).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { expectSame, twin, USAGE_PREFIX } from "./lib/install-differential.ts";
import type { Deviation, Twin, TwinOptions } from "./lib/install-differential.ts";
import { stubCli } from "./lib/install-sandbox.ts";
import type { InstallSandbox } from "./lib/install-sandbox.ts";
import { which } from "./lib/worktree-fixtures.ts";

const SKIP: string | false =
  process.platform === "win32"
    ? "POSIX only"
    : which("jq") === null
      ? "jq is not installed on this host"
      : false;
const opts = { skip: SKIP };

/** deviation: R22(c)/R22(m) — end of input answers no; the shell's `read` fails under `set -e` before its `echo`. */
const EOF_NEWLINE_TAG = "R22(c)/R22(m)";
const EOF_NEWLINE: Deviation = {
  tag: EOF_NEWLINE_TAG,
  apply: (s) => ({ ...s, stdout: `${s.stdout}\n` }),
};
const JSON_DECL = '{"command":"node","args":["a","b"],"env":{"K":"v"}}\n';

/** [type, authored artifact path, content] a manage script places without any rebuild. */
type Fixture = readonly [string, string, string];
interface Cli {
  readonly script: string;
  readonly fixtures: readonly Fixture[];
  readonly landing: string;
  readonly landingType: string;
}

const CLIS: Readonly<Record<string, Cli>> = {
  claude: {
    script: "manage-claude-component",
    landing: ".claude/rules/demo.md",
    landingType: "policies",
    fixtures: [
      ["policies", "policies/demo.md", "p\n"],
      ["mcp-servers", "mcp-servers/demo.json", JSON_DECL],
    ],
  },
  copilot: {
    script: "manage-copilot-component",
    landing: ".copilot/mcp-config.json",
    landingType: "mcp-servers",
    fixtures: [["mcp-servers", "mcp-servers/demo.json", JSON_DECL]],
  },
  antigravity: {
    script: "manage-antigravity-component",
    landing: ".gemini/antigravity-cli/rules/demo.md",
    landingType: "policies",
    fixtures: [
      ["policies", "policies/demo.md", "p\n"],
      ["mcp-servers", "mcp-servers/demo.json", JSON_DECL],
    ],
  },
  workspace: {
    script: "manage-workspace-component",
    landing: ".gemini/commands/demo.toml",
    landingType: "commands",
    fixtures: [
      ["commands", "commands/demo.toml", 'description = "d"\n'],
      ["hooks", "hooks/demo.sh", "echo hi\n"],
      ["policies", "policies/demo.toml", "[[rule]]\n"],
      ["mcp-servers", "mcp-servers/demo.json", JSON_DECL],
      ["themes", "themes/demo.json", '{"name":"demo"}\n'],
    ],
  },
};

const seed =
  (cli: Cli, extra: (box: InstallSandbox) => void = () => {}) =>
  (box: InstallSandbox): void => {
    for (const [, rel, body] of cli.fixtures) box.tree.artifact(`library/${rel}`, body);
    box.tree.artifact("library/skills/demo/SKILL.md", "s\n");
    extra(box);
  };

/** One twin per case; `finding` marks an unlisted real difference as a node:test `todo`. */
function check(
  title: string,
  run: () => Twin,
  deviations: readonly Deviation[] = [],
  finding?: string,
): void {
  const o = finding === undefined ? opts : { ...opts, todo: finding };
  it(title, o, () => expectSame(run(), deviations));
}

/** A link target whose DIRECTORY does not exist, so the link cannot be created through. */
const DANGLING_DIR = "/nonexistent";
const DANGLING = `${DANGLING_DIR}/target`;
const OLD_JSON = '{"mcpServers":{"demo":{"command":"old"}}}\n';

for (const [cliName, cli] of Object.entries(CLIS)) {
  describe(`manage ${cliName}`, () => {
    const go = (args: string[], o: TwinOptions = {}, extra?: (b: InstallSandbox) => void) =>
      twin(seed(cli, extra), cli.script, args, o);
    for (const [type] of cli.fixtures) {
      for (const mode of ["install", "link"]) {
        check(`${type} ${mode}, named`, () => go([mode, type, "demo"], { input: "y\n" }));
        check(`${type} ${mode}, whole type`, () => go([mode, type], { input: "y\n" }));
      }
    }
    const type = cli.landingType;
    check("usage: missing type", () => go([]), [USAGE_PREFIX]); // deviation: R22(i)
    check("usage: mode only", () => go(["install"]), [USAGE_PREFIX]); // deviation: R22(i)
    check("unknown type", () => go(["install", "bogus"]));
    check("unknown type in link mode", () => go(["link", "bogus"], { input: "y\n" }));
    check("unknown named component", () => go(["install", type, "nope"]));
    const at = (box: InstallSandbox, kind: "file" | "dangling" | "missing-file") => {
      const dest = `${box.home}/${cli.landing}`;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (kind === "dangling") fs.symlinkSync(DANGLING, dest);
      else if (kind === "missing-file") {
        fs.mkdirSync(`${box.home}/linked`);
        fs.symlinkSync(`${box.home}/linked/missing.json`, dest);
      } else fs.writeFileSync(dest, dest.endsWith(".json") ? OLD_JSON : "old\n", { mode: 0o600 });
    };
    for (const mode of ["install", "link"]) {
      const args = [mode, type, "demo"];
      check(`collision with an existing destination, ${mode}`, () =>
        go(args, { input: "y\n" }, (b) => at(b, "file")),
      );
      if (type === "mcp-servers") {
        it(`existing dangling link at the destination, ${mode} (deviation: R22(l))`, opts, () => {
          assert.equal(
            fs.existsSync(DANGLING_DIR),
            false,
            "the fixture link's directory is absent",
          );
          const t = go(args, { input: "y\n" }, (b) => at(b, "dangling"));
          const link = `link HOME:${cli.landing} -> ${DANGLING}`;
          // The shell prints `Merged:` and exits 0 although its redirect wrote nothing.
          assert.equal(t.shell.status, 0);
          assert.match(t.shell.stdout, /^\s*Merged: /m);
          // The TypeScript entry fails with exactly one `Error:` line and writes nothing.
          assert.equal(t.node.status, 1);
          assert.equal(t.node.stdout.includes("Merged:"), false);
          assert.equal(t.node.stderr.split("\n").filter((l) => l.startsWith("Error:")).length, 1);
          assert.equal(t.node.stderr.trimEnd().split("\n").length, 1);
          // The line names the link, its target and the corrective action (paths as scrubbed).
          const message = t.node.stderr.trimEnd();
          assert.ok(message.startsWith(`Error: <HOME>/${cli.landing} `), message);
          assert.ok(message.includes(`a symbolic link to ${DANGLING},`), message);
          assert.ok(
            message.includes(`create the directory ${DANGLING_DIR} or remove the link`),
            message,
          );
          for (const side of [t.shell, t.node]) {
            assert.ok(side.tree.includes(link), "the link is unchanged");
            assert.equal(side.tree.filter((l) => l.includes("mcp-config.json.bak")).length, 0);
            assert.equal(
              side.tree.filter((l) => l.startsWith("file ") && l.includes(`HOME:${cli.landing}`))
                .length,
              0,
            );
          }
          assert.equal(fs.existsSync(DANGLING_DIR), false, "nothing was created at the target");
        });
        check(`existing link to a missing file in an existing directory, ${mode}`, () =>
          go(args, { input: "y\n" }, (b) => at(b, "missing-file")),
        );
      } else {
        check(`existing dangling link at the destination, ${mode}`, () =>
          go(args, { input: "y\n" }, (b) => at(b, "dangling")),
        );
      }
    }
    for (const [label, input] of [
      ["y", "y\n"],
      ["n", "n\n"],
      ["other", "q\n"],
      ["eof", ""],
    ] as const) {
      const devs = label === "eof" && cliName !== "workspace" ? [EOF_NEWLINE] : []; // deviation: R22(c)/R22(m)
      check(
        devs.length > 0
          ? `link prompt answered ${label} (deviation: R22(c)/R22(m))`
          : `link prompt answered ${label}`,
        () => go(["link", type, "demo"], { input }),
        devs,
      );
    }
    check("link prompt: Y without newline", () => go(["link", type, "demo"], { input: "Y" }));
    check("trailing-slash name", () => go(["install", type, "demo/"]));
    check("trailing-slash name in link mode", () => go(["link", type, "demo/"], { input: "y\n" }));
  });
}

describe("manage: unlisted differences (findings)", () => {
  it("a JSON config written by the TypeScript leg keeps the shell's file mode", opts, () => {
    const cli = CLIS["copilot"]!;
    expectSame(twin(seed(cli), cli.script, ["install", "mcp-servers", "demo"]));
  });
  it("an invalid JSON config: one-line Error, nothing truncated", opts, () => {
    const cli = CLIS["copilot"]!;
    const t = twin(
      seed(cli, (b) => {
        fs.mkdirSync(`${b.home}/.copilot`);
        fs.writeFileSync(`${b.home}/.copilot/mcp-config.json`, "old\n");
      }),
      cli.script,
      ["install", "mcp-servers", "demo"],
    );
    // deviation: R22(e) jq's parse error becomes one `Error:` line; deviation: R22(f) the file is not truncated.
    assert.equal(t.node.status, 1);
    assert.match(t.node.stderr, /^Error: <HOME>\/\.copilot\/mcp-config\.json is not valid JSON/);
    assert.match(t.shell.stderr, /^jq: parse error/);
    assert.equal(t.shell.status, 0);
    assert.ok(t.shell.tree.includes('file 644 HOME:.copilot/mcp-config.json ""'));
    assert.ok(t.node.tree.some((l) => l.startsWith("file 644 HOME:.copilot/mcp-config.json ")));
  });
});
