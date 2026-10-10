// setup-mcp-agy-step.test.ts — the Antigravity `mcp-prepare` and `mcp` steps (spec 0256
// requirements 25-28, delta-01) against fake seams in a temporary home and repository. The printed
// block is compared with the golden cells default-answers, operator-mcp-preserved,
// org-mcp-declared, ensure-http-rc1/rc2 and chroma-install-failure of the Antigravity matrix.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import type { FlowDeps, FlowState } from "../lib/setup/descriptor.ts";
import type { EnsureHttpDeps } from "../lib/setup/ensure-http.ts";
import { runSetup } from "../lib/setup/flow.ts";
import { prepare, run as mcpStep } from "../lib/setup/mcp-agy-step.ts";
import { normalize } from "./lib/setup-golden-tree.ts";
import { descriptor } from "./setup-flow-fixtures.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const realRepo = path.resolve(here, "..", "..");
const golden = path.join(here, "fixtures", "setup-golden", "antigravity");
const posix = process.platform !== "win32";
const PIN = { min: "3.6.0", maxExclusive: "3.7" };
const OPERATOR = JSON.stringify(
  { mcpServers: { "operator-tool": { command: "node", args: ["__CREWRIG_REPO_DIR__/op.js"] } } },
  null,
  2,
);
const ORG = JSON.stringify({
  mcpServers: {
    "org-stdio": { transport: "stdio", command: "org-bin", args: ["--x"] },
    "org-remote": { transport: "http", url: "https://mcp.example.test/mcp" },
    "operator-tool": { transport: "stdio", command: "org-wins" },
  },
});
const ECHO = (answer: string): string => `[answer] install-seqthink=${answer}\n`;

let root: string;
let home: string;
let repo: string;
let python: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-mcp-agy-")));
  home = path.join(root, "home");
  repo = path.join(root, "repo");
  python = path.join(home, ".local/share/pipx/venvs/mempalace/bin/python");
  const rel = "config/systemd/mempalace-chroma-server.service";
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.copyFileSync(path.join(realRepo, rel), path.join(repo, rel));
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts/lib/tls-exec.sh"), "#!/bin/sh\n");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "#!/bin/sh\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const target = (): string => path.join(home, ".gemini", "config", "mcp_config.json");
const seed = (rel: string, body: string): void => {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  fs.writeFileSync(path.join(home, rel), body);
};
const norm = (text: string): string => normalize(text, { root, repo, home });

/** The golden text of the two steps: the `Configuring` line, then what follows the deps paragraph. */
function block(cell: string, until: string | undefined = "Select your team:"): string {
  const text = fs.readFileSync(path.join(golden, cell, "stdout.golden"), "utf8");
  const from = text.indexOf("Configuring");
  const first = text.slice(from, text.indexOf("\n", from) + 1);
  const deps = text.indexOf("Production dependencies");
  const rest = text.indexOf("\n\n", deps) + 2;
  return first + text.slice(rest, until === undefined ? text.length : text.indexOf(until));
}

const ok = (stdout = ""): SpawnResult => ({ status: 0, stdout, stderr: "" });
const spawn: Spawner = (argv) => ok(argv.includes("-c") ? "3.6.0\n" : "");

interface Opts {
  readonly ensure?: Partial<EnsureHttpDeps>;
  readonly noPython?: boolean;
  readonly noChroma?: boolean;
  readonly answer?: string;
  readonly events?: string[];
}

function ensureDeps(o: Opts): EnsureHttpDeps {
  return {
    readToken: () => {
      o.events?.push(fs.existsSync(target()) ? "stdio-written" : "stdio-missing");
      return "T".repeat(48);
    },
    probeAccepts: async () => true,
    installDaemon: async () => ({ ok: true, lines: [] }),
    backup: () => undefined,
    register: () => undefined,
    arrangement: () => "stdio",
    present: (cli) => cli !== "gemini",
    ...o.ensure,
  };
}

async function go(o: Opts = {}) {
  if (o.noChroma !== true) {
    const chroma = path.join(path.dirname(python), "chroma");
    fs.writeFileSync(chroma, "#!/bin/sh\n");
    fs.chmodSync(chroma, 0o755);
  }
  const stdin = new PassThrough();
  stdin.end();
  const out: string[] = [];
  const err: string[] = [];
  let state: FlowState | undefined;
  const deps: FlowDeps = {
    argv: ["--answer", `install-seqthink=${o.answer ?? "yes"}`],
    stdin,
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    env: { HOME: home, CREWRIG_TEST_SERVICE_PLATFORM: "linux" },
    platform: process.platform,
    home,
    repoDir: repo,
    spawn,
    steps: {
      "mcp-prepare": prepare,
      mcp: async (env) => {
        state = env.state;
        await mcpStep(env);
      },
    },
    seams: {
      detect: { detect: () => (o.noPython === true ? undefined : python) },
      offer: { pin: () => PIN },
      chroma: { health: async () => true, now: () => 0, sleep: async () => undefined },
      ensureHttp: ensureDeps(o),
    },
  };
  const status = await runSetup(descriptor(["mcp-prepare", "mcp"], "antigravity"), deps);
  return { status, out: norm(out.join("")), err: err.join(""), state };
}

const entries = (): Record<string, unknown> =>
  (JSON.parse(fs.readFileSync(target(), "utf8")) as { mcpServers: Record<string, unknown> })
    .mcpServers;
/** The output without the echo of the pre-supplied answer (the shell's `fzf` printed nothing). */
const bare = (out: string): string => out.replace(ECHO("yes"), "").replace(ECHO("no"), "");

