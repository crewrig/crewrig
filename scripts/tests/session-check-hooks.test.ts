// session-check-hooks.test.ts — the session-check writer (spec 0246 R9, R11,
// delta-01 R11 *Platform*; plan v4 steps 5 and 8, v3 step 9).
//
// Black box: scripts/session-check-hooks.ts runs as a child process against a
// scratch HOME (session-check-harness.ts). The coexistence cases drive the REAL
// session-recording and usage-capture writers of scripts/lib/usage-capture-optin.sh
// and the Antigravity transcript deploy of scripts/lib/common.sh, in both orders.
// The check's entry is recognised here by the plan's command template, written
// independently of the writer's own matcher.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  type Cli,
  CLIS,
  REPO,
  WRITER_TS,
  assertNoCliInvoked,
  bashLib,
  hookCommand,
  makeSandbox,
  run,
  shq,
  writeFileDeep,
  type Sandbox,
} from "./lib/session-check-harness.ts";
import {
  ANTIGRAVITY_SESSION_CHECK,
  SESSION_CHECK_CHANNELS,
} from "../lib/mempalace-registration.ts";

type Obj = Record<string, unknown>;

const HOOK_NAME = "crewrig-mempalace-session-check";
const CHECK_MARK = "/session-check/mempalace-session-check.ts";

/** Whether `register <cli>` must write an entry on a supported platform. */
function registrable(cli: Cli): boolean {
  if (cli === "antigravity") return ANTIGRAVITY_SESSION_CHECK.registered;
  const ch = SESSION_CHECK_CHANNELS[cli];
  return ch.user !== null || ch.model !== null;
}

function hookFile(sb: Sandbox, cli: Cli): string {
  switch (cli) {
    case "claude":
      return path.join(sb.home, ".claude", "settings.json");
    case "gemini":
      return path.join(sb.home, ".gemini", "settings.json");
    case "copilot":
      return path.join(sb.home, ".copilot", "hooks", `${HOOK_NAME}.json`);
    case "antigravity":
      return path.join(sb.home, ".gemini", "config", "hooks.json");
  }
}

function installedCheck(sb: Sandbox): string {
  return path.join(sb.home, ".crewrig", "hooks", "session-check", "mempalace-session-check.ts");
}

