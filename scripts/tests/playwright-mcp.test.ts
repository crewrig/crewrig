// playwright-mcp.test.ts — `task setup:playwright-mcp` end to end (spec 0245
// R19; PLAN v2 step 8).
//
// `main(argv, deps)` runs in-process against a temporary HOME, a PATH holding
// four inert assistant stubs (presence is a stat walk, nothing is spawned), a
// fixed clock and a fake `run` that plays `claude mcp remove|add|add-json` on
// the temporary ~/.claude.json the way the real CLI stores entries.
//
// - the four-assistant matrix: (a) fresh registration, (b) legacy convergence,
//   (c) relocation, (d) customised entries left untouched, (e) a second run
//   changes nothing, (f) every other declaration and key is preserved;
// - R13 skips, R14 failures (invalid JSON / JSONC, lossy input), R12 comments,
//   R11 symlink and mode, a failed backup, the Claude `add-json` restore, a
//   symlinked checkout, and one subprocess smoke run of the real entry.
//
// Messages are asserted through the exported `MSG` templates, never free text.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/playwright-mcp.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLI_LABEL, MSG, main, type Outcome, type RunResult } from "../lib/playwright-mcp.ts";
import type { Cli } from "../lib/playwright-mcp-shape.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];
const FILE_CLIS: readonly Cli[] = ["gemini", "copilot", "antigravity"];
const BINARY: Record<Cli, string> = {
  claude: "claude",
  gemini: "gemini",
  copilot: "copilot",
  antigravity: "agy",
};
const PKG = "@playwright/mcp@latest";
const NOW = new Date(2026, 8, 30, 12, 34, 56);
const STAMP = "20260930-123456";
const posix = process.platform !== "win32";

type Json = Record<string, unknown>;

// --- Hermetic world ---------------------------------------------------------

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

interface World {
  readonly home: string;
  readonly bin: string;
  /** The checkout the task runs from, and its trust wrapper. */
  readonly repoRoot: string;
  readonly wrapper: string;
}

function makeWorld(binaries: readonly Cli[] = CLIS): World {
  const root = tempDir("crewrig-pw-");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  const repoRoot = path.join(root, "checkout");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(repoRoot, "scripts", "lib"), { recursive: true });
  const wrapper = path.join(repoRoot, "scripts", "lib", "tls-exec.sh");
  fs.writeFileSync(wrapper, '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
  for (const cli of binaries) {
    fs.writeFileSync(path.join(bin, BINARY[cli]), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  }
  return { home, bin, repoRoot, wrapper };
}

/** The configuration file of each assistant, spelled out from spec 0245 R1. */
function cfg(w: World, cli: Cli): string {
  switch (cli) {
    case "claude":
      return path.join(w.home, ".claude.json");
    case "gemini":
      return path.join(w.home, ".gemini", "settings.json");
    case "copilot":
      return path.join(w.home, ".copilot", "mcp-config.json");
    case "antigravity":
      return path.join(w.home, ".gemini", "config", "mcp_config.json");
  }
}

function putText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function putJson(file: string, value: unknown): void {
  putText(file, `${JSON.stringify(value, null, 2)}\n`);
}
function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}
function servers(w: World, cli: Cli): Json {
  return readJson(cfg(w, cli))["mcpServers"] as Json;
}

/** Other content every configuration holds: other servers around the slot, and non-MCP keys. */
function baseDoc(cli: Cli, playwright?: unknown): Json {
  const before = {
    "acme-tools": { command: "acme", args: ["--serve"], env: { ACME_TOKEN: "xyz" } },
  };
  const afterSlot = {
    sequentialthinking: {
      command: "bash",
      args: ["/repo/scripts/lib/tls-exec.sh", "npx", "-y", "seq"],
    },
  };
  const mcp = { ...before, ...(playwright === undefined ? {} : { playwright }), ...afterSlot };
  switch (cli) {
    case "claude":
      return { numStartups: 3, mcpServers: mcp, projects: { "/x": { allowedTools: [] } } };
    case "gemini":
      return {
        ui: { theme: "Dracula" },
        mcpServers: mcp,
        context: { fileName: ["A.md", "AGENTS.md"] },
      };
    case "copilot":
      return { "x-operator": true, mcpServers: mcp };
    case "antigravity":
      return { mcpServers: mcp, "x-trailing": [1, 2] };
  }
}

