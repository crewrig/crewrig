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
  mergeStatusLine,
  parseExit,
  parseWmicList,
  redactEnv,
  STATUSLINE_CASES,
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

// The statusLine surface is a single slot: it is installed one case at a time
// (see the "antigravity-statusline" suite), never as a whole table.
const HOOK_CLIS = CLIS.filter((c) => c !== "antigravity-statusline");

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
  for (const cli of HOOK_CLIS) {
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

describe("antigravity-statusline", () => {
  const settings = (): string => cfg("antigravity-statusline");

  test("targets ~/.gemini/antigravity-cli/settings.json, not the hooks surface", () => {
    assert.deepEqual(CONFIG_FILE["antigravity-statusline"], [
      ".gemini",
      "antigravity-cli",
      "settings.json",
    ]);
    assert.notDeepEqual(CONFIG_FILE["antigravity-statusline"], CONFIG_FILE.antigravity);
  });

  test("the case table is exactly I Q0 Q1 Q4 P P2d", () => {
    assert.deepEqual(
      casesFor("antigravity-statusline", "C:/r").map((c) => c.id),
      ["I", "Q0", "Q1", "Q4", "P", "P2d"],
    );
    assert.deepEqual([...STATUSLINE_CASES], ["I", "Q0", "Q1", "Q4", "P", "P2d"]);
  });

  test("mergeStatusLine sets exactly one statusLine.command and keeps the rest", () => {
    const [one] = casesFor("antigravity-statusline", "C:/r");
    assert.ok(one !== undefined);
    const merged = mergeStatusLine(
      { theme: "dark", statusLine: { type: "command", command: "echo old", padding: 1 } },
      [one],
    );
    assert.deepEqual(merged, {
      theme: "dark",
      statusLine: { type: "command", command: one.command, padding: 1 },
    });
    assert.deepEqual(mergeStatusLine({}, [one]), { statusLine: { command: one.command } });
    assert.deepEqual(mergeHooks("antigravity-statusline", {}, [one]), {
      statusLine: { command: one.command },
    });
  });

  test("mergeStatusLine refuses zero or several cases", () => {
    const cases = casesFor("antigravity-statusline", "C:/r");
    assert.throws(() => mergeStatusLine({}, []), /--only <id>/);
    assert.throws(() => mergeStatusLine({}, cases), /--only <id>/);
  });

  test("install without --only, or with several ids, is a usage error that writes nothing", () => {
    for (const args of [
      ["install", "antigravity-statusline"],
      ["install", "antigravity-statusline", "--only", "I,Q1"],
    ]) {
      const r = run(kit(), args);
      assert.equal(r.status, 2);
      assert.match(r.err, /holds one statusLine\.command/);
    }
    assert.equal(fs.existsSync(settings()), false);
    assert.equal(run(kit(), ["verify-clean"]).status, 0);
  });

  test("install --only writes one command, restore is byte-identical, then the next case", () => {
    fs.mkdirSync(path.dirname(settings()), { recursive: true });
    const original = Buffer.from(
      '{\n  "theme": "dark",\r\n  "statusLine": {"command": "echo hi"}\n}',
    );
    fs.writeFileSync(settings(), original);
    for (const id of STATUSLINE_CASES) {
      const i = run(kit(), ["install", "antigravity-statusline", "--only", id]);
      assert.equal(i.status, 0, i.err);
      const got = JSON.parse(fs.readFileSync(settings(), "utf8")) as {
        theme: string;
        statusLine: { command: string };
      };
      assert.equal(got.theme, "dark");
      const expected = casesFor("antigravity-statusline", fs.realpathSync(root)).find(
        (c) => c.id === id,
      );
      assert.equal(got.statusLine.command, expected?.command);
      assert.match(got.statusLine.command, new RegExp(` record antigravity-statusline ${id}\\b`));
      const r = run(kit(), ["restore", "antigravity-statusline"]);
      assert.equal(r.status, 0, r.err);
      assert.deepEqual(fs.readFileSync(settings()), original);
    }
    assert.equal(run(kit(), ["verify-clean"]).status, 0);
  });

  test("a record lands in out/antigravity-statusline and collect lists the whole table", () => {
    const r = run(kit(), ["record", "antigravity-statusline", "Q1", "a b"], '{"cwd":"C:/p"}');
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out, "");
    assert.equal(fs.readdirSync(path.join(root, "out", "antigravity-statusline")).length, 1);
    assert.equal(run(kit(), ["install", "antigravity-statusline", "--only", "I"]).status, 0);
    const c = run(kit(), ["collect", "antigravity-statusline"]);
    assert.match(c.out, /\[Q1\] launched=yes/);
    assert.match(c.out, /\[P2d\] launched=no/);
    assert.equal(run(kit(), ["restore", "antigravity-statusline"]).status, 0);
  });
});

describe("record --exit (case X1, spec 0243 R12)", () => {
  test("X1 is in the hook CLIs' tables with exactly `--exit 1`, and not on the statusLine surface", () => {
    for (const cli of HOOK_CLIS) {
      const x1 = casesFor(cli, "C:/r").find((c) => c.id === "X1");
      assert.ok(x1 !== undefined, cli);
      assert.match(x1.command, new RegExp(` record ${cli} X1 --exit 1$`));
    }
    assert.equal(
      casesFor("antigravity-statusline", "C:/r").some((c) => c.id === "X1"),
      false,
    );
  });

  test("parseExit honours 0, 1 and 3-255, never emits 2, and strips the flag from args", () => {
    assert.deepEqual(parseExit(["a", "--exit", "1"]), { args: ["a"], exit: 1, error: null });
    assert.deepEqual(parseExit([]), { args: [], exit: 0, error: null });
    assert.equal(parseExit(["--exit", "255"]).exit, 255);
    assert.equal(parseExit(["--exit", "0"]).exit, 0);
    for (const bad of ["2", "256", "-1", "x", "1.5", "0x1"]) {
      const p = parseExit(["--exit", bad]);
      assert.equal(p.exit, 0, bad);
      assert.match(p.error ?? "", /refused/);
    }
    const missing = parseExit(["--exit"]);
    assert.equal(missing.exit, 0);
    assert.match(missing.error ?? "", /refused/);
  });

  test("record --exit 1 writes the complete record, prints nothing and exits 1", () => {
    const r = run(kit(), ["record", "claude", "X1", "--exit", "1"], "{}");
    assert.equal(r.status, 1);
    assert.equal(r.out, "");
    const dir = path.join(root, "out", "claude");
    const rec = JSON.parse(
      fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0] ?? ""), "utf8"),
    ) as { args: unknown; exitRequested: number; stdin: unknown; parentChain: unknown };
    assert.deepEqual(rec.args, []);
    assert.equal(rec.exitRequested, 1);
    assert.deepEqual(rec.stdin, { keys: [], values: {} });
    assert.match(run(kit(), ["collect", "claude"]).out, /exit status requested: 1/);
  });

  test("record --exit 2 is refused: exit 0 and the refusal is recorded", () => {
    const r = run(kit(), ["record", "claude", "X1", "--exit", "2"], "");
    assert.equal(r.status, 0);
    assert.match(run(kit(), ["collect", "claude"]).out, /exitError: --exit 2 refused/);
  });

  test("without --exit the record still exits 0", () => {
    assert.equal(run(kit(), ["record", "gemini", "I"], "").status, 0);
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
