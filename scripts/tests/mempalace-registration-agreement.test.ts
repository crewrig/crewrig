// mempalace-registration-agreement.test.ts — spec 0246 R3/R4 as amended by
// delta-01, R16 (issue #1410; plan v4 step 8; seat findings v4-F5, v4-F6).
//
// Two readers classify a CLI's `mempalace` registration:
//   - the shell `mcp_assistant_arrangement` (scripts/lib/common.sh), which
//     `task mempalace:status` runs under the operator's `jq`;
//   - the check's `parseStrict` + `classifyStrict`
//     (scripts/lib/mempalace-registration.ts), which never runs `jq`.
// On every STRICT file they must agree (`ok`/`wrong-endpoint` ↔ `http`,
// `stdio` ↔ `stdio`, `absent` ↔ `none`, `unrecognised` ↔ `unknown`), and the
// status side's endpoint comparison must print the check's redacted URL. On a
// file that is NOT strict only the check side is asserted: `unrecognised`, with
// the not-strict warning (delta R5).
//
// The shell side runs under every distinct `jq` the machine has (PATH's, plus
// /usr/bin/jq), so a maintainer's macOS run covers jq-1.7.1-apple and
// Homebrew's jq-1.8.2 together, and CI covers its own.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  COMMON_SH,
  CLIS,
  type Cli,
  JQ_BINARIES,
  REPO,
  SENTINEL,
  assertNoCliInvoked,
  assertStatusProbesStubbed,
  bashLib,
  emittedWarning,
  makeSandbox,
  run,
  runCheck,
  shq,
  startFakeServer,
  writeConfig,
  writeLauncher,
  type Sandbox,
} from "./lib/session-check-harness.ts";
import {
  type Classification,
  classifyFile,
  classifyStrict,
  displayPath,
  parseLauncher,
  parseStrict,
  warningFor,
} from "../lib/mempalace-registration.ts";

/** The expected endpoint every strict fixture is classified against. */
const E = "http://127.0.0.1:41999/mcp";
const WRONG = "http://u:SE@NT@127.0.0.1:41000/mcp?k=SECRET";

const STATUS_OF: Record<Classification["class"], string> = {
  ok: "http",
  "wrong-endpoint": "http",
  stdio: "stdio",
  absent: "none",
  unrecognised: "unknown",
};

// --- the jq binaries the shell side runs under -------------------------------

interface JqVariant {
  /** Absolute path of the binary. */
  bin: string;
  version: string;
}

function jqVariants(): JqVariant[] {
  return JQ_BINARIES.map((bin) => {
    const v = spawnSync(bin, ["--version"], { encoding: "utf8" });
    return { bin, version: (v.stdout || v.stderr).trim() };
  });
}

const JQS = jqVariants();

// --- fixtures -------------------------------------------------------------------

const json = (v: unknown): string => JSON.stringify(v);
const nest = (n: number, open: string, close: string, inner = "0"): string =>
  open.repeat(n) + inner + close.repeat(n);
const nestObj = (n: number): string => '{"a":'.repeat(n) + "0" + "}".repeat(n);
const httpEntry = (key: "url" | "serverUrl", url: string): Record<string, unknown> =>
  key === "url"
    ? { type: "http", url, headers: { Authorization: `Bearer ${SENTINEL}` } }
    : { serverUrl: url, headers: { Authorization: `Bearer ${SENTINEL}` } };
const servers = (entryText: string): string => `"mcpServers":{"mempalace":${entryText}}`;

interface StrictFixture {
  name: string;
  /** Raw file text for one registration key. */
  text(key: "url" | "serverUrl"): string;
  /** Whether the text depends on the key (run once per key). */
  keyed: boolean;
}

const s = (name: string, text: string): StrictFixture => ({ name, text: () => text, keyed: false });
const k = (name: string, text: (key: "url" | "serverUrl") => string): StrictFixture => ({
  name,
  text,
  keyed: true,
});