/** Every file under HOME with its bytes and mtime: a second run must not move any. */
function snapshot(w: World): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(p, `${st.mtimeMs}:${st.mode}:${fs.readFileSync(p, "base64")}`);
    }
  };
  walk(w.home);
  return out;
}

function backups(file: string): string[] {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.startsWith(`${path.basename(file)}.bak.`));
}

// --- Fake `claude mcp` --------------------------------------------------------

interface Knobs {
  readonly failAdd?: boolean;
  /** `add` succeeds but stores something other than what it was asked to. */
  readonly addStoresOther?: boolean;
}

function fakeRun(w: World, calls: string[][], knobs: Knobs) {
  return async (argv: readonly string[]): Promise<RunResult> => {
    calls.push([...argv]);
    const ok = { status: 0, stdout: "", stderr: "" };
    const file = cfg(w, "claude");
    const [bin, sub, verb, scopeFlag, scope, name, ...rest] = argv;
    assert.equal(bin, "claude", `unexpected command ${argv.join(" ")}`);
    assert.deepEqual([sub, scopeFlag, scope, name], ["mcp", "--scope", "user", "playwright"]);
    const doc = readJson(file);
    const mcp = (doc["mcpServers"] ?? {}) as Json;
    if (verb === "remove") {
      if (!Object.hasOwn(mcp, "playwright"))
        return { status: 1, stdout: "", stderr: "No MCP server found" };
      delete mcp["playwright"];
    } else if (verb === "add") {
      if (knobs.failAdd) return { status: 1, stdout: "", stderr: "add exploded" };
      assert.equal(rest[0], "--");
      const [command, ...args] = rest.slice(1);
      mcp["playwright"] = knobs.addStoresOther
        ? { type: "stdio", command, args, env: { SURPRISE: "1" } }
        : { type: "stdio", command, args, env: {} };
    } else if (verb === "add-json") {
      mcp["playwright"] = JSON.parse(rest[0] as string);
    } else {
      assert.fail(`unexpected claude verb ${verb}`);
    }
    doc["mcpServers"] = mcp;
    putJson(file, doc);
    return ok;
  };
}

interface Result {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly calls: string[][];
}

async function runTask(
  w: World,
  options: { knobs?: Knobs; repoRoot?: string; argv?: string[] } = {},
): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[][] = [];
  const code = await main(options.argv ?? [], {
    run: fakeRun(w, calls, options.knobs ?? {}),
    env: { HOME: w.home, PATH: w.bin },
    now: () => NOW,
    repoRoot: options.repoRoot ?? w.repoRoot,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err, calls };
}

function outcome(r: Result, cli: Cli, expected: Outcome): void {
  const line = MSG.reportLine(CLI_LABEL[cli], expected);
  assert.ok(
    r.out.includes(line),
    `report lacks "${line}":\n${r.out.join("\n")}\n${r.err.join("\n")}`,
  );
}

function has(lines: readonly string[], line: string): void {
  assert.ok(lines.includes(line), `missing "${line}" in:\n${lines.join("\n")}`);
}

/** A line rendered by a template whose free-text argument (the reason) is unknown. */
function hasTemplated(lines: readonly string[], render: (hole: string) => string): void {
  const [prefix, suffix] = render("\u0000").split("\u0000") as [string, string];
  assert.ok(
    lines.some((l) => l.startsWith(prefix) && l.endsWith(suffix)),
    `missing "${prefix}…${suffix}" in:\n${lines.join("\n")}`,
  );
}

// --- Oracles (spelled out, not taken from the implementation) ----------------

/** What each assistant holds once registered in the wrapped form. */
function stored(cli: Cli, wrapper: string): Json {
  const args = [wrapper, "npx", PKG];
  switch (cli) {
    case "claude":
      return { type: "stdio", command: "bash", args, env: {} };
    case "copilot":
      return { type: "stdio", command: "bash", args };
    default:
      return { command: "bash", args };
  }
}

