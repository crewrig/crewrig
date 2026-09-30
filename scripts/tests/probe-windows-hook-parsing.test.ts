// probe-windows-hook-parsing.test.ts — tests for scripts/probe-windows-hook-parsing.ts
// (spec 0237, issue #1322).
//
// Every case runs against a temporary root and a temporary --home, so the
// real home directory is never touched. The probe itself is only ever run for
// real on a Windows host (docs/runbooks/windows-hook-parsing-probe.md); these
// tests pin its install / restore contract and its root resolution.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BACKUP_SUFFIX,
  CLIS,
  CONFIG_FILE,
  casesFor,
  mergeHooks,
  parseWmicList,
  redactEnv,
  type Cli,
} from "../probe-windows-hook-parsing.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROBE = path.join(REPO, "scripts", "probe-windows-hook-parsing.ts");

let tmp = "";
let root = "";
let home = "";

function run(
  script: string,
  args: string[],
  input = "",
): { status: number | null; out: string; err: string } {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args],
    { encoding: "utf8", input },
  );
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const kit = (): string => path.join(root, "kit", "probe.ts");
const cfg = (cli: Cli): string => path.join(home, ...CONFIG_FILE[cli]);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "probe-1322-"));
  root = path.join(tmp, "root");
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(root, "kit"), { recursive: true });
  fs.mkdirSync(home);
  fs.copyFileSync(PROBE, kit());
  const r = run(kit(), ["setup", "--home", home]);
  assert.equal(r.status, 0, r.err);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("install then restore", () => {
  for (const cli of CLIS) {
    test(`${cli}: a pre-existing file is byte-identical after restore`, () => {
      fs.mkdirSync(path.dirname(cfg(cli)), { recursive: true });
      const original = Buffer.from('{\n  "theme": "dark",\r\n  "x": 1\n}');
      fs.writeFileSync(cfg(cli), original);
      const i = run(kit(), ["install", cli]);
      assert.equal(i.status, 0, i.err);
      assert.match(fs.readFileSync(cfg(cli), "utf8"), /crewrig-probe/);
      assert.ok(fs.existsSync(`${cfg(cli)}${BACKUP_SUFFIX}`));
      const r = run(kit(), ["restore", cli]);
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(fs.readFileSync(cfg(cli)), original);
      assert.equal(fs.existsSync(`${cfg(cli)}${BACKUP_SUFFIX}`), false);
      assert.equal(run(kit(), ["verify-clean"]).status, 0);
    });

    test(`${cli}: an absent file is absent after restore, created dirs removed`, () => {
      const i = run(kit(), ["install", cli]);
      assert.equal(i.status, 0, i.err);
      assert.ok(fs.existsSync(cfg(cli)));
      const r = run(kit(), ["restore", cli]);
      assert.equal(r.status, 0, r.err);
      assert.equal(fs.existsSync(cfg(cli)), false);
      assert.deepEqual(fs.readdirSync(home), []);
      const v = run(kit(), ["verify-clean"]);
      assert.equal(v.status, 0, v.err);
      assert.equal(v.out.trim(), "clean");
    });
  }

  test("a second install without restore is refused", () => {
    assert.equal(run(kit(), ["install", "gemini"]).status, 0);
    const again = run(kit(), ["install", "gemini"]);
    assert.equal(again.status, 1);
    assert.match(again.err, /already installed/);
  });

  test("re-install after restore (the retry rule) is allowed", () => {
    assert.equal(run(kit(), ["install", "claude"]).status, 0);
    assert.equal(run(kit(), ["restore", "claude"]).status, 0);
    assert.equal(run(kit(), ["install", "claude"]).status, 0);
    assert.equal(run(kit(), ["restore", "claude"]).status, 0);
  });

  test("a restore mismatch exits non-zero and keeps the backup", () => {
    fs.mkdirSync(path.dirname(cfg("claude")), { recursive: true });
    fs.writeFileSync(cfg("claude"), "{}\n");
    assert.equal(run(kit(), ["install", "claude"]).status, 0);
    fs.writeFileSync(`${cfg("claude")}${BACKUP_SUFFIX}`, '{"tampered": true}\n');
    const r = run(kit(), ["restore", "claude"]);
    assert.equal(r.status, 1);
    assert.match(r.err, /MISMATCH/);
    assert.ok(fs.existsSync(`${cfg("claude")}${BACKUP_SUFFIX}`));
  });

  test("verify-clean detects a leftover probe entry", () => {
    fs.mkdirSync(path.dirname(cfg("antigravity")), { recursive: true });
    fs.writeFileSync(cfg("antigravity"), '{"crewrig-probe": {}}\n');
    const v = run(kit(), ["verify-clean"]);
    assert.equal(v.status, 1);
    assert.match(v.err, /still mentions crewrig-probe/);
  });
});