/** The exact command the writer must register (plan v4 *Contracts*). */
function expectedCommand(sb: Sandbox, cli: Cli): string {
  return hookCommand(installedCheck(sb), cli, process.execPath);
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const mentionsCheck = (h: unknown): boolean =>
  isObj(h) && typeof h.command === "string" && h.command.includes(CHECK_MARK);

/** Every handler of a hook document, flattened over grouped and flat shapes. */
function handlers(cli: Cli, doc: Obj): Obj[] {
  const out: Obj[] = [];
  const events: Obj[] =
    cli === "antigravity" ? Object.values(doc).filter(isObj) : isObj(doc.hooks) ? [doc.hooks] : [];
  for (const ev of events) {
    for (const list of Object.values(ev)) {
      if (!Array.isArray(list)) continue;
      for (const el of list) {
        if (isObj(el) && Array.isArray(el.hooks)) out.push(...el.hooks.filter(isObj));
        else if (isObj(el)) out.push(el);
      }
    }
  }
  return out;
}

const checkHandlers = (cli: Cli, doc: Obj): Obj[] => handlers(cli, doc).filter(mentionsCheck);

/** The document with the check's handlers removed and emptied containers pruned. */
function withoutCheck(cli: Cli, doc: Obj): Obj {
  if (cli === "antigravity") {
    const { [HOOK_NAME]: _ours, ...rest } = doc;
    return rest;
  }
  if (!isObj(doc.hooks)) return doc;
  const hooks: Obj = {};
  for (const [ev, list] of Object.entries(doc.hooks)) {
    if (!Array.isArray(list)) {
      hooks[ev] = list;
      continue;
    }
    const kept: unknown[] = [];
    for (const el of list) {
      if (isObj(el) && Array.isArray(el.hooks)) {
        const hs = el.hooks.filter((h) => !mentionsCheck(h));
        if (hs.length > 0 || el.hooks.length === 0) kept.push({ ...el, hooks: hs });
      } else if (!mentionsCheck(el)) kept.push(el);
    }
    if (kept.length > 0 || list.length === 0) hooks[ev] = kept;
  }
  // A `hooks` map the removal emptied goes too: the writer may have created it.
  if (Object.keys(hooks).length === 0 && Object.keys(doc.hooks).length > 0) {
    const { hooks: _emptied, ...rest } = doc;
    return rest;
  }
  return { ...doc, hooks };
}

function readJson(file: string): Obj {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Obj;
}

function backups(file: string): string[] {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(
    `^${path.basename(file).replace(/\./g, "\\.")}\\.bak\\.\\d{8}-\\d{6}(\\.\\d{2})?$`,
  );
  return fs
    .readdirSync(dir)
    .filter((n) => re.test(n))
    .map((n) => path.join(dir, n));
}

const mode = (file: string): number => fs.statSync(file).mode & 0o777;

async function writer(sb: Sandbox, action: "register" | "unregister", cli: Cli, platform?: string) {
  const args = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", WRITER_TS, action, cli];
  if (platform !== undefined) args.push("--platform", platform);
  return run(process.execPath, args, { env: sb.env(), cwd: sb.root });
}

/** Operator content each hook file starts with: other hooks on the same event, other events, other keys. */
function operatorDoc(cli: Cli): Obj {
  const op = (c: string): Obj => ({ type: "command", command: c });
  switch (cli) {
    case "claude":
      return {
        model: "opus",
        env: { FOO: "1" },
        hooks: {
          SessionStart: [{ matcher: "startup", hooks: [op("echo operator-start")] }],
          Stop: [{ matcher: "", hooks: [op("echo operator-stop")] }],
        },
      };
    case "gemini":
      return {
        mcpServers: { other: { command: "other-server" } },
        hooks: { SessionStart: [{ hooks: [{ name: "operator", ...op("echo operator-start") }] }] },
      };
    case "copilot":
      return {
        version: 1,
        hooks: { sessionStart: [op("echo operator-start")], sessionEnd: [op("echo bye")] },
      };
    case "antigravity":
      return { "operator-hook": { PreInvocation: [op("echo operator")] } };
  }
}

/** An operator's own handlers that merely resemble the check: never ours (R11 content identity). */
function lookAlikes(sb: Sandbox, cli: Cli): Obj[] {
  const other: Cli = cli === "claude" ? "gemini" : "claude";
  return [
    { type: "command", command: `node /opt/tools${CHECK_MARK} ${cli}` },
    { type: "command", command: `${expectedCommand(sb, cli)} # operator copy` },
    { type: "command", command: expectedCommand(sb, other) },
  ];
}

function withLookAlikes(sb: Sandbox, cli: Cli, doc: Obj): Obj {
  const extra = lookAlikes(sb, cli);
  const copy = structuredClone(doc);
  if (cli === "antigravity") return { ...copy, "operator-lookalike": { PreInvocation: extra } };
  const hooks = copy.hooks as Obj;
  if (cli === "copilot") hooks.sessionStart = [...(hooks.sessionStart as unknown[]), ...extra];
  else (hooks.SessionStart as unknown[]).push({ hooks: extra });
  return copy;
}

const REGISTRABLE = CLIS.filter(registrable);

describe("session-check writer: one entry, idempotent, backup-first, 0600 (R11)", () => {
  for (const cli of REGISTRABLE) {
    test(`${cli}: repeated register runs leave exactly one entry with the template command`, async () => {
      const sb = makeSandbox();
      const file = hookFile(sb, cli);

      for (let i = 0; i < 3; i++) assert.equal((await writer(sb, "register", cli)).status, 0);

      const doc = readJson(file);
      const ours = checkHandlers(cli, doc);
      assert.equal(ours.length, 1, JSON.stringify(doc));
      assert.equal(ours[0]?.command, expectedCommand(sb, cli));
      assert.equal(mode(file), 0o600);
      assert.deepEqual(
        backups(file),
        [],
        "a run that changes nothing must neither write nor back up",
      );
      assertNoCliInvoked(sb);
    });

    test(`${cli}: an existing file is backed up before the first write, at 0600`, async () => {
      const sb = makeSandbox();
      const file = hookFile(sb, cli);
      const before = `${JSON.stringify(operatorDoc(cli), null, 2)}\n`;
      writeFileDeep(file, before, 0o644);

      assert.equal((await writer(sb, "register", cli)).status, 0);

      const baks = backups(file);
      assert.equal(baks.length, 1);
      assert.equal(fs.readFileSync(baks[0] as string, "utf8"), before);
      assert.equal(mode(baks[0] as string), 0o600);
      assert.equal(mode(file), 0o600);
      assertNoCliInvoked(sb);
    });

    test(`${cli}: register then unregister preserves every other hook, look-alike and key`, async () => {
      const sb = makeSandbox();
      const file = hookFile(sb, cli);
      const original = withLookAlikes(sb, cli, operatorDoc(cli));
      writeFileDeep(file, JSON.stringify(original));

      assert.equal((await writer(sb, "register", cli)).status, 0);
      const registered = readJson(file);
      assert.equal(
        checkHandlers(cli, registered).filter((h) => h.command === expectedCommand(sb, cli)).length,
        1,
      );
      assert.equal(
        checkHandlers(cli, registered).length,
        checkHandlers(cli, original).length + 1,
        "a look-alike was lost",
      );
      assert.deepEqual(withoutCheck(cli, registered), withoutCheck(cli, original));

      assert.equal((await writer(sb, "unregister", cli)).status, 0);
      assert.deepEqual(readJson(file), original);
      assertNoCliInvoked(sb);
    });
  }

  test("each CLI's handler carries its own timeout key and unit (v1-F8)", async () => {
    const expected: Partial<Record<Cli, Obj>> = {
      claude: { timeout: 5 },
      gemini: { timeout: 5000, name: HOOK_NAME },
      copilot: { timeoutSec: 5 },
    };
    for (const cli of REGISTRABLE) {
      const sb = makeSandbox();
      assert.equal((await writer(sb, "register", cli)).status, 0);
      const doc = readJson(hookFile(sb, cli));
      const [h] = checkHandlers(cli, doc);
      for (const [k, v] of Object.entries(expected[cli] ?? {}))
        assert.equal(h?.[k], v, `${cli}.${k}`);
      if (cli === "claude") {
        const groups = (doc.hooks as Obj).SessionStart as Obj[];
        assert.ok(groups.some((g) => g.matcher === "" && (g.hooks as Obj[]).includes(h as Obj)));
      }
      if (cli === "copilot") {
        assert.equal(doc.version, 1);
        assert.ok(((doc.hooks as Obj).sessionStart as Obj[]).includes(h as Obj));
      }
    }
  });

  test("register antigravity installs the named hook on PreInvocation, beside the other named hooks", async () => {
    assert.ok(registrable("antigravity"), "ANTIGRAVITY_SESSION_CHECK.registered is expected true");
    const sb = makeSandbox();
    const file = hookFile(sb, "antigravity");
    const others = {
      "crewrig-mempalace-transcript": {
        Stop: [{ type: "command", command: "bash /x/mempalace-transcript.sh Stop" }],
      },
      "operator-hook": { PreInvocation: [{ type: "command", command: "echo op" }] },
    };
    writeFileDeep(file, JSON.stringify(others));

    assert.equal((await writer(sb, "register", "antigravity")).status, 0);
    assert.equal((await writer(sb, "register", "antigravity")).status, 0);

    const doc = readJson(file);
    assert.deepEqual(doc[HOOK_NAME], {
      PreInvocation: [{ type: "command", command: expectedCommand(sb, "antigravity"), timeout: 5 }],
    });
    assert.deepEqual(withoutCheck("antigravity", doc), others);
    assert.equal(mode(file), 0o600);
    assertNoCliInvoked(sb);
  });

  test("a hook file that is not a JSON object is refused and left byte-identical", async () => {
    for (const cli of REGISTRABLE) {
      for (const content of ["[]\n", '{"hooks": \n', ""]) {
        const sb = makeSandbox();
        const file = hookFile(sb, cli);
        writeFileDeep(file, content);

        const r = await writer(sb, "register", cli);

        assert.equal(r.status, 1, `${cli} ${JSON.stringify(content)}: ${r.stdout}${r.stderr}`);
        assert.equal(fs.readFileSync(file, "utf8"), content);
        assert.deepEqual(backups(file), []);
      }
    }
  });
});

describe("session-check writer: the installed copy (R9)", () => {
  test("register installs a private tree outside the checkout, and its command runs from there", async () => {
    const cli = REGISTRABLE[0];
    assert.ok(cli !== undefined, "no CLI is registrable: nothing installs the check");
    const sb = makeSandbox();

    assert.equal((await writer(sb, "register", cli)).status, 0);

    const root = path.dirname(installedCheck(sb));
    for (const rel of [
      "mempalace-session-check.ts",
      "lib/mempalace-registration.ts",
      "lib/session-check-throttle.ts",
    ]) {
      assert.equal(mode(path.join(root, rel)), 0o600, rel);
    }
    assert.equal(mode(root), 0o700);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")), {
      type: "module",
    });
    // No launcher in this HOME: the installed check must run and stay silent (R6).
    const command = checkHandlers(cli, readJson(hookFile(sb, cli)))[0]?.command as string;
    const r = await run("sh", ["-c", command], { env: sb.env() });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
    // And once the installed tree is gone, the same command is a silent success.
    fs.rmSync(root, { recursive: true });
    const gone = await run("sh", ["-c", command], { env: sb.env() });
    assert.deepEqual([gone.status, gone.stdout, gone.stderr], [0, "", ""]);
    assertNoCliInvoked(sb);
  });
});