const LEGACY = { command: "npx", args: [PKG] };
/** The legacy shape with the fields each assistant adds by itself (v1-F3 table). */
const LEGACY_TOLERATED: Record<Cli, readonly Json[]> = {
  claude: [{ type: "stdio", command: "npx", args: [PKG], env: {} }],
  copilot: [
    { type: "stdio", command: "npx", args: [PKG] },
    { tools: ["*"], type: "local", command: "npx", args: [PKG] },
  ],
  gemini: [],
  antigravity: [],
};
const OLD_WRAPPER = "/old/clone/scripts/lib/tls-exec.sh";
const relocated = (cli: Cli): Json =>
  cli === "copilot"
    ? { type: "stdio", command: "bash", args: [OLD_WRAPPER, "npx", PKG] }
    : cli === "claude"
      ? { type: "stdio", command: "bash", args: [OLD_WRAPPER, "npx", PKG], env: {} }
      : { command: "bash", args: [OLD_WRAPPER, "npx", PKG] };

/** Everything except the `playwright` slot, as serialised text: order matters (R8). */
function withoutPlaywright(doc: Json): string {
  const mcp = { ...(doc["mcpServers"] as Json) };
  delete mcp["playwright"];
  return JSON.stringify({ ...doc, mcpServers: mcp });
}

// --- (a)–(f): the four-assistant matrix --------------------------------------