describe("root resolution (plan review v1-F2)", () => {
  test("records from every copy land in <root>/out/<cli>/ and collect finds them", () => {
    const copies = [
      ["kit", "probe.ts"],
      ["sp ace", "probe.ts"],
      ["proj", ".crewrig-probe", "probe.ts"],
    ];
    const ids = ["I", "Q0", "M"];
    copies.forEach((parts, n) => {
      const r = run(
        path.join(root, ...parts),
        ["record", "claude", ids[n] ?? "x", "tok"],
        '{"cwd":"C:/p","session_id":"s"}',
      );
      assert.equal(r.status, 0, r.err);
      assert.equal(r.out, "", "record must print nothing on stdout");
    });
    const files = fs.readdirSync(path.join(root, "out", "claude"));
    assert.equal(files.length, 3);
    const c = run(kit(), ["collect", "claude"]);
    assert.equal(c.status, 0, c.err);
    for (const id of ids) assert.match(c.out, new RegExp(`\\[${id}\\] launched=yes`));
    assert.match(c.out, /\[P\] launched=no/);
    const rec = JSON.parse(
      fs.readFileSync(path.join(root, "out", "claude", files[0] ?? ""), "utf8"),
    ) as { args: unknown; stdin: unknown };
    assert.deepEqual(rec.args, ["tok"]);
    assert.deepEqual(rec.stdin, { keys: ["cwd", "session_id"], values: { cwd: "C:/p" } });
  });
});

describe("installed JSON matches each committed manifest's shape", () => {
  const manifest = (cli: Cli): Record<string, unknown> =>
    JSON.parse(
      fs.readFileSync(path.join(REPO, "hooks", `${cli}-transcript-hooks.json`), "utf8"),
    ) as Record<string, unknown>;
  const keys = (o: unknown): string[] => Object.keys(o as object).sort();

  test("claude UserPromptSubmit group and entry keys", () => {
    const m = manifest("claude") as { hooks: { UserPromptSubmit: { hooks: object[] }[] } };
    const got = mergeHooks("claude", {}, casesFor("claude", "C:/r")) as typeof m;
    const mg = m.hooks.UserPromptSubmit[0];
    const gg = got.hooks.UserPromptSubmit[0];
    assert.deepEqual(keys(gg), keys(mg));
    assert.deepEqual(keys(gg?.hooks[0]), keys(mg?.hooks[0]));
  });

  test("gemini BeforeAgent group and entry keys", () => {
    const m = manifest("gemini") as { hooks: { BeforeAgent: { hooks: object[] }[] } };
    const got = mergeHooks("gemini", {}, casesFor("gemini", "C:/r")) as typeof m;
    assert.deepEqual(keys(got.hooks.BeforeAgent[0]), keys(m.hooks.BeforeAgent[0]));
    assert.deepEqual(
      keys(got.hooks.BeforeAgent[0]?.hooks[0]),
      keys(m.hooks.BeforeAgent[0]?.hooks[0]),
    );
  });

  test("copilot version and userPromptSubmitted entry keys", () => {
    const m = manifest("copilot") as { version: number; hooks: { userPromptSubmitted: object[] } };
    const got = mergeHooks("copilot", {}, casesFor("copilot", "C:/r")) as typeof m;
    assert.equal(got.version, m.version);
    assert.deepEqual(keys(got.hooks.userPromptSubmitted[0]), keys(m.hooks.userPromptSubmitted[0]));
    const alt = got.hooks.userPromptSubmitted.map((e) => keys(e).join(","));
    assert.ok(alt.includes("bash,type") && alt.includes("powershell,type"));
  });

  test("antigravity named hook with a flat Stop array", () => {
    const m = manifest("antigravity") as Record<string, { Stop?: object[] }>;
    const got = mergeHooks("antigravity", {}, casesFor("antigravity", "C:/r")) as typeof m;
    const stop = got["crewrig-probe"]?.Stop ?? [];
    assert.deepEqual(keys(stop[0]), keys(m["crewrig-mempalace-transcript"]?.Stop?.[0]));
  });
});