/** Delta R16: every entry case R4 maps for a strict file, depth exactly 64, and the edge cases of the seat's v4 pass. */
const STRICT: StrictFixture[] = [
  k("ok", (key) => `{${servers(json(httpEntry(key, E)))}}`),
  k("wrong endpoint", (key) => `{${servers(json(httpEntry(key, WRONG)))}}`),
  k("url null", (key) => `{${servers(json({ [key]: null }))}}`),
  k("url 5 with command", (key) => `{${servers(json({ [key]: 5, command: "x" }))}}`),
  k("url as an array", (key) => `{${servers(json({ [key]: [E] }))}}`),
  k("url and command", (key) => `{${servers(json({ [key]: E, command: "x" }))}}`),
  s("serverUrl not a string, url correct", `{${servers(json({ serverUrl: 5, url: E }))}}`),
  // delta-02 R3: one compared value, `.url // .serverUrl`, in both orders of correctness.
  s("url correct, serverUrl wrong", `{${servers(json({ url: E, serverUrl: WRONG }))}}`),
  s("url wrong, serverUrl correct", `{${servers(json({ url: WRONG, serverUrl: E }))}}`),
  s("url null, serverUrl correct", `{${servers(json({ url: null, serverUrl: E }))}}`),
  s("url false, serverUrl correct", `{${servers(json({ url: false, serverUrl: E }))}}`),
  s("url 5, serverUrl correct", `{${servers(json({ url: 5, serverUrl: E }))}}`),
  s("serverUrl before url, url correct", `{${servers(`{"serverUrl":"${WRONG}","url":"${E}"}`)}}`),
  s(
    "stdio",
    `{${servers(json({ command: "/usr/bin/python3", args: ["-m", "mempalace.mcp_server"] }))}}`,
  ),
  s("command null", `{${servers(json({ command: null }))}}`),
  s("no mempalace entry", `{"mcpServers":{"other":{"command":"x"}}}`),
  s("mcpServers empty", `{"mcpServers":{}}`),
  s("mempalace false", `{${servers("false")}}`),
  s("mempalace null", `{${servers("null")}}`),
  s("mcpServers null", `{"mcpServers":null}`),
  s("top-level {}", "{}"),
  s('entry "s"', `{${servers('"s"')}}`),
  s("entry 0", `{${servers("0")}}`),
  s("entry []", `{${servers("[]")}}`),
  s("entry true", `{${servers("true")}}`),
  s("entry {}", `{${servers("{}")}}`),
  k(
    "duplicate mempalace keys, stdio then http",
    (key) => `{"mcpServers":{"mempalace":{"command":"x"},"mempalace":${json(httpEntry(key, E))}}}`,
  ),
  k(
    "duplicate mempalace keys, http then stdio",
    (key) => `{"mcpServers":{"mempalace":${json(httpEntry(key, E))},"mempalace":{"command":"x"}}}`,
  ),
  k(
    "duplicate url keys inside the entry",
    (key) => `{${servers(`{"${key}":"${WRONG}","${key}":"${E}"}`)}}`,
  ),
  k("__proto__ at the top level", (key) => `{"__proto__":{${servers(json(httpEntry(key, E)))}}}`),
  k(
    "__proto__ in mcpServers",
    (key) => `{"mcpServers":{"__proto__":{"mempalace":${json(httpEntry(key, E))}}}}`,
  ),
  k("__proto__ in the entry", (key) => `{${servers(`{"__proto__":{"${key}":"${E}"}}`)}}`),
  k("1e400 elsewhere in the file", (key) => `{"n":1e400,${servers(json(httpEntry(key, E)))}}`),
  k(
    "arrays nested to depth exactly 64",
    (key) => `{"deep":${nest(63, "[", "]")},${servers(json(httpEntry(key, E)))}}`,
  ),
  k(
    "objects nested to depth exactly 64",
    (key) => `{"deep":${nestObj(63)},${servers(json(httpEntry(key, E)))}}`,
  ),
  k(
    "valid surrogate pair and an escaped backslash-u",
    (key) => `{"e":"\\ud83d\\ude00","b":"\\\\ud800",${servers(json(httpEntry(key, E)))}}`,
  ),
];

// --- shell side, batched -----------------------------------------------------

interface Case {
  id: number;
  fixture: string;
  key: "url" | "serverUrl" | "-";
  home: string;
  bytes: Buffer;
}

/** One HOME per (fixture, key), holding the same file at all four CLI paths. */
function buildCases(sb: Sandbox, fixtures: StrictFixture[]): Case[] {
  const cases: Case[] = [];
  for (const f of fixtures) {
    for (const key of f.keyed ? (["url", "serverUrl"] as const) : (["-"] as const)) {
      const id = cases.length;
      const home = path.join(sb.root, "homes", String(id));
      const bytes = Buffer.from(f.text(key === "-" ? "url" : key), "utf8");
      for (const cli of CLIS) {
        const file = path.join(home, configRel(cli));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes, { mode: 0o600 });
      }
      cases.push({ id, fixture: f.name, key, home, bytes });
    }
  }
  return cases;
}

function configRel(cli: Cli): string {
  return {
    claude: ".claude.json",
    gemini: ".gemini/settings.json",
    copilot: ".copilot/mcp-config.json",
    antigravity: ".gemini/config/mcp_config.json",
  }[cli];
}