for (const cli of CLIS) {
  const label = CLI_LABEL[cli];
  describe(`${label}`, () => {
    test("(a) a fresh registration writes the wrapped form, with its backup or add argv (R2, R9)", async () => {
      const w = makeWorld();
      const file = cfg(w, cli);
      putJson(file, baseDoc(cli));
      const prior = fs.readFileSync(file);
      const r = await runTask(w);
      assert.equal(r.code, 0, r.err.join("\n"));
      outcome(r, cli, "registered");
      assert.deepEqual(servers(w, cli)["playwright"], stored(cli, w.wrapper));
      if (cli === "claude") {
        assert.deepEqual(r.calls, [
          [
            "claude",
            "mcp",
            "add",
            "--scope",
            "user",
            "playwright",
            "--",
            "bash",
            w.wrapper,
            "npx",
            PKG,
          ],
        ]);
        has(r.out, MSG.registeredClaude(label));
      } else {
        const backup = `${file}.bak.${STAMP}`;
        assert.deepEqual(fs.readFileSync(backup), prior);
        has(r.out, MSG.registeredFile(label, file, backup));
      }
    });

    for (const legacy of [LEGACY, ...LEGACY_TOLERATED[cli]]) {
      test(`(b) a legacy entry ${JSON.stringify(legacy)} is converged (R3, R9, R10)`, async () => {
        const w = makeWorld();
        const file = cfg(w, cli);
        putJson(file, baseDoc(cli, legacy));
        const prior = fs.readFileSync(file);
        const r = await runTask(w);
        assert.equal(r.code, 0, r.err.join("\n"));
        outcome(r, cli, "converged");
        assert.deepEqual(servers(w, cli)["playwright"], stored(cli, w.wrapper));
        if (cli === "claude") {
          has(r.out, MSG.convergingClaude(label, JSON.stringify(legacy)));
          assert.deepEqual(
            r.calls.map((c) => c[2]),
            ["remove", "add"],
          );
        } else {
          const backup = `${file}.bak.${STAMP}`;
          assert.deepEqual(fs.readFileSync(backup), prior);
          has(r.out, MSG.convergedFile(label, file, backup));
        }
      });
    }

    test("(c) a relocated entry is moved to this checkout, then reads as up to date (R4, R16)", async () => {
      const w = makeWorld();
      const file = cfg(w, cli);
      putJson(file, baseDoc(cli, relocated(cli)));
      const prior = fs.readFileSync(file);
      const r = await runTask(w);
      assert.equal(r.code, 0, r.err.join("\n"));
      outcome(r, cli, "relocated");
      assert.deepEqual(servers(w, cli)["playwright"], stored(cli, w.wrapper));
      if (cli === "claude") {
        has(
          r.out,
          MSG.relocatingClaude(label, OLD_WRAPPER, w.wrapper, JSON.stringify(relocated(cli))),
        );
      } else {
        const backup = `${file}.bak.${STAMP}`;
        assert.deepEqual(fs.readFileSync(backup), prior);
        has(r.out, MSG.relocatedFile(label, file, OLD_WRAPPER, w.wrapper, backup));
      }
      const again = await runTask(w);
      assert.equal(again.code, 0);
      outcome(again, cli, "already up to date");
      has(again.out, MSG.upToDate(label));
    });

    // (d) Customised entries: anything but the wrapper path differs, or a field
    // tolerated on another assistant only (v1-F3).
    const foreignField: Json =
      cli === "claude" ? { tools: ["*"] } : cli === "copilot" ? { env: {} } : { type: "stdio" };
    const customs: readonly [string, unknown][] = [
      ["a pinned version", { command: "npx", args: ["@playwright/mcp@0.0.40"] }],
      [
        "an extra --headless argument",
        { command: "npx", args: ["@playwright/mcp@0.0.40", "--headless"] },
      ],
      ["npx -y", { command: "npx", args: ["-y", PKG] }],
      ["a non-empty env", { command: "npx", args: [PKG], env: { DEBUG: "pw:*" } }],
      [
        "a wrapped entry with a pinned version",
        { command: "bash", args: [w0(), "npx", "@playwright/mcp@0.0.40"] },
      ],
      [
        "a wrapped entry with a relative wrapper path",
        { command: "bash", args: ["old/clone/scripts/lib/tls-exec.sh", "npx", PKG] },
      ],
      [
        "a wrapped entry whose wrapper is another script",
        { command: "bash", args: ["/old/clone/scripts/lib/other.sh", "npx", PKG] },
      ],
      ["a stray field", { command: "npx", args: [PKG], timeout: 5 }],
      ["an http transport", { type: "http", url: "http://127.0.0.1:8931/mcp" }],
      [
        `a field tolerated on another assistant only (${JSON.stringify(foreignField)})`,
        { ...foreignField, command: "npx", args: [PKG] },
      ],
    ];
    for (const [what, entry] of customs) {
      test(`(d) ${what} is left untouched, with the R6 warning and no backup`, async () => {
        const w = makeWorld();
        const file = cfg(w, cli);
        const fixed = JSON.parse(JSON.stringify(entry).replaceAll("__W__", w.wrapper)) as unknown;
        putJson(file, baseDoc(cli, fixed));
        const prior = fs.readFileSync(file);
        const r = await runTask(w);
        assert.equal(r.code, 0, r.err.join("\n"));
        outcome(r, cli, "left untouched");
        assert.deepEqual(fs.readFileSync(file), prior);
        assert.deepEqual(backups(file), []);
        has(r.err, MSG.untouched(label, cli === "claude" ? `${file} (user scope)` : file));
        if (cli === "claude") assert.deepEqual(r.calls, []);
      });
    }

    test("(f) every other declaration and key keeps its value and order (R8)", async () => {
      const w = makeWorld();
      const file = cfg(w, cli);
      putJson(file, baseDoc(cli, LEGACY));
      const before = withoutPlaywright(readJson(file));
      const keysBefore = Object.keys(servers(w, cli));
      await runTask(w);
      assert.equal(withoutPlaywright(readJson(file)), before);
      // The replaced slot keeps its position between its neighbours.
      assert.deepEqual(
        Object.keys(servers(w, cli)),
        cli === "claude"
          ? [...keysBefore.filter((k) => k !== "playwright"), "playwright"]
          : keysBefore,
      );
    });
  });
}

/** Placeholder for the current checkout's wrapper inside a static fixture. */
function w0(): string {
  return "__W__";
}

