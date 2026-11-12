// skill-scripts-tester-probe-tool.test.ts — black-box test of tester/scripts/probe-tool.ts
// (spec 0298 R2, R3, R4, R8), written from the spec: each probe outcome, the --json shape,
// --help, exits 2 and 3, and a run from a copy of the whole skill directory under every
// package layout. The tools probed are tiny executables written to a throwaway directory; no
// network is involved.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SKILL_DIR = path.join(REPO, "artifacts", "core", "skills", "tester");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tester-probe-tool-")));
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the fixtures must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface Envelope {
  ok: boolean;
  data: {
    tool: string;
    subcommand: string | null;
    available: boolean;
    probes: {
      command: string;
      outcome: string;
      exit_code: number | null;
      stderr_first_line: string;
    }[];
  } | null;
  findings: { rule: string; message: string }[];
}

// A bin directory with sh-script tools; it is the only entry of PATH, plus the node directory.
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
const tool = (name: string, body: string, mode = 0o755): void => {
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
  fs.chmodSync(path.join(bin, name), mode);
};
tool(
  "fullcli",
  'case "$1" in\n  --help|--version) echo "fullcli 1.0"; exit 0;;\n  export) if [ "$2" = "--help" ]; then echo "usage: fullcli export"; exit 0; fi;;\nesac\necho "fullcli: unknown command" >&2\nexit 2',
);
tool(
  "versiononly",
  'case "$1" in\n  --version) echo "1.0"; exit 0;;\nesac\necho "usage: versiononly --version" >&2\nexit 2',
);
tool("nohelp", 'echo "usage: nohelp <thing>" >&2\nexit 2');
tool("slow", "exec /bin/sleep 5");
fs.writeFileSync(path.join(bin, "plainfile"), "not executable\n");
fs.chmodSync(path.join(bin, "plainfile"), 0o644);