/** `<id> <cli> <arrangement> <endpoint-check line or ->` for every case, under one jq. */
function shellReadings(
  sb: Sandbox,
  cases: Case[],
  jq: JqVariant,
): Map<string, { state: string; check: string }> {
  const script = `
. ${shq(COMMON_SH)}
printf 'JQ\\t%s\\n' "$(jq --version 2>&1)"
while IFS='\t' read -r id home; do
  for cli in claude gemini copilot antigravity; do
    st="$(HOME="$home" mcp_assistant_arrangement "$cli")"
    chk="-"
    if [ "$st" = http ]; then chk="$(HOME="$home" _mcp_endpoint_check "$cli" ${shq(E)})"; fi
    printf '%s\\t%s\\t%s\\t%s\\n' "$id" "$cli" "$st" "$chk"
  done
done`;
  const input = cases.map((c) => `${c.id}\t${c.home}\n`).join("");
  const r = spawnSync("bash", ["-c", script], {
    env: sb.env({ PATH: sb.pathWithJq(jq.bin) }),
    input,
    encoding: "utf8",
    cwd: sb.root,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  const out = new Map<string, { state: string; check: string }>();
  for (const line of r.stdout.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("JQ\t")) {
      assert.equal(line.slice(3), jq.version, `the shell ran another jq than ${jq.bin}`);
      continue;
    }
    const [id, cli, state, ...rest] = line.split("\t");
    out.set(`${id}/${cli}`, { state: state ?? "", check: rest.join("\t") });
  }
  return out;
}

/** What `_mcp_endpoint_check` must print for the check's classification. */
function expectedCheckLine(c: Classification): string {
  if (c.class === "ok") return `match\t${E}`;
  if (c.class === "wrong-endpoint") return `mismatch\t${c.registered}`;
  return "-";
}

describe("R4 agreement over strict fixtures (delta-01)", () => {
  test("the jq binaries under test, by absolute path", (t) => {
    assert.ok(JQS.length > 0, "no jq on PATH: the shell reader cannot run");
    for (const jq of JQS) t.diagnostic(`jq --version (${jq.bin}): ${jq.version}`);
  });

  for (const jq of JQS) {
    test(`both readers agree on every strict fixture, for all four CLIs, under ${jq.version}`, (t) => {
      const sb = makeSandbox();
      const cases = buildCases(sb, STRICT);
      t.diagnostic(`jq --version: ${jq.version}; ${cases.length} files x ${CLIS.length} CLIs`);

      const shell = shellReadings(sb, cases, jq);

      const disagreements: string[] = [];
      for (const c of cases) {
        assert.ok(parseStrict(c.bytes).strict, `fixture "${c.fixture}" is meant to be strict`);
        for (const cli of CLIS) {
          // What the check itself runs: Gemini's file goes through comment removal (delta-02 R4).
          const cls = classifyFile({ kind: "ok", bytes: c.bytes }, E, cli);
          const got = shell.get(`${c.id}/${cli}`);
          const want = { state: STATUS_OF[cls.class], check: expectedCheckLine(cls) };
          if (got === undefined || got.state !== want.state || got.check !== want.check) {
            disagreements.push(
              `${c.fixture} [${c.key}] ${cli}: check ${JSON.stringify(cls)} -> ${JSON.stringify(want)}, status ${JSON.stringify(got)}`,
            );
          }
        }
      }
      assert.deepEqual(disagreements, []);
      assertNoCliInvoked(sb);
    });
  }

  test("the strict corpus reaches every class and both unrecognised entry shapes", () => {
    const classes = new Set<string>();
    for (const f of STRICT) {
      const parsed = parseStrict(Buffer.from(f.text("url")));
      assert.ok(parsed.strict, f.name);
      classes.add(classifyStrict(parsed.value, E).class);
    }
    assert.deepEqual([...classes].sort(), [
      "absent",
      "ok",
      "stdio",
      "unrecognised",
      "wrong-endpoint",
    ]);
  });
});

// --- not strict: check side only (delta-01 R4, R5, R16) ----------------------------

const MS = servers(json(httpEntry("url", E)));

/** Every kind delta R4 lists as not strict, each carrying a correct HTTP entry where the structure allows one. */
const NON_STRICT: Array<[string, Buffer]> = [
  ["empty file", Buffer.alloc(0)],
  ["whitespace only", Buffer.from(" \n\t\r\n")],
  ["truncated", Buffer.from(`{${MS}`)],
  ["two concatenated documents", Buffer.from(`{${MS}}\n{${MS}}\n`)],
  ["NaN", Buffer.from(`{"n":NaN,${MS}}`)],
  ["nan", Buffer.from(`{"n":nan,${MS}}`)],
  ["Infinity", Buffer.from(`{"n":Infinity,${MS}}`)],
  ["-Infinity", Buffer.from(`{"n":-Infinity,${MS}}`)],
  ["leading zero 01", Buffer.from(`{"n":01,${MS}}`)],
  [
    "invalid UTF-8 0xFF",
    Buffer.concat([Buffer.from(`{"n":"`), Buffer.from([0xff]), Buffer.from(`",${MS}}`)]),
  ],
  [
    "leading byte order mark",
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{${MS}}`)]),
  ],
  ["trailing garbage", Buffer.from(`{${MS}} x`)],
  ["a // comment", Buffer.from(`// registration\n{${MS}}`)],
  ["top-level null", Buffer.from("null")],
  ["top-level false", Buffer.from("false")],
  ["top-level true", Buffer.from("true")],
  ["top-level []", Buffer.from(`[{${MS}}]`)],
  ["top-level 5", Buffer.from("5")],
  // delta-02 R4: an mcpServers that is neither an object nor null.
  ['mcpServers "s"', Buffer.from('{"mcpServers":"s"}')],
  ["mcpServers []", Buffer.from('{"mcpServers":[]}')],
  ["mcpServers false", Buffer.from('{"mcpServers":false}')],
  ["mcpServers true", Buffer.from('{"mcpServers":true}')],
  ["mcpServers 0", Buffer.from('{"mcpServers":0}')],
  ["mcpServers 5", Buffer.from('{"mcpServers":5}')],
  // delta-02 R4: a trailing comma, in any CLI's file.
  ["trailing comma", Buffer.from(`{${MS},}`)],
  ['top-level "s"', Buffer.from('"s"')],
  ["arrays nested to depth 65", Buffer.from(`{"deep":${nest(64, "[", "]")},${MS}}`)],
  ["objects nested to depth 65", Buffer.from(`{"deep":${nestObj(64)},${MS}}`)],
  ["lone high surrogate in a value", Buffer.from(`{"v":"\\ud800",${MS}}`)],
  ["lone low surrogate in a value", Buffer.from(`{"v":"\\udc00",${MS}}`)],
  ["lone high surrogate in a member name", Buffer.from(`{"\\ud800":1,${MS}}`)],
  ["lone low surrogate in a member name", Buffer.from(`{"\\udc00":1,${MS}}`)],
  [
    "high surrogate followed by a non-surrogate escape",
    Buffer.from(`{"v":"\\ud800\\u0041",${MS}}`),
  ],
  // v4-F6: a violation inside a value that a later duplicate key overwrites.
  ["overwritten value holding a lone high surrogate", Buffer.from(`{"a":"\\ud800","a":1,${MS}}`)],
  [
    "overwritten object whose member name is a lone high surrogate",
    Buffer.from(`{"o":{"\\ud800":1},"o":{},${MS}}`),
  ],
  ["overwritten value holding a lone low surrogate", Buffer.from(`{"a":"\\udc00","a":1,${MS}}`)],
  ["overwritten arrays nested 300 deep", Buffer.from(`{"a":${nest(300, "[", "]")},"a":1,${MS}}`)],
  ["overwritten objects nested 200 deep", Buffer.from(`{"a":${nestObj(200)},"a":1,${MS}}`)],
  ["overwritten arrays nested 70 deep", Buffer.from(`{"a":${nest(70, "[", "]")},"a":1,${MS}}`)],
];

/** Delta R5's not-strict warning, as R16 asks it to be asserted. */
function assertNotStrictWarning(
  w: string | null,
  cli: Cli,
  shownPath: string,
  label: string,
): void {
  assert.ok(w !== null, `${label}: no warning`);
  assert.ok(Buffer.byteLength(w) <= 600, `${label}: ${Buffer.byteLength(w)} bytes`);
  assert.ok(w.includes(cli), `${label}: CLI not named: ${w}`);
  assert.ok(w.includes(shownPath), `${label}: path ${shownPath} not named: ${w}`);
  assert.ok(w.includes("not a single strict JSON document"), `${label}: ${w}`);
  assert.ok(/rewrite it as one/i.test(w), `${label}: no rewrite instruction: ${w}`);
  assert.ok(w.includes(".bak"), `${label}: no .bak backups: ${w}`);
  assert.ok(w.includes("task mempalace:switch-http"), `${label}: ${w}`);
  // delta-02 R5: the rewrite advice covers mcpServers, and comes before switch-http.
  const advice = w.indexOf('by making "mcpServers" an object');
  assert.ok(advice >= 0, `${label}: no advice to make mcpServers an object: ${w}`);
  assert.ok(
    advice < w.indexOf("task mempalace:switch-http"),
    `${label}: switch-http precedes the rewrite advice: ${w}`,
  );
  assert.ok(!w.includes("mempalace:repair"), `${label}: names the repair (s4-F1): ${w}`);
}

describe("files that are not strict: unrecognised, with the not-strict warning (delta-01 R4, R5)", () => {
  test("every kind is classified unrecognised/non-strict, on every CLI", () => {
    for (const [name, bytes] of NON_STRICT) {
      for (const cli of CLIS) {
        // Comment removal is Gemini's alone (delta-02 R4): there the comment row is strict.
        if (cli === "gemini" && name === "a // comment") continue;
        const c = classifyFile({ kind: "ok", bytes }, E, cli);
        const shown = `~/${configRel(cli)}`;

        const w = warningFor(cli, c, { serving: true, expected: E, config: shown });

        assert.deepEqual(
          [c.class, "reason" in c ? c.reason : undefined],
          ["unrecognised", "non-strict"],
          `${cli} ${name}`,
        );
        assertNotStrictWarning(w, cli, shown, `${cli} ${name}`);
      }
    }
  });

  test("end to end on Copilot, BOM and invalid UTF-8 in the same run: the check warns, never names the repair", async () => {
    const server = await startFakeServer("auth-refusal");
    try {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      const failures: string[] = [];
      for (const [name, bytes] of NON_STRICT) {
        writeConfig(sb, "copilot", bytes);

        const r = await runCheck(sb, "copilot");

        try {
          assert.equal(r.status, 0);
          assertNotStrictWarning(
            emittedWarning(r.stdout),
            "copilot",
            "~/.copilot/mcp-config.json",
            name,
          );
          assert.ok(!r.stdout.includes(SENTINEL));
        } catch (e) {
          failures.push(`${name}: ${(e as Error).message}`);
        }
      }
      assert.deepEqual(failures, []);
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });

  test("a leading BOM stays not strict when either guard is removed (s4-F2)", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`{${MS}}`)]);

    assert.equal(
      parseStrict(bytes, { bomByteCheck: false, ignoreBOM: true }).strict,
      false,
      "decoder guard alone",
    );
    assert.equal(
      parseStrict(bytes, { bomByteCheck: true, ignoreBOM: false }).strict,
      false,
      "byte check alone",
    );
    // With both guards off the BOM is silently stripped: proof that each guard above did the work.
    assert.equal(parseStrict(bytes, { bomByteCheck: false, ignoreBOM: false }).strict, true);
  });

  test("the not-strict warning stays within 600 bytes under a 200-character HOME", async () => {
    const server = await startFakeServer("auth-refusal");
    try {
      const sb = makeSandbox();
      const longHome = path.join(sb.root, "h".repeat(200 - sb.root.length - 1));
      assert.equal(longHome.length, 200);
      fs.mkdirSync(longHome);
      const env = { HOME: longHome };
      for (const cli of CLIS) {
        const file = path.join(longHome, configRel(cli));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from("{} {}"));
        const shown = displayPath(file, longHome);

        assertNotStrictWarning(
          warningFor(
            cli,
            { class: "unrecognised", reason: "non-strict" },
            { serving: true, expected: E, config: shown },
          ),
          cli,
          shown,
          cli,
        );
      }
      writeLauncherAt(longHome, server.port);
      const r = await runCheck(sb, "claude", { env });
      assert.equal(r.status, 0);
      const w = emittedWarning(r.stdout);
      assertNotStrictWarning(w, "claude", "~/.claude.json", "claude end to end");
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });
});