describe("all four assistants", () => {
  test("(e) a second run after register / converge / relocate changes nothing (R5, R16)", async () => {
    const w = makeWorld();
    putJson(cfg(w, "claude"), baseDoc("claude", LEGACY));
    putJson(cfg(w, "gemini"), baseDoc("gemini", relocated("gemini")));
    putJson(cfg(w, "copilot"), baseDoc("copilot"));
    putJson(cfg(w, "antigravity"), baseDoc("antigravity", LEGACY));
    const first = await runTask(w);
    assert.equal(first.code, 0, first.err.join("\n"));
    outcome(first, "claude", "converged");
    outcome(first, "gemini", "relocated");
    outcome(first, "copilot", "registered");
    outcome(first, "antigravity", "converged");

    const before = snapshot(w);
    const second = await runTask(w);
    assert.equal(second.code, 0);
    assert.deepEqual(second.calls, []);
    assert.deepEqual(snapshot(w), before);
    for (const cli of CLIS) {
      outcome(second, cli, "already up to date");
      has(second.out, MSG.upToDate(CLI_LABEL[cli]));
    }
  });

  // R5, R16: the fields Copilot CLI adds by itself (observed: `type: "local"`,
  // `tools: ["*"]`) do not make the current wrapped form look foreign.
  for (const extra of [
    { type: "local" },
    { tools: ["*"] },
    { tools: ["*"], type: "local" },
  ] as const) {
    test(`a Copilot wrapped entry with ${JSON.stringify(extra)} is already up to date, no backup, no write`, async () => {
      const w = makeWorld(["copilot"]);
      const file = cfg(w, "copilot");
      putJson(
        file,
        baseDoc("copilot", { ...extra, command: "bash", args: [w.wrapper, "npx", PKG] }),
      );
      const before = snapshot(w);
      const r = await runTask(w);
      assert.equal(r.code, 0, r.err.join("\n"));
      outcome(r, "copilot", "already up to date");
      has(r.out, MSG.upToDate(CLI_LABEL.copilot));
      assert.deepEqual(snapshot(w), before);
      assert.deepEqual(backups(file), []);
    });
  }

  test("a usage error exits 2 and touches nothing", async () => {
    const w = makeWorld();
    putJson(cfg(w, "gemini"), baseDoc("gemini"));
    const before = snapshot(w);
    const r = await runTask(w, { argv: ["--force"] });
    assert.equal(r.code, 2);
    has(r.err, MSG.usage);
    assert.deepEqual(snapshot(w), before);
  });
});

// --- R13, R14: skips and failures ----------------------------------------------