const ENV = {
  HOME: root,
  PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
  LC_ALL: "C",
};
const run = (
  args: readonly string[],
  opts: { skillDir?: string; env?: Record<string, string> } = {},
): Run => {
  const r = spawnSync(
    process.execPath,
    [path.join(opts.skillDir ?? SKILL_DIR, "scripts", "probe-tool.ts"), ...args],
    {
      cwd: root,
      env: opts.env ?? ENV,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const envelope = (r: Run): Envelope => {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, `expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
};

describe("probe-tool: probe outcomes", () => {
  test("a tool whose help exits 0 is available after one probe", () => {
    const r = run(["fullcli", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const env = envelope(r);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    assert.equal(env.data?.available, true);
    assert.deepEqual(
      env.data?.probes.map((p) => [p.command, p.outcome]),
      [["fullcli --help", "ok"]],
    );
  });

  test("a subcommand is probed with its own help flag", () => {
    const r = run(["fullcli", "export", "--json"]);
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.subcommand, "export");
    assert.equal(envelope(r).data?.probes[0]?.command, "fullcli export --help");
  });

  test("help fails but --version works: available, both probes listed", () => {
    const r = run(["versiononly", "--json"]);
    assert.equal(r.status, 0);
    assert.deepEqual(
      envelope(r).data?.probes.map((p) => [p.command, p.outcome]),
      [
        ["versiononly --help", "exit 2"],
        ["versiononly --version", "ok"],
      ],
    );
  });

  test("help and version both exit non-zero: exit 1, the finding quotes the command, the code and stderr", () => {
    const r = run(["nohelp", "--json"]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data?.available, false);
    assert.deepEqual(
      env.findings.map((f) => f.rule),
      ["unavailable"],
    );
    const m = env.findings[0]?.message ?? "";
    assert.match(m, /`nohelp --version` gave exit 2/);
    assert.match(m, /stderr: "usage: nohelp <thing>"/);
    assert.match(m, /minimal real invocation/);
    assert.equal(
      env.data?.probes.at(-1)?.outcome,
      "found",
      "the PATH lookup is a precursor, not proof",
    );
  });

  test("an unknown subcommand of an existing tool is unavailable", () => {
    const r = run(["fullcli", "nosuchsub", "--json"]);
    assert.equal(r.status, 1);
    assert.match(envelope(r).findings[0]?.message ?? "", /`fullcli nosuchsub --help` gave exit 2/);
  });

  test("a missing tool is reported command not found, both probes and the lookup", () => {
    const r = run(["nosuchtool", "--json"]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.deepEqual(
      env.data?.probes.map((p) => p.outcome),
      ["command not found", "command not found", "not found"],
    );
    assert.match(env.findings[0]?.message ?? "", /gave command not found/);
  });

  test("a file that is not executable is not found by the lookup", () => {
    const r = run(["plainfile", "--json"]);
    assert.equal(r.status, 1);
    assert.equal(envelope(r).data?.probes.at(-1)?.outcome, "not found");
  });

  test("a probe that outlasts --timeout is reported timed out", () => {
    const r = run(["slow", "--timeout", "1", "--json"]);
    assert.equal(r.status, 1);
    assert.equal(envelope(r).data?.probes[0]?.outcome, "timed out");
    assert.match(envelope(r).findings[0]?.message ?? "", /gave timed out/);
  });

  test("a tool given by path is probed directly", () => {
    const r = run([path.join(bin, "fullcli"), "--json"]);
    assert.equal(r.status, 0);
  });
});

describe("probe-tool: output and usage", () => {
  test("without --json the probes and the verdict go to stdout, nothing to stderr", () => {
    const r = run(["fullcli"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ok\s+fullcli --help/);
    assert.match(r.stdout, /probe-tool\.ts: fullcli is available/);
    assert.equal(r.stderr, "");
  });

  test("--json on a failure: ok false, every finding carries rule and message, text on stderr", () => {
    const r = run(["nosuchtool", "--json"]);
    const env = envelope(r);
    assert.equal(env.ok, false);
    for (const f of env.findings) {
      assert.ok(f.rule.length > 0);
      assert.ok(f.message.length > 0);
    }
    assert.match(r.stderr, /nosuchtool is unavailable/);
  });

  test("--help prints the usage on stdout, nothing on stderr, exit 0", () => {
    const r = run(["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage: node probe-tool\.ts <tool>/);
    assert.equal(r.stderr, "");
  });

  test("no tool, an empty tool, an unknown option, a bad timeout and an extra argument exit 2", () => {
    for (const args of [
      [],
      [""],
      ["--nope", "git"],
      ["git", "--timeout", "0"],
      ["git", "--timeout"],
      ["a", "b", "c"],
    ]) {
      const r = run(args);
      assert.equal(r.status, 2, JSON.stringify(args));
      assert.equal(r.stdout, "", JSON.stringify(args));
      assert.match(r.stderr, /probe-tool\.ts:/);
    }
  });

  test("--json on exit 2 still prints the object: ok false, data null, rule usage", () => {
    const r = run(["--nope", "--json"]);
    assert.equal(r.status, 2);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.deepEqual(
      env.findings.map((f) => f.rule),
      ["usage"],
    );
  });

  test("a bare tool name with PATH unset exits 3 with rule precondition", () => {
    const r = run(["git", "--json"], { env: { HOME: root, LC_ALL: "C" } });
    assert.equal(r.status, 3);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.deepEqual(
      env.findings.map((f) => f.rule),
      ["precondition"],
    );
  });

  test("the script writes nothing", () => {
    const before = fs.readdirSync(root).sort();
    run(["nosuchtool"]);
    assert.deepEqual(fs.readdirSync(root).sort(), before);
  });
});

describe("probe-tool from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    test(`layout ${layout}: runs with no Node warning`, () => {
      const dir = path.join(root, "copies", layout, "tester");
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(SKILL_DIR, dir, { recursive: true });
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);

      const r = run(["nohelp", "--json"], { skillDir: dir });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.doesNotMatch(r.stderr, WARNING);
      assert.deepEqual(
        envelope(r).findings.map((f) => f.rule),
        ["unavailable"],
      );
      const help = run(["--help"], { skillDir: dir });
      assert.equal(help.status, 0);
      assert.equal(help.stderr, "");
    });
  }
});
