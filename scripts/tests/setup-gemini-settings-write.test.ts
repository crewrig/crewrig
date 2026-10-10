// Tests of `geminiSettingsWrite` and `explainGeminiRc` (spec 0256 requirements 27 and 31): the file
// side of the Gemini settings merge, over temporary homes, and one differential leg against the real
// `gemini_settings_write` of scripts/lib/gemini-settings.sh (needs bash and jq).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { SetupExit } from "../lib/setup/exit.ts";
import { explainGeminiRc, geminiSettingsWrite } from "../lib/setup/gemini-settings.ts";
import { REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const SEED = path.join(REPO, "config", "gemini", "settings.json");
const FAKE_REPO = "/fake/repo";
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Run {
  readonly rc: number;
  readonly out: string[];
  readonly err: string[];
  readonly target: string;
  readonly home: string;
}
type Servers = Record<string, { command: string; args: string[] }>;

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

function run(
  file: string | undefined,
  extra: {
    python?: string;
    org?: string;
    platform?: NodeJS.Platform;
    onOut?: (l: string, target: string) => void;
  } = {},
): Run {
  const { home, target } = setup(file);
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (line: string) => {
      out.push(line);
      extra.onOut?.(line, target);
    },
    err: (line: string) => void err.push(line),
  };
  const rc = geminiSettingsWrite({
    ctx: { io, platform: extra.platform ?? process.platform, home, repoDir: FAKE_REPO },
    settingsTarget: target,
    settingsSrc: SEED,
    python: extra.python ?? "",
    orgNative: extra.org,
  });
  return { rc, out, err, target, home };
}

const parsed = (r: Run): { mcpServers: Servers; [k: string]: unknown } =>
  JSON.parse(fs.readFileSync(r.target, "utf8")) as { mcpServers: Servers };
const backups = (r: Run): string[] =>
  fs.readdirSync(path.dirname(r.target)).filter((n) => n.startsWith("settings.json.bak."));