describe("skips and failures", () => {
  test("an assistant whose binary or file is absent is skipped, nothing created, exit 0 (R13)", async () => {
    const w = makeWorld(["claude", "gemini", "antigravity"]); // no `copilot` on PATH
    putJson(cfg(w, "claude"), baseDoc("claude"));
    putJson(cfg(w, "copilot"), baseDoc("copilot")); // present, but Copilot is not installed
    putJson(cfg(w, "antigravity"), baseDoc("antigravity"));
    // no ~/.gemini/settings.json although `gemini` is installed
    const copilotBefore = fs.readFileSync(cfg(w, "copilot"));
    const r = await runTask(w);
    assert.equal(r.code, 0, r.err.join("\n"));
    outcome(r, "copilot", "skipped");
    outcome(r, "gemini", "skipped");
    outcome(r, "claude", "registered");
    outcome(r, "antigravity", "registered");
    has(r.out, MSG.skippedBinary(CLI_LABEL.copilot, "copilot"));
    has(r.out, MSG.skippedConfig(CLI_LABEL.gemini, cfg(w, "gemini")));
    assert.equal(fs.existsSync(cfg(w, "gemini")), false);
    assert.deepEqual(fs.readFileSync(cfg(w, "copilot")), copilotBefore);
  });

  test("invalid JSON (Antigravity) and invalid JSONC (Gemini) fail loudly without damage; the rest runs; exit 1 (R14)", async () => {
    const w = makeWorld();
    putJson(cfg(w, "claude"), baseDoc("claude"));
    putJson(cfg(w, "copilot"), baseDoc("copilot"));
    putText(cfg(w, "antigravity"), '{"mcpServers": {"acme": {}},');
    putText(cfg(w, "gemini"), '{\n  // a comment\n  "ui": {"theme": "x"\n');
    const agyBefore = fs.readFileSync(cfg(w, "antigravity"));
    const gemBefore = fs.readFileSync(cfg(w, "gemini"));
    const r = await runTask(w);
    assert.equal(r.code, 1);
    outcome(r, "antigravity", "failed");
    outcome(r, "gemini", "failed");
    outcome(r, "claude", "registered");
    outcome(r, "copilot", "registered");
    for (const cli of ["antigravity", "gemini"] as const) {
      hasTemplated(r.err, (reason) => MSG.unreadable(CLI_LABEL[cli], cfg(w, cli), reason));
      assert.deepEqual(backups(cfg(w, cli)), []);
    }
    assert.deepEqual(fs.readFileSync(cfg(w, "antigravity")), agyBefore);
    assert.deepEqual(fs.readFileSync(cfg(w, "gemini")), gemBefore);
  });

  for (const [what, cli, text] of [
    [
      "a duplicate playwright key",
      "copilot",
      '{"mcpServers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest"]},"playwright":{"command":"x"}}}',
    ],
    [
      "a duplicate key behind a comment",
      "gemini",
      '{"mcpServers":{"a":{}}, // c\n "mcpServers":{}}',
    ],
    [
      "a number that does not round-trip",
      "antigravity",
      '{"limit":12345678901234567890,"mcpServers":{}}',
    ],
    ["an integer-like key", "copilot", '{"mcpServers":{"zeta":{},"7":{}}}'],
    ["a non-object mcpServers", "antigravity", '{"mcpServers":[]}'],
  ] as const) {
    test(`${what} (${cli}) is failed and left unchanged (R8, R14, v1-F4)`, async () => {
      const w = makeWorld([cli]);
      putText(cfg(w, cli), text);
      const r = await runTask(w);
      assert.equal(r.code, 1);
      outcome(r, cli, "failed");
      assert.equal(fs.readFileSync(cfg(w, cli), "utf8"), text);
      assert.deepEqual(backups(cfg(w, cli)), []);
      hasTemplated(r.err, (reason) => MSG.unreadable(CLI_LABEL[cli], cfg(w, cli), reason));
    });
  }

  // R12: Copilot CLI and Antigravity CLI read plain JSON; only Gemini CLI reads JSONC.
  for (const cli of ["copilot", "antigravity"] as const) {
    test(`a commented ${cli} file is failed, not read as JSONC (R12, R14)`, async () => {
      const w = makeWorld([cli]);
      const text = '{\n  // c\n  "mcpServers": {}\n}\n';
      putText(cfg(w, cli), text);
      const r = await runTask(w);
      assert.equal(r.code, 1);
      outcome(r, cli, "failed");
      assert.equal(fs.readFileSync(cfg(w, cli), "utf8"), text);
      hasTemplated(r.err, (reason) => MSG.unreadable(CLI_LABEL[cli], cfg(w, cli), reason));
    });
  }

  test("a backup that cannot be made means no write and failed (R9)", async () => {
    const w = makeWorld(["copilot"]);
    const file = cfg(w, "copilot");
    putJson(file, baseDoc("copilot", LEGACY));
    // Every same-second backup name is taken, so backupFile reports `failed`.
    putText(`${file}.bak.${STAMP}`, "x");
    for (let n = 1; n <= 99; n++)
      putText(`${file}.bak.${STAMP}.${String(n).padStart(2, "0")}`, "x");
    const prior = fs.readFileSync(file);
    const r = await runTask(w);
    assert.equal(r.code, 1);
    outcome(r, "copilot", "failed");
    assert.deepEqual(fs.readFileSync(file), prior);
    has(r.err, MSG.backupFailed(CLI_LABEL.copilot, file));
  });

  test("a failed `claude mcp add` after `remove` restores the prior entry with add-json (R10)", async () => {
    const w = makeWorld(["claude"]);
    const prior = LEGACY_TOLERATED.claude[0] as Json;
    putJson(cfg(w, "claude"), baseDoc("claude", prior));
    const r = await runTask(w, { knobs: { failAdd: true } });
    assert.equal(r.code, 1);
    outcome(r, "claude", "failed");
    assert.deepEqual(r.calls.at(-1), [
      "claude",
      "mcp",
      "add-json",
      "--scope",
      "user",
      "playwright",
      JSON.stringify(prior),
    ]);
    assert.deepEqual(servers(w, "claude")["playwright"], prior);
    has(r.out, MSG.convergingClaude(CLI_LABEL.claude, JSON.stringify(prior)));
    has(r.err, MSG.claudeRestored(CLI_LABEL.claude));
  });

  test("a `claude mcp add` that does not store the wrapped form is failed after the re-read", async () => {
    const w = makeWorld(["claude"]);
    putJson(cfg(w, "claude"), baseDoc("claude"));
    const r = await runTask(w, { knobs: { addStoresOther: true } });
    assert.equal(r.code, 1);
    outcome(r, "claude", "failed");
    has(r.err, MSG.claudeVerifyFailed(CLI_LABEL.claude, cfg(w, "claude")));
  });
});