describe("session-check writer: unsupported platform (delta-01 R11 Platform)", () => {
  test("register gemini on win32 removes only the earlier entry", async () => {
    const sb = makeSandbox();
    const file = hookFile(sb, "gemini");
    const original = withLookAlikes(sb, "gemini", operatorDoc("gemini"));
    writeFileDeep(file, JSON.stringify(original));
    if (registrable("gemini")) {
      assert.equal((await writer(sb, "register", "gemini")).status, 0);
    } else {
      // Seed the earlier entry by hand when Gemini is not registrable here.
      const seeded = structuredClone(original);
      ((seeded.hooks as Obj).SessionStart as Obj[]).push({
        hooks: [
          {
            name: HOOK_NAME,
            type: "command",
            command: expectedCommand(sb, "gemini"),
            timeout: 5000,
          },
        ],
      });
      writeFileDeep(file, JSON.stringify(seeded));
    }
    assert.equal(
      checkHandlers("gemini", readJson(file)).filter(
        (h) => h.command === expectedCommand(sb, "gemini"),
      ).length,
      1,
    );

    const r = await writer(sb, "register", "gemini", "win32");

    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJson(file), original);
    assertNoCliInvoked(sb);
  });

  test("register on win32 creates no hook file and installs nothing, on every CLI", async () => {
    for (const cli of CLIS) {
      const sb = makeSandbox();

      const r = await writer(sb, "register", cli, "win32");

      assert.equal(r.status, 0, `${cli}: ${r.stderr}`);
      assert.equal(fs.existsSync(hookFile(sb, cli)), false, cli);
      assert.equal(fs.existsSync(installedCheck(sb)), false, cli);
    }
  });
});