describe("case table", () => {
  test("one token per case entry (plan review v1-F1) and unique ids", () => {
    for (const cli of CLIS) {
      const cases = casesFor(cli, "C:/crewrig-probe");
      assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
      for (const c of cases.filter((x) => /^(Q[1-4]|E\d|P2|P3)/.test(x.id))) {
        const tail = c.command.split(` record ${cli} ${c.id} `)[1];
        assert.ok(tail !== undefined && tail.length > 0, `${c.id} carries its token`);
      }
    }
  });
});

describe("redaction", () => {
  test("secret-like keys are always redacted, other values omitted", () => {
    const env = redactEnv({
      GEMINI_API_KEY: "s3cr3t",
      CLAUDE_CODE_OAUTH_TOKEN: "t0k",
      CLAUDE_PROJECT_DIR: "C:\\p",
      COMSPEC: "C:\\WINDOWS\\system32\\cmd.exe",
      GOOGLE_CLOUD_PROJECT: "my-project",
    });
    assert.equal(env.GEMINI_API_KEY, "<redacted>");
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "<redacted>");
    assert.equal(env.CLAUDE_PROJECT_DIR, "C:\\p");
    assert.equal(env.COMSPEC, "C:\\WINDOWS\\system32\\cmd.exe");
    assert.equal(env.GOOGLE_CLOUD_PROJECT, "<omitted>");
  });
});

describe("install --only", () => {
  test("installs only the named cases and collect lists only those", () => {
    const i = run(kit(), ["install", "gemini", "--only", "I,Q3"]);
    assert.equal(i.status, 0, i.err);
    const installed = JSON.parse(fs.readFileSync(cfg("gemini"), "utf8")) as {
      hooks: { BeforeAgent: { hooks: { name: string }[] }[] };
    };
    const names = installed.hooks.BeforeAgent[0]?.hooks.map((h) => h.name);
    assert.deepEqual(names, ["crewrig-probe-I", "crewrig-probe-Q3"]);
    const c = run(kit(), ["collect", "gemini"]);
    assert.match(c.out, /\[I\] launched=no/);
    assert.doesNotMatch(c.out, /\[Q1\]/);
    assert.equal(run(kit(), ["restore", "gemini"]).status, 0);
  });

  test("an unknown case id is a usage error", () => {
    const i = run(kit(), ["install", "gemini", "--only", "I,nope"]);
    assert.equal(i.status, 2);
    assert.match(i.err, /unknown case/);
    assert.equal(fs.existsSync(cfg("gemini")), false);
  });
});

describe("parseWmicList", () => {
  test("parses blank-line separated Key=Value blocks, CRLF and empty values", () => {
    const text = [
      "",
      "",
      'CommandLine="C:\\Program Files\\Git\\bin\\bash.exe" -c "node a=b, c"\r\r',
      "ExecutablePath=C:\\Program Files\\Git\\bin\\bash.exe\r\r",
      "Name=bash.exe\r\r",
      "ParentProcessId=10\r\r",
      "ProcessId=20\r\r",
      "\r\r",
      "\r\r",
      "CommandLine=\r\r",
      "ExecutablePath=\r\r",
      "Name=System Idle Process\r\r",
      "ParentProcessId=0\r\r",
      "ProcessId=0\r\r",
      "",
    ].join("\n");
    const rows = parseWmicList(text);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      ProcessId: 20,
      ParentProcessId: 10,
      Name: "bash.exe",
      ExecutablePath: "C:\\Program Files\\Git\\bin\\bash.exe",
      CommandLine: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "node a=b, c"',
    });
    assert.equal(rows[1]?.CommandLine, null);
  });
});

describe("parseWmicList XML entities", () => {
  test("decodes the entities wmic's list stylesheet emits", () => {
    const rows = parseWmicList(
      'CommandLine=cmd /c "cd /d C:\\p &amp;&amp; x &lt;a&gt; &quot;q&quot; &apos;s&apos;"\r\r\nProcessId=7\r\r\nParentProcessId=1\r\r\n',
    );
    assert.equal(rows[0]?.CommandLine, `cmd /c "cd /d C:\\p && x <a> "q" 's'"`);
  });
});