describe("geminiSettingsWrite", () => {
  test("a fresh home: file created, no backup, no warning, no mempalace without python", () => {
    const r = run(undefined);
    assert.equal(r.rc, 0);
    assert.deepEqual(r.out, []);
    assert.deepEqual(r.err, []);
    assert.deepEqual(backups(r), []);
    const servers = parsed(r).mcpServers;
    assert.equal("mempalace" in servers, false);
    assert.equal(servers.sequentialthinking?.command, "bash");
    assert.deepEqual(servers.sequentialthinking?.args.slice(0, 2), [
      `${FAKE_REPO}/scripts/lib/tls-exec.sh`,
      "npx",
    ]);
    assert.ok(fs.readFileSync(r.target, "utf8").endsWith("}\n"));
  });

  test("operator settings are kept, seeds are the union, python registers mempalace", () => {
    const r = run(
      '{"theme":"dark","general":{"previewFeatures":false},"mcpServers":{"mine":{"command":"m"}}}',
      {
        python: "/opt/py/bin/python3",
      },
    );
    assert.equal(r.rc, 0);
    const doc = parsed(r) as unknown as {
      theme: string;
      general: { previewFeatures: boolean };
      mcpServers: Servers;
    };
    assert.equal(doc.theme, "dark");
    assert.equal(doc.general.previewFeatures, false);
    assert.equal(doc.mcpServers["mine"]?.command, "m");
    assert.equal(doc.mcpServers["mempalace"]?.command, "bash");
    assert.deepEqual(doc.mcpServers["mempalace"]?.args.slice(0, 3), [
      `${FAKE_REPO}/scripts/lib/tls-exec.sh`,
      "/opt/py/bin/python3",
      `${FAKE_REPO}/scripts/lib/mempalace-http-wrapper.py`,
    ]);
    assert.match(r.out[0] ?? "", /^ {2}Backed up: settings\.json -> settings\.json\.bak\./);
    assert.equal(r.out.length, 1);
  });

  test("comments: a warning naming the backup, plain JSON out, the backup keeps the comments", () => {
    const original = '{\n // keep me out\n "theme": "dark"\n}\n';
    const r = run(original);
    assert.equal(r.rc, 0);
    const [bakName] = backups(r);
    assert.ok(bakName);
    const bak = path.join(path.dirname(r.target), bakName);
    assert.equal(fs.readFileSync(bak, "utf8"), original);
    assert.deepEqual(r.out.slice(1), [
      `  WARNING: ${r.target} holds comments; they are not kept in the rewritten file.`,
      `           They are preserved in the timestamped backup: ${bak}`,
    ]);
    const text = fs.readFileSync(r.target, "utf8");
    assert.ok(!text.includes("keep me out"));
    assert.equal(parsed(r)["theme"], "dark");
  });

  test("invalid JSON is replaced by a fresh configuration with a warning", () => {
    const r = run("not json at all");
    assert.equal(r.rc, 0);
    assert.match(r.out.join("\n"), /is not a JSON object, even with its comments removed/);
    assert.ok(parsed(r).mcpServers);
  });

  test("a failed read (the target is a directory) returns 1 and prints the shell's message", () => {
    const { home, target } = setup();
    fs.mkdirSync(target, { recursive: true });
    const err: string[] = [];
    const io = { out: () => undefined, err: (l: string) => void err.push(l) };
    const rc = geminiSettingsWrite({
      ctx: { io, platform: process.platform, home, repoDir: FAKE_REPO },
      settingsTarget: target,
      settingsSrc: SEED,
      python: "",
    });
    assert.equal(rc, 1);
    assert.deepEqual(err, [
      `  ERROR: the backup could not be created; ${target} was left unchanged.`,
    ]);
    assert.ok(fs.statSync(target).isDirectory());
  });

  test("a template that cannot be read returns 1, names the backup, leaves the file alone", () => {
    const { home, target } = setup('{"a":1}');
    const out: string[] = [];
    const err: string[] = [];
    const rc = geminiSettingsWrite({
      ctx: {
        io: { out: (l) => void out.push(l), err: (l) => void err.push(l) },
        platform: process.platform,
        home,
        repoDir: FAKE_REPO,
      },
      settingsTarget: target,
      settingsSrc: path.join(home, "missing.json"),
      python: "",
    });
    assert.equal(rc, 1);
    assert.equal(fs.readFileSync(target, "utf8"), '{"a":1}');
    const lines = err.join("\n").split("\n");
    assert.equal(lines.length, 2);
    assert.match(
      lines[0] ?? "",
      /could not be built from .*missing\.json; .* was left unchanged\.$/,
    );
    assert.match(lines[1] ?? "", /^ {9}The prior file is preserved in the timestamped backup: /);
  });

  test("org native servers are folded in, framework names win", () => {
    const r = run('{"mcpServers":{"b":{"command":"old"}}}', {
      org: '{"b":{"command":"new"},"mempalace":{"command":"z"}}',
      python: "py",
    });
    assert.equal(r.rc, 0);
    const servers = parsed(r).mcpServers;
    assert.equal(servers["b"]?.command, "new");
    assert.equal(servers["mempalace"]?.command, "bash");
    assert.match(r.out.join("\n"), /org-declared MCP server 'b' overrides your pre-existing 'b'/);
    assert.match(r.out.join("\n"), /the org declaration for 'mempalace' was NOT applied/);
  });

  test("the backup is made and printed before the file changes", () => {
    const original = '{"theme":"x"} // c';
    const seen: { line: string; target: string; backups: number }[] = [];
    const r = run(original, {
      onOut: (line, target) => {
        const dir = path.dirname(target);
        const baks = fs.readdirSync(dir).filter((n) => n.startsWith("settings.json.bak."));
        seen.push({ line, target: fs.readFileSync(target, "utf8"), backups: baks.length });
      },
    });
    assert.equal(r.rc, 0);
    assert.ok(seen.length >= 3);
    for (const s of seen) {
      assert.equal(
        s.target,
        original,
        "the target still holds the old bytes when a line is printed",
      );
      assert.equal(s.backups, 1, "the backup exists from the first printed line");
    }
    assert.match(seen[0]?.line ?? "", /^ {2}Backed up: /);
    assert.notEqual(fs.readFileSync(r.target, "utf8"), original);
  });

  test("mode 0600 off win32, backup included", { skip: WINDOWS }, () => {
    const r = run('{"a":1}');
    assert.equal(fs.statSync(r.target).mode & 0o777, 0o600);
    const [bakName] = backups(r);
    assert.equal(fs.statSync(path.join(path.dirname(r.target), bakName ?? "")).mode & 0o777, 0o600);
    const leftovers = fs.readdirSync(path.dirname(r.target)).filter((n) => n.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  test("a stale <target>.tmp that cannot be removed returns 2 with the merged file in place", () => {
    const { home, target } = setup('{"theme":"x"}');
    fs.mkdirSync(`${target}.tmp`);
    fs.writeFileSync(path.join(`${target}.tmp`, "keep"), "x");
    const err: string[] = [];
    const rc = geminiSettingsWrite({
      ctx: {
        io: { out: () => undefined, err: (l) => void err.push(l) },
        platform: process.platform,
        home,
        repoDir: FAKE_REPO,
      },
      settingsTarget: target,
      settingsSrc: SEED,
      python: "",
    });
    assert.equal(rc, 2);
    assert.equal((JSON.parse(fs.readFileSync(target, "utf8")) as { theme: string }).theme, "x");
    assert.equal(
      err[0],
      `  ERROR: ${target} holds the merged settings, but removing the stale ${target}.tmp did not complete.`,
    );
    assert.match(err[1] ?? "", /The prior file is preserved in the timestamped backup: /);
  });

  test("win32 seam: npx.cmd and the node trust wrapper in the profile", () => {
    const r = run(undefined, { python: "py", platform: "win32" });
    assert.equal(r.rc, 0);
    const wrapper = path.win32.join(r.home, ".crewrig", "tls-exec.ts");
    const servers = parsed(r).mcpServers;
    assert.equal(servers["sequentialthinking"]?.command, "node");
    assert.deepEqual(servers["sequentialthinking"]?.args.slice(0, 2), [wrapper, "npx.cmd"]);
    assert.equal(servers["mempalace"]?.command, "node");
    assert.deepEqual(servers["mempalace"]?.args.slice(0, 2), [wrapper, "py"]);
  });
});

describe("explainGeminiRc", () => {
  const call = (rc: number): { err: string[]; status: number | undefined } => {
    const err: string[] = [];
    try {
      explainGeminiRc(rc, { err: (l) => void err.push(l) });
      return { err, status: undefined };
    } catch (error) {
      assert.ok(error instanceof SetupExit);
      return { err, status: error.status };
    }
  };
  test("0 is silent, 2 and others print the setup's message and exit 1", () => {
    assert.deepEqual(call(0), { err: [], status: undefined });
    assert.deepEqual(call(2), {
      err: [
        "  settings.json was merged but its MCP servers are incomplete — setup aborted. Re-run this script.",
      ],
      status: 1,
    });
    assert.deepEqual(call(1), {
      err: ["  settings.json was not changed — setup aborted."],
      status: 1,
    });
    assert.equal(call(7).status, 1);
  });
});