// --- coexistence with the opt-in writers (R11, both orders × each answer) ------

/** The file the session-recording and usage-capture writers edit for a CLI. */
function optinFile(sb: Sandbox, cli: Exclude<Cli, "antigravity">): string {
  if (cli === "copilot")
    return path.join(sb.home, ".copilot", "hooks", "copilot-transcript-hooks.json");
  return hookFile(sb, cli);
}

const ANSWERS = ["sr-accept", "uc-yes", "uc-no", "uc-cancel", "uc-keep", "uc-remove"] as const;
type Answer = (typeof ANSWERS)[number];

/** One opt-in step exactly as the setup scripts call the library (usage-capture-optin.sh). */
function optin(sb: Sandbox, cli: Exclude<Cli, "antigravity">, answer: Answer): void {
  const cfg = shq(optinFile(sb, cli));
  const manifest = shq(path.join(REPO, "hooks", `${cli}-transcript-hooks.json`));
  const apply = (ans: string): string =>
    `st="$(usage_capture_state ${cli} ${cfg})" && usage_capture_apply ${cli} ${cfg} ${shq(REPO)} "$st" ${shq(ans)}`;
  const script = {
    "sr-accept": `mkdir -p "$(dirname ${cfg})" && merge_session_recording_hooks ${cli} ${cfg} ${manifest}`,
    "uc-yes": apply("yes"),
    "uc-no": apply("no"),
    "uc-cancel": apply(""),
    "uc-keep": `${apply("yes")} && ${apply("keep")}`,
    "uc-remove": `${apply("yes")} && ${apply("remove")}`,
  }[answer];
  const r = bashLib(sb, `set -e; ${script}`, { optin: true });
  assert.equal(r.status, 0, `${cli} ${answer}: ${r.stdout}${r.stderr}`);
}