describe("antigravity mcp steps", { skip: !posix }, () => {
  it("mcp-prepare prints the resolved path and creates the directory", async () => {
    const out: string[] = [];
    const stdin = new PassThrough();
    stdin.end();
    await runSetup(descriptor(["mcp-prepare"], "antigravity"), {
      argv: [],
      stdin,
      stdout: { write: (t) => out.push(t) },
      stderr: { write: () => undefined },
      env: { HOME: home },
      platform: process.platform,
      home,
      repoDir: repo,
      steps: { "mcp-prepare": prepare },
    });
    assert.equal(out.join(""), `Configuring ${target()}...\n`);
    assert.ok(fs.statSync(path.dirname(target())).isDirectory());
  });

  it("default answers: prints the golden block, writes both servers", async () => {
    const r = await go();
    assert.equal(r.status, 0);
    assert.equal(bare(r.out), block("default-answers"));
    assert.equal(r.err, "");
    assert.deepEqual(Object.keys(entries()), ["mempalace", "sequentialthinking"]);
    assert.deepEqual(entries()["mempalace"], {
      command: "bash",
      args: [
        path.join(repo, "scripts/lib/tls-exec.sh"),
        python,
        path.join(repo, "scripts/lib/mempalace-http-wrapper.py"),
      ],
    });
    assert.equal(r.state?.mempalaceInstalled, true);
    assert.equal(fs.statSync(target()).mode & 0o777, 0o600);
  });

  it("the question follows the Chroma install and precedes the write and the registration", async () => {
    const events: string[] = [];
    const r = await go({ events });
    assert.deepEqual(events, ["stdio-written"]);
    const at = (text: string): number => r.out.indexOf(text);
    assert.ok(at("Enabled and started") < at(ECHO("yes")));
    assert.ok(at(ECHO("yes")) < at("  mempalace MCP server configured."));
    assert.ok(at("  sequentialthinking MCP server configured.") < at("Shared memory daemon"));
  });

  it("answering no leaves Sequential Thinking out", async () => {
    const r = await go({ answer: "no" });
    assert.deepEqual(Object.keys(entries()), ["mempalace"]);
    assert.ok(!r.out.includes("sequentialthinking MCP server configured."));
  });

  it("operator-mcp-preserved: the operator's server survives, the backup holds the original", async () => {
    seed(".gemini/config/mcp_config.json", `${OPERATOR}\n`);
    const r = await go();
    assert.equal(bare(r.out), block("operator-mcp-preserved"));
    const [backup] = fs.readdirSync(path.dirname(target())).filter((f) => f.includes(".bak."));
    assert.ok(backup !== undefined);
    assert.equal(
      fs.readFileSync(path.join(path.dirname(target()), backup), "utf8"),
      `${OPERATOR}\n`,
    );
    assert.ok("operator-tool" in entries());
  });

  it("org-mcp-declared: the org servers fold in and the org wins", async () => {
    seed(".gemini/config/mcp_config.json", `${OPERATOR}\n`);
    fs.writeFileSync(path.join(repo, "mcp-servers.org.json"), `${ORG}\n`);
    const r = await go();
    assert.equal(bare(r.out), block("org-mcp-declared"));
    assert.deepEqual(Object.keys(entries()).sort(), [
      "mempalace",
      "operator-tool",
      "org-remote",
      "org-stdio",
      "sequentialthinking",
    ]);
  });

  it("ensure-http-rc1: only the stdio warning is printed, the entry stays, no throw", async () => {
    const lines = block("ensure-http-rc1").split("\n");
    const from = lines.findIndex((l) => l.includes("installing and starting it (R18)")) + 1;
    const to = lines.findIndex((l) => l.includes("the daemon supervisor refused"));
    const r = await go({
      ensure: {
        probeAccepts: async () => false,
        installDaemon: async () => ({ ok: false, lines: lines.slice(from, to) }),
      },
    });
    assert.equal(r.status, 0);
    assert.equal(bare(r.out), block("ensure-http-rc1"));
    assert.equal(r.state?.mempalaceInstalled, true);
    assert.ok("mempalace" in entries());
  });

  it("ensure-http-rc2: only the lockout warning is printed, the entry stays, no throw", async () => {
    const r = await go({
      ensure: {
        readToken: () => {
          throw new Error("no token");
        },
      },
    });
    assert.equal(r.status, 0);
    assert.equal(bare(r.out), block("ensure-http-rc2"));
    assert.ok("mempalace" in entries());
  });

  it("chroma-install-failure: exit 1 after the install's ERROR line, nothing written", async () => {
    const r = await go({ noChroma: true });
    assert.equal(r.status, 1);
    assert.equal(bare(r.out), `${block("chroma-install-failure", undefined)}\n`);
    assert.equal(fs.existsSync(target()), false);
  });

  it("MemPalace absent: only Sequential Thinking is written, nothing is ensured", async () => {
    const events: string[] = [];
    const r = await go({ noPython: true, events });
    assert.equal(r.status, 0);
    assert.deepEqual(events, []);
    assert.equal(r.state?.mempalaceInstalled, false);
    assert.deepEqual(Object.keys(entries()), ["sequentialthinking"]);
    assert.ok(r.out.includes("  MemPalace not found.\n"));
    assert.ok(
      r.out.endsWith(
        "  sequentialthinking MCP server configured.\n  Installed: mcp_config.json\n\n",
      ),
    );
  });
});