function writeLauncherAt(home: string, port: number): void {
  const file = path.join(home, ".crewrig", "mcp-daemon-launcher.sh");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `MCP_HOST="127.0.0.1"\nMCP_PORT="${port}"\n`);
}

// --- Gemini with comments: outside the agreement scope (delta-02 R4, R5) ------------

describe("a Gemini file with comments is classified on its content after comment removal (delta-02 R4)", () => {
  const WRAPS: Array<[string, (text: string) => string]> = [
    [
      "line, block and unclosed block comments",
      (t) => `// line comment\n/* block */${t} /* never closed`,
    ],
    [
      "CRLF line endings",
      (t) => `// line comment\r\n/* block\r\n spanning lines */\r\n${t}\r\n// tail\r\n`,
    ],
    [
      "comment markers between members and inside strings",
      (t) => {
        const rest = t.slice(1);
        const pad = '{ /* lead */ "pad": "// in a string /* too */" // eol\n';
        return pad + (rest.trimStart().startsWith("}") ? rest : `,${rest}`);
      },
    ],
  ];
  const wrap = (text: string): string => (WRAPS[0] as [string, (t: string) => string])[1](text);

  test("every strict fixture, commented, keeps its class on Gemini and is flagged when not ok", () => {
    const failures: string[] = [];
    for (const [variant, w] of WRAPS) {
      for (const f of STRICT) {
        const label = `${f.name} [${variant}]`;
        const plain = Buffer.from(f.text("url"));
        const commented = Buffer.from(w(f.text("url")));
        const before = classifyFile({ kind: "ok", bytes: plain }, E, "gemini");

        const after = classifyFile({ kind: "ok", bytes: commented }, E, "gemini");

        const { comments, ...rest } = after;
        if (JSON.stringify(rest) !== JSON.stringify(before)) {
          failures.push(`${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        }
        if ((comments === true) !== (before.class !== "ok"))
          failures.push(`${label}: comments flag ${String(comments)}`);
        // Only Gemini strips comments: on every other CLI the same bytes are not strict.
        for (const cli of ["claude", "copilot", "antigravity"] as const) {
          const c = classifyFile({ kind: "ok", bytes: commented }, E, cli);
          if (c.class !== "unrecognised" || c.reason !== "non-strict")
            failures.push(`${label}: accepted on ${cli}`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });

  test("a commented Gemini file that is not ok names the Gemini setup, never a jq-based task", () => {
    for (const f of STRICT) {
      const c = classifyFile({ kind: "ok", bytes: Buffer.from(wrap(f.text("url"))) }, E, "gemini");
      if (c.class === "ok") continue;

      const w =
        warningFor("gemini", c, {
          serving: true,
          expected: E,
          config: "~/.gemini/settings.json",
        }) ?? "";

      assert.ok(
        w.includes("scripts/setup-gemini-interactive.sh") &&
          /comment/i.test(w) &&
          /backup/i.test(w),
        `${f.name}: ${w}`,
      );
      assert.ok(!w.includes("switch-http") && !w.includes("mempalace:repair"), `${f.name}: ${w}`);
      assert.ok(Buffer.byteLength(w) <= 600, f.name);
    }
  });

  test("mcpServers null is absent on every CLI; [] and 5 are not strict (delta-02 R3, R4)", () => {
    for (const cli of CLIS) {
      const read = (t: string) => classifyFile({ kind: "ok", bytes: Buffer.from(t) }, E, cli);

      assert.deepEqual(read('{"mcpServers":null}'), { class: "absent", reason: "no-entry" }, cli);
      for (const bad of ['{"mcpServers":[]}', '{"mcpServers":5}']) {
        const c = read(bad);
        assert.deepEqual(
          [c.class, "reason" in c ? c.reason : undefined],
          ["unrecognised", "non-strict"],
          `${cli} ${bad}`,
        );
      }
    }
  });

  test("a trailing comma is not strict on Gemini, with or without comments", () => {
    for (const t of [
      `{${MS},}`,
      `// c\n{${MS},}`,
      `{"mcpServers":{"mempalace":${json(httpEntry("url", E))},}}`,
    ]) {
      const c = classifyFile({ kind: "ok", bytes: Buffer.from(t) }, E, "gemini");
      assert.deepEqual(
        [c.class, "reason" in c ? c.reason : undefined],
        ["unrecognised", "non-strict"],
        t,
      );
    }
  });

  test("status reads a commented Gemini file as unknown, unchanged (delta-02 Out of scope)", () => {
    const sb = makeSandbox();
    writeConfig(sb, "gemini", wrap(`{"mcpServers":{"mempalace":${json(httpEntry("url", E))}}}`));

    const st = bashLib(sb, "mcp_assistant_arrangement gemini").stdout.trim();

    assert.equal(st, "unknown");
  });
});

// --- content: strict file, unknown entry shape (delta-01 R5) ---------------------

describe("a strict file with an unknown entry shape points at the repair (delta-01 R5)", () => {
  test('entries "s", 0, [], true and {} warn with task mempalace:repair and status reads unknown', () => {
    const sb = makeSandbox();
    for (const entry of ['"s"', "0", "[]", "true", "{}"]) {
      for (const cli of CLIS) {
        writeConfig(sb, cli, `{${servers(entry)}}\n`);
        const parsed = parseStrict(fs.readFileSync(sb.config(cli)));
        assert.ok(parsed.strict);
        const cls = classifyStrict(parsed.value, E);

        const w = warningFor(cli, cls, {
          serving: true,
          expected: E,
          config: `~/${configRel(cli)}`,
        });
        const st = bashLib(sb, `mcp_assistant_arrangement ${cli}`).stdout.trim();

        assert.deepEqual(cls, { class: "unrecognised", reason: "content" }, `${cli} ${entry}`);
        assert.ok(
          w !== null && w.includes(cli) && w.includes("task mempalace:repair"),
          `${cli} ${entry}: ${w}`,
        );
        assert.ok(!w.includes("not a single strict JSON document"), w);
        assert.equal(st, "unknown", `${cli} ${entry}`);
      }
    }
    assertNoCliInvoked(sb);
  });
});

// --- wrong endpoint against a non-default launcher (R4, R16) ------------------

describe("a launcher on a non-default port: both readers report wrong-endpoint (R4)", () => {
  test("the check and task mempalace:status agree, with the same redacted URL, whatever MEMPALACE_MCP_PORT says", async () => {
    const server = await startFakeServer("auth-refusal");
    try {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      const registered = "http://127.0.0.1:41000/mcp";
      const env = { MEMPALACE_MCP_PORT: "41000", MEMPALACE_MCP_HOST: "127.0.0.1" };
      for (const cli of CLIS)
        writeConfig(sb, cli, {
          mcpServers: {
            mempalace: httpEntry(cli === "antigravity" ? "serverUrl" : "url", registered),
          },
        });

      const report = bashLib(
        sb,
        `mcp_report_assistant_arrangements serving "$(mcp_installed_endpoint)"`,
        { env },
      );

      const expected = `http://127.0.0.1:${server.port}/mcp`;
      for (const cli of CLIS) {
        assert.match(
          report.stdout,
          new RegExp(
            `^  ${cli} +http \\(WRONG ENDPOINT: registered ${escapeRe(registered)}, expected ${escapeRe(expected)}\\)$`,
            "m",
          ),
          report.stdout,
        );
      }
      for (const cli of ["claude", "gemini", "copilot"] as const) {
        const r = await runCheck(sb, cli, { env });
        const w = emittedWarning(r.stdout);
        assert.ok(
          w !== null &&
            w.includes("wrong-endpoint") &&
            w.includes(registered) &&
            w.includes(expected),
          `${cli}: ${w}`,
        );
        assert.ok(w.includes("task mempalace:switch-http"), w);
      }
      assert.ok(server.requests.every((q) => q.url === "/mcp"));
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });

  test("status-mcp-server.sh reports the launcher's endpoint, not the environment's", async () => {
    const server = await startFakeServer("auth-refusal");
    try {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      writeConfig(sb, "copilot", {
        mcpServers: { mempalace: httpEntry("url", "http://127.0.0.1:41000/mcp") },
      });

      // Async: the fake server lives in this process and must keep answering.
      const r = await run("bash", [path.join(REPO, "scripts", "status-mcp-server.sh")], {
        env: sb.env({ MEMPALACE_MCP_PORT: "41000" }),
        cwd: sb.root,
        timeoutMs: 30_000,
      });

      assert.match(
        r.stdout,
        new RegExp(`endpoint: http://127\\.0\\.0\\.1:${server.port}/mcp`),
        r.stdout + r.stderr,
      );
      assert.match(
        r.stdout,
        /copilot +http \(WRONG ENDPOINT: registered http:\/\/127\.0\.0\.1:41000\/mcp, expected /,
      );
      assert.ok(
        server.requests.some((q) => q.url === "/healthz"),
        "status never reached the fake server",
      );
      assertStatusProbesStubbed(sb, r.stdout, server.port);
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });

  // Security review #1474 [LOW]: status may only aim at a loopback launcher host.
  // Otherwise the host falls back to the environment/default one; the port
  // still comes from the launcher (R4: the installed endpoint).
  for (const host of ["example.invalid", "127.999.0.1", "127.0.0.256", "127.1", "127.0.0.01"]) {
    test(`status-mcp-server.sh never targets non-loopback launcher host ${host}`, async () => {
      const server = await startFakeServer("auth-refusal");
      try {
        const sb = makeSandbox();
        writeLauncher(sb, server.port, host);

        const r = await run("bash", [path.join(REPO, "scripts", "status-mcp-server.sh")], {
          env: sb.env({ MEMPALACE_MCP_HOST: "127.0.0.1" }),
          cwd: sb.root,
          timeoutMs: 30_000,
        });

        assert.match(
          r.stdout,
          new RegExp(`^  endpoint: http://127\\.0\\.0\\.1:${server.port}/mcp$`, "m"),
          r.stdout + r.stderr,
        );
        assert.ok(
          !r.stdout.includes(host) && !r.stderr.includes(host),
          `the launcher host reached status output: ${r.stdout}`,
        );
        assert.ok(
          server.requests.some((q) => q.url === "/healthz"),
          "status never probed the fallback host",
        );
        assertStatusProbesStubbed(sb, r.stdout, server.port);
        assertNoCliInvoked(sb);
      } finally {
        await server.close();
      }
    });
  }

  test("status-mcp-server.sh keeps a loopback launcher host", async () => {
    const server = await startFakeServer("auth-refusal");
    try {
      const sb = makeSandbox();
      writeLauncher(sb, server.port, "127.0.0.1");

      const r = await run("bash", [path.join(REPO, "scripts", "status-mcp-server.sh")], {
        env: sb.env({ MEMPALACE_MCP_HOST: "example.invalid" }),
        cwd: sb.root,
        timeoutMs: 30_000,
      });

      assert.match(
        r.stdout,
        new RegExp(`endpoint: http://127\\.0\\.0\\.1:${server.port}/mcp`),
        r.stdout,
      );
      assert.ok(!r.stdout.includes("example.invalid"), r.stdout);
      assertStatusProbesStubbed(sb, r.stdout, server.port);
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });
});

function escapeRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- the expected endpoint: one launcher, two readers (R1, R4) ----------------------

const hostCase = (h: string): string => `MCP_HOST="${h}"\nMCP_PORT="41000"\n`;
const portCase = (p: string): string => `MCP_HOST="127.0.0.1"\nMCP_PORT="${p}"\n`;

/** Hand-edited and malformed launchers: both readers must find the same endpoint, or none. */
const LAUNCHERS: Array<[string, string | Buffer]> = [
  ["materialised", 'X=1\nMCP_HOST="127.0.0.1"\nMCP_PORT="41000"\n'],
  ["unsubstituted placeholders", 'MCP_HOST="__MCP_HOST__"\nMCP_PORT="__MCP_PORT__"\n'],
  ["port 0", portCase("0")],
  ["port 1", portCase("1")],
  ["port 65535", portCase("65535")],
  ["port 65536", portCase("65536")],
  ["port 99999", portCase("99999")],
  ["port 100000", portCase("100000")],
  ["port with a leading zero", portCase("041893")],
  ["port 00", portCase("00")],
  ["port +1", portCase("+1")],
  ["port with a space", portCase("41 000")],
  ["empty port", portCase("")],
  ["trailing comment after the port", 'MCP_HOST="127.0.0.1"\nMCP_PORT="41000" # x\n'],
  ["trailing comment after the host", 'MCP_HOST="127.0.0.1" # pinned\nMCP_PORT="41000"\n'],
  ["unterminated port, then a good one", 'MCP_HOST="h"\nMCP_PORT="41000\nMCP_PORT="2"\n'],
  ["unterminated host, then a good one", 'MCP_HOST="x\nMCP_HOST="y"\nMCP_PORT="2"\n'],
  ["the first host line wins, even when bad", 'MCP_HOST="a b"\nMCP_HOST="good"\nMCP_PORT="2"\n'],
  ["an indented line is ignored", '  MCP_HOST="h"\nMCP_HOST="k"\nMCP_PORT="2"\n'],
  ["host [::1]", hostCase("[::1]")],
  ["host ::1", hostCase("::1")],
  ["host a]b-c", hostCase("a]b-c")],
  ["host my_host (underscore)", hostCase("my_host")],
  ["host with a space", hostCase("a b")],
  ["host with a slash", hostCase("h/x")],
  ["host with an @", hostCase("u@h")],
  ["empty host", hostCase("")],
  ["host of 64 characters", hostCase("a".repeat(64))],
  ["host of 65 characters", hostCase("a".repeat(65))],
  ["non-ASCII host", hostCase("hé")],
  ["fullwidth host", hostCase("Ａ")],
  [
    "host holding an invalid UTF-8 byte",
    Buffer.concat([
      Buffer.from('MCP_HOST="h'),
      Buffer.from([0xff]),
      Buffer.from('"\nMCP_PORT="2"\n'),
    ]),
  ],
  ["CRLF line endings", 'MCP_HOST="127.0.0.1"\r\nMCP_PORT="41000"\r\n'],
  ["a value holding a CR", 'MCP_HOST="a\rb"\nMCP_HOST="ok"\nMCP_PORT="2"\n'],
  ["a lone CR before the key", 'MCP_HOST="h"\nX=1\rMCP_PORT="2"\n'],
  ["U+2028 before the key", 'MCP_HOST="h"\nX=1 MCP_PORT="2"\n'],
  ["no port line", 'MCP_HOST="h"\n'],
  ["placeholder host, real port", 'MCP_HOST="__MCP_HOST__"\nMCP_PORT="41893"\n'],
  [
    "the repository template verbatim",
    fs.readFileSync(path.join(REPO, "scripts", "lib", "mcp-daemon-launcher.sh")),
  ],
  [
    "the repository template with only the port substituted",
    fs
      .readFileSync(path.join(REPO, "scripts", "lib", "mcp-daemon-launcher.sh"), "utf8")
      .replace("__MCP_PORT__", "41893"),
  ],
  ["host with a leading underscore", hostCase("_h")],
  ["host with a trailing underscore", hostCase("h_")],
  ["a lone CR before the key, valid host", 'MCP_HOST="127.0.0.1"\nX=1\rMCP_PORT="41000"\n'],
  ["U+2029 before the key", 'MCP_HOST="h"\nX=1\u2029MCP_PORT="2"\n'],
];

describe("parseLauncher and mcp_installed_endpoint read the same endpoint (R1, R4)", () => {
  test("every launcher case gives the same endpoint, or none, in both readers", () => {
    const sb = makeSandbox();
    const files = LAUNCHERS.map(([name, text], i) => {
      const file = path.join(sb.root, "launchers", `${i}.sh`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return { name, file, bytes: fs.readFileSync(file) };
    });
    const script =
      `. ${shq(COMMON_SH)}\n` +
      `while IFS= read -r f; do printf '%s\\n' "$(MEMPALACE_MCP_LAUNCHER_PATH="$f" mcp_installed_endpoint)"; done`;

    const r = spawnSync("bash", ["-c", script], {
      env: sb.env(),
      input: files.map((f) => `${f.file}\n`).join(""),
      encoding: "utf8",
      cwd: sb.root,
    });

    assert.equal(r.status, 0, r.stderr);
    const shell = r.stdout.split("\n").slice(0, files.length);
    const diffs = files
      .map(
        (f, i) =>
          [f.name, parseLauncher(f.bytes.toString("utf8"))?.url ?? "", shell[i] ?? ""] as const,
      )
      .filter(([, ts, sh]) => ts !== sh)
      .map(
        ([name, ts, sh]) =>
          `${name}: parseLauncher ${JSON.stringify(ts)}, mcp_installed_endpoint ${JSON.stringify(sh)}`,
      );
    assert.deepEqual(diffs, []);
    // The table must exercise both outcomes, or agreement proves nothing.
    assert.ok(shell.some((u) => u !== "") && shell.some((u) => u === ""));
    for (const name of [
      "port 0",
      "port 99999",
      "port with a leading zero",
      "host my_host (underscore)",
      "unsubstituted placeholders",
    ]) {
      const i = LAUNCHERS.findIndex(([n]) => n === name);
      assert.equal(shell[i], "", `${name} must mean no installed daemon`);
    }
    assertNoCliInvoked(sb);
  });
});

// --- redaction parity (v1-F3, v3-F2, v4-F5) ------------------------------------

interface Vector {
  name: string;
  input: string;
  expected: string;
}

const VECTORS = (
  JSON.parse(
    fs.readFileSync(
      path.join(REPO, "scripts", "tests", "fixtures", "session-check", "redaction-vectors.json"),
      "utf8",
    ),
  ) as {
    vectors: Vector[];
  }
).vectors;

describe("one redaction, two implementations (redaction-vectors.json)", () => {
  for (const jq of JQS) {
    test(`_mcp_endpoint_check prints every vector byte-identical to the check, under ${jq.version}`, () => {
      const sb = makeSandbox();
      const fixtures = VECTORS.map((v) =>
        s(v.name, json({ mcpServers: { mempalace: { type: "http", url: v.input } } })),
      );
      // A non-string URL prints the shared placeholder on both sides (seat DEV note).
      fixtures.push(
        s("url not a string", json({ mcpServers: { mempalace: { type: "http", url: 5 } } })),
      );
      const cases = buildCases(sb, fixtures);

      const shell = shellReadings(sb, cases, jq);

      const diffs: string[] = [];
      for (const c of cases) {
        const parsed = parseStrict(c.bytes);
        assert.ok(parsed.strict, c.fixture);
        const cls = classifyStrict(parsed.value, E);
        const vector = VECTORS.find((v) => v.name === c.fixture);
        if (vector !== undefined) {
          assert.deepEqual(
            cls,
            { class: "wrong-endpoint", registered: vector.expected },
            c.fixture,
          );
        }
        const got = shell.get(`${c.id}/copilot`);
        if (got?.check !== expectedCheckLine(cls))
          diffs.push(
            `${c.fixture}: check ${JSON.stringify(expectedCheckLine(cls))}, status ${JSON.stringify(got?.check)}`,
          );
      }
      assert.deepEqual(diffs, []);
    });
  }

  test("a credential in the userinfo or the query never reaches the check's warning or the status line", async () => {
    const server = await startFakeServer("auth-refusal");
    try {
      const sb = makeSandbox();
      writeLauncher(sb, server.port);
      writeConfig(sb, "copilot", { mcpServers: { mempalace: httpEntry("url", WRONG) } });

      const r = await runCheck(sb, "copilot");
      const status = bashLib(
        sb,
        `mcp_report_assistant_arrangements serving "$(mcp_installed_endpoint)"`,
      );

      const w = emittedWarning(r.stdout) ?? "";
      for (const secret of ["SE@NT", "u:SE", "SECRET", SENTINEL]) {
        assert.ok(!w.includes(secret), `warning leaks ${secret}: ${w}`);
        assert.ok(!status.stdout.includes(secret), `status leaks ${secret}: ${status.stdout}`);
      }
      assert.ok(w.includes("http://127.0.0.1:41000/mcp"));
      assert.match(status.stdout, /registered http:\/\/127\.0\.0\.1:41000\/mcp,/);
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });
});