describe("session-check writer: coexistence with session recording and usage capture (R11)", () => {
  for (const cli of (["claude", "gemini", "copilot"] as const).filter(registrable)) {
    for (const answer of ANSWERS) {
      test(`${cli} ${answer}: check registered first, opt-in writer second, entry untouched`, async () => {
        const sb = makeSandbox();
        assert.equal((await writer(sb, "register", cli)).status, 0);
        const ours = checkHandlers(cli, readJson(hookFile(sb, cli)));

        optin(sb, cli, answer);

        assert.deepEqual(checkHandlers(cli, readJson(hookFile(sb, cli))), ours);
        if (cli === "copilot" && fs.existsSync(optinFile(sb, cli))) {
          assert.deepEqual(checkHandlers(cli, readJson(optinFile(sb, cli))), []);
        }
        assertNoCliInvoked(sb);
      });

      test(`${cli} ${answer}: opt-in writer first, check registered second, opt-in entries untouched`, async () => {
        const sb = makeSandbox();
        optin(sb, cli, answer);
        const before = fs.existsSync(optinFile(sb, cli)) ? readJson(optinFile(sb, cli)) : null;

        assert.equal((await writer(sb, "register", cli)).status, 0);

        const after = readJson(hookFile(sb, cli));
        assert.equal(checkHandlers(cli, after).length, 1);
        if (cli === "copilot") {
          assert.deepEqual(before === null ? null : readJson(optinFile(sb, cli)), before);
        } else if (before !== null) {
          assert.deepEqual(withoutCheck(cli, after), before);
        }
        assertNoCliInvoked(sb);
      });
    }
  }

  test("antigravity: the transcript deploy keeps the check's named hook", () => {
    const sb = makeSandbox();
    const target = hookFile(sb, "antigravity");
    const ours = {
      [HOOK_NAME]: {
        PreInvocation: [
          { type: "command", command: expectedCommand(sb, "antigravity"), timeout: 5 },
        ],
      },
    };
    writeFileDeep(
      target,
      JSON.stringify({ ...ours, "operator-hook": { Stop: [{ command: "echo op" }] } }),
    );

    const r = bashLib(
      sb,
      `deploy_antigravity_transcript_hooks ${shq(path.join(REPO, "hooks", "antigravity-transcript-hooks.json"))} ` +
        `${shq(path.join(REPO, "hooks", "mempalace-transcript.sh"))} ${shq(path.join(sb.home, ".gemini", "hooks"))} ` +
        `${shq(target)} 'MEMPALACE_TRANSCRIPT_ENABLED=1' ${shq(path.join(REPO, "hooks", "worktree-git-guard.sh"))}`,
    );

    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = readJson(target);
    assert.deepEqual(doc[HOOK_NAME], ours[HOOK_NAME]);
    assert.ok("crewrig-mempalace-transcript" in doc);
    assert.ok("operator-hook" in doc);
    assertNoCliInvoked(sb);
  });

  test(`antigravity: register ${registrable("antigravity") ? "keeps one entry" : "removes only the earlier entry (R8 fallback)"} beside the transcript hooks`, async () => {
    const sb = makeSandbox();
    const target = hookFile(sb, "antigravity");
    const others = {
      "crewrig-mempalace-transcript": {
        Stop: [{ type: "command", command: "bash /x/mempalace-transcript.sh Stop" }],
      },
      "operator-hook": { PreInvocation: [{ type: "command", command: "echo op" }] },
    };
    const seeded = {
      ...others,
      [HOOK_NAME]: {
        PreInvocation: [
          { type: "command", command: expectedCommand(sb, "antigravity"), timeout: 5 },
        ],
      },
    };
    writeFileDeep(target, JSON.stringify(seeded));

    assert.equal((await writer(sb, "register", "antigravity")).status, 0);

    const doc = readJson(target);
    if (registrable("antigravity")) {
      assert.equal(checkHandlers("antigravity", doc).length, 1);
      assert.deepEqual(withoutCheck("antigravity", doc), others);
    } else {
      assert.deepEqual(doc, others);
    }
    assertNoCliInvoked(sb);
  });
});

describe("committed manifests never carry the check (R11)", () => {
  test("no hooks/*-transcript-hooks.json or hooks/*-usage-capture-hooks.json names mempalace-session-check", () => {
    const dir = path.join(REPO, "hooks");
    const manifests = fs
      .readdirSync(dir)
      .filter((n) => /-(transcript|usage-capture)-hooks\.json$/.test(n));
    assert.ok(
      manifests.length >= 7,
      `expected the committed manifests, found ${manifests.join(", ")}`,
    );

    const offenders = manifests.filter((n) =>
      fs.readFileSync(path.join(dir, n), "utf8").includes("mempalace-session-check"),
    );

    assert.deepEqual(offenders, []);
  });
});