// --- R11, R12: write guarantees and comments -------------------------------------

describe("write guarantees", () => {
  test("a commented Gemini file is written, with the spec 0214 warning naming the backup (R12)", async () => {
    const w = makeWorld(["gemini"]);
    const file = cfg(w, "gemini");
    const text =
      '{\n  // my theme\n  "ui": {"theme": "Dracula"}, /* servers */\n  "mcpServers": {"acme": {"command": "acme"}}\n}\n';
    putText(file, text);
    const r = await runTask(w);
    assert.equal(r.code, 0, r.err.join("\n"));
    outcome(r, "gemini", "registered");
    const backup = `${file}.bak.${STAMP}`;
    assert.equal(fs.readFileSync(backup, "utf8"), text);
    for (const line of MSG.geminiComments(file, backup)) has([...r.out, ...r.err], line);
    assert.deepEqual(readJson(file), {
      ui: { theme: "Dracula" },
      mcpServers: { acme: { command: "acme" }, playwright: stored("gemini", w.wrapper) },
    });
  });

  test("a Gemini file without comments gets no comment warning", async () => {
    const w = makeWorld(["gemini"]);
    const file = cfg(w, "gemini");
    putJson(file, { mcpServers: { a: { url: "http://x/*not-a-comment*/" } } });
    const r = await runTask(w);
    outcome(r, "gemini", "registered");
    const [first] = MSG.geminiComments(file, `${file}.bak.${STAMP}`);
    assert.ok(![...r.out, ...r.err].includes(first as string));
  });

  test(
    "a symlink at the target is replaced, its link target untouched (R11)",
    { skip: !posix },
    async () => {
      const w = makeWorld(["antigravity"]);
      const file = cfg(w, "antigravity");
      const real = path.join(w.home, "real-mcp.json");
      putJson(real, baseDoc("antigravity"));
      const realBefore = fs.readFileSync(real);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.symlinkSync(real, file);
      const r = await runTask(w);
      outcome(r, "antigravity", "registered");
      assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
      assert.deepEqual(fs.readFileSync(real), realBefore);
      assert.deepEqual(servers(w, "antigravity")["playwright"], stored("antigravity", w.wrapper));
    },
  );

  test("a 0644 target is 0600 after the write (R11)", { skip: !posix }, async () => {
    const w = makeWorld(["copilot"]);
    const file = cfg(w, "copilot");
    putJson(file, baseDoc("copilot"));
    fs.chmodSync(file, 0o644);
    const r = await runTask(w);
    outcome(r, "copilot", "registered");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  test(
    "an entry naming the checkout through a symlink alias is already up to date (R5)",
    { skip: !posix },
    async () => {
      const w = makeWorld();
      const alias = path.join(path.dirname(w.repoRoot), "alias");
      fs.symlinkSync(w.repoRoot, alias);
      const aliasWrapper = path.join(alias, "scripts", "lib", "tls-exec.sh");
      for (const cli of CLIS) putJson(cfg(w, cli), baseDoc(cli, stored(cli, aliasWrapper)));
      const before = snapshot(w);
      const r = await runTask(w);
      assert.equal(r.code, 0, r.err.join("\n"));
      assert.deepEqual(r.calls, []);
      assert.deepEqual(snapshot(w), before);
      for (const cli of CLIS) outcome(r, cli, "already up to date");
    },
  );
});

// --- The real entry, as a subprocess ----------------------------------------------

describe("scripts/setup-playwright-mcp.ts", () => {
  test("with an empty PATH it skips all four assistants and exits 0 (smoke)", () => {
    const root = tempDir("crewrig-pw-smoke-");
    const home = path.join(root, "home");
    const emptyBin = path.join(root, "bin");
    fs.mkdirSync(home);
    fs.mkdirSync(emptyBin);
    const result = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.join(REPO, "scripts", "setup-playwright-mcp.ts"),
      ],
      { cwd: root, env: { HOME: home, PATH: emptyBin }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split("\n");
    for (const cli of CLIS) {
      has(lines, MSG.skippedBinary(CLI_LABEL[cli], BINARY[cli]));
      has(lines, MSG.reportLine(CLI_LABEL[cli], "skipped"));
    }
    assert.deepEqual(fs.readdirSync(home), []);
  });
});
