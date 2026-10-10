// setup-mcp-copilot-step.test.ts — the Copilot `mcp` step (spec 0256 requirements 25-28, delta-01)
// against fake seams in a temporary home and repository. The printed block and the sha256 of the
// written file are compared with the golden cells default-answers, operator-mcp-preserved,
// org-mcp-declared, ensure-http-rc0/1/2 and chroma-install-failure of the Copilot matrix.

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
import { run as mcpStep } from "../lib/setup/mcp-copilot-step.ts";
import { descriptor } from "./setup-flow-fixtures.ts";
import { normalize } from "./lib/setup-golden-tree.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const realRepo = path.resolve(here, "..", "..");
const golden = path.join(here, "fixtures", "setup-golden", "copilot");
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

let root: string;
let home: string;
let repo: string;
let python: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-mcp-copilot-")));
  home = path.join(root, "home");
  repo = path.join(root, "repo");
  python = path.join(home, ".local/share/pipx/venvs/mempalace/bin/python");
  const copy = (rel: string): void => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.copyFileSync(path.join(realRepo, rel), path.join(repo, rel));
  };
  copy("config/copilot/mcp-config.json.template");
  copy("config/systemd/mempalace-chroma-server.service");
  fs.mkdirSync(path.join(repo, "scripts/lib"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts/lib/tls-exec.sh"), "#!/bin/sh\n");
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "#!/bin/sh\n");
  // `rules-existing` creates `~/.copilot/instructions` before the MCP step runs.
  fs.mkdirSync(path.join(home, ".copilot", "instructions"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const target = (): string => path.join(home, ".copilot", "mcp-config.json");
const seed = (rel: string, body: string): void => {
  fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
  fs.writeFileSync(path.join(home, rel), body);
};
const norm = (text: string): string => normalize(text, { root, repo, home });

/** The golden block the step prints: from `Configuring` to the end of the section. */
function block(cell: string, until: string | undefined = "Installing library skills"): string {
  const text = fs.readFileSync(path.join(golden, cell, "stdout.golden"), "utf8");
  const from = text.indexOf("Configuring");
  const to = until === undefined ? text.length : text.indexOf(until);
  return text.slice(from, to);
}
const ok = (stdout = ""): SpawnResult => ({ status: 0, stdout, stderr: "" });
const spawn: Spawner = (argv) => ok(argv.includes("-c") ? "3.6.0\n" : "");

interface Opts {
  readonly ensure?: Partial<EnsureHttpDeps>;
  readonly noPython?: boolean;
  readonly noChroma?: boolean;
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
    argv: [],
    stdin,
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    env: { HOME: home, CREWRIG_TEST_SERVICE_PLATFORM: "linux" },
    platform: process.platform,
    home,
    repoDir: repo,
    spawn,
    steps: {
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
  const status = await runSetup(descriptor(["mcp"], "copilot"), deps);
  return { status, out: norm(out.join("")), err: err.join(""), state };
}

const entries = (): Record<string, unknown> =>
  (JSON.parse(fs.readFileSync(target(), "utf8")) as { mcpServers: Record<string, unknown> })
    .mcpServers;

describe("copilot mcp step", { skip: !posix }, () => {
  it("default answers: prints the golden block and writes the golden file", async () => {
    const r = await go();
    assert.equal(r.status, 0);
    assert.equal(r.out, block("default-answers"));
    assert.equal(r.state?.mempalaceInstalled, true);
    assert.equal(r.state?.pythonBin, python);
    assert.equal(r.state?.mempalaceVersion, "3.6.0");
    assert.equal(r.err, "");
    assert.equal(fs.statSync(target()).mode & 0o777, 0o600);
  });

  it("writes the stdio entry BEFORE the HTTP registration is attempted", async () => {
    const events: string[] = [];
    await go({ events });
    assert.deepEqual(events, ["stdio-written"]);
    const mempalace = entries()["mempalace"] as { command: string; args: string[] };
    assert.equal(mempalace.command, "bash");
    assert.deepEqual(mempalace.args, [
      path.join(repo, "scripts/lib/tls-exec.sh"),
      python,
      path.join(repo, "scripts/lib/mempalace-http-wrapper.py"),
    ]);
  });

  it("operator-mcp-preserved: the operator's server survives, the backup holds the original", async () => {
    seed(".copilot/mcp-config.json", `${OPERATOR}\n`);
    const r = await go();
    assert.equal(r.out, block("operator-mcp-preserved"));
    const [backup] = fs.readdirSync(path.dirname(target())).filter((f) => f.includes(".bak."));
    assert.ok(backup !== undefined);
    assert.equal(
      fs.readFileSync(path.join(path.dirname(target()), backup), "utf8"),
      `${OPERATOR}\n`,
    );
    assert.ok("operator-tool" in entries());
  });

  it("org-mcp-declared: the org servers fold in, the org wins over the operator's entry", async () => {
    seed(".copilot/mcp-config.json", `${OPERATOR}\n`);
    fs.writeFileSync(path.join(repo, "mcp-servers.org.json"), `${ORG}\n`);
    const r = await go();
    assert.equal(r.out, block("org-mcp-declared"));
    assert.deepEqual(Object.keys(entries()).sort(), [
      "mempalace",
      "operator-tool",
      "org-remote",
      "org-stdio",
      "sequentialthinking",
    ]);
  });

  it("ensure-http-rc1: only the stdio warning is printed, the entry stays, no throw", async () => {
    const r = await go({
      ensure: {
        probeAccepts: async () => false,
        installDaemon: async () => ({
          ok: false,
          lines: rcLines("ensure-http-rc1"),
        }),
      },
    });
    assert.equal(r.status, 0);
    assert.equal(r.out, block("ensure-http-rc1"));
    assert.equal(r.state?.mempalaceInstalled, true);
    assert.ok("mempalace" in entries());
  });

  it("ensure-http-rc2: only the lockout warning is printed, the entry stays, no throw", async () => {
    const r = await go({
      ensure: {
        readToken: () => {
          throw new Error("no token");
        },
        probeAccepts: async () => true,
      },
    });
    assert.equal(r.status, 0);
    assert.equal(r.out, block("ensure-http-rc2"));
    assert.equal(r.state?.mempalaceInstalled, true);
    assert.ok("mempalace" in entries());
  });

  it("ensure-http-rc0: the HTTP daemon line closes the section", async () => {
    const r = await go();
    assert.ok(r.out.includes("  MemPalace reaches shared memory through the HTTP daemon.\n\n"));
  });

  it("chroma-install-failure: exit 1 after the install's ERROR line, nothing written", async () => {
    const r = await go({ noChroma: true });
    assert.equal(r.status, 1);
    assert.equal(r.out, `${block("chroma-install-failure", undefined)}\n`);
    assert.equal(fs.existsSync(target()), false);
  });

  it("MemPalace absent: the template is written without mempalace, nothing is ensured", async () => {
    const events: string[] = [];
    const r = await go({ noPython: true, events });
    assert.equal(r.status, 0);
    assert.deepEqual(events, []);
    assert.equal(r.state?.mempalaceInstalled, false);
    assert.deepEqual(Object.keys(entries()), ["sequentialthinking"]);
    assert.match(
      r.out,
      /^Configuring ~\/\.copilot\/mcp-config\.json\.\.\.\n {2}MemPalace not found\.\n/,
    );
    assert.match(r.out, /\n {2}MemPalace install skipped\.|pipx not found/);
    assert.ok(r.out.includes("  Installed: mcp-config.json (mempalace omitted from mcpServers)\n"));
    assert.ok(r.out.endsWith("omitted from mcpServers)\n\n"));
  });

  it("an out-of-range MemPalace prints its two ERROR lines on stdout and exits 1", async () => {
    const strict = { pin: () => ({ min: "4.0.0", maxExclusive: "5" }) };
    const stdin = new PassThrough();
    stdin.end();
    const out: string[] = [];
    const status = await runSetup(descriptor(["mcp"], "copilot"), {
      argv: [],
      stdin,
      stdout: { write: (t) => out.push(t) },
      stderr: { write: () => undefined },
      env: { HOME: home },
      platform: process.platform,
      home,
      repoDir: repo,
      spawn,
      steps: { mcp: mcpStep },
      seams: { detect: { detect: () => python }, offer: strict },
    });
    assert.equal(status, 1);
    assert.equal(
      out.join(""),
      "Configuring ~/.copilot/mcp-config.json...\n" +
        "  ERROR: MemPalace 3.6.0 is outside the supported range >=4.0.0,<5.\n" +
        "         Install a supported version with: pipx install --force 'mempalace>=4.0.0,<5'\n",
    );
  });
});

/** The daemon-install lines the golden prints between the R18 notice and the R19 error. */
function rcLines(cell: string): string[] {
  const lines = block(cell).split("\n");
  const from = lines.findIndex((l) => l.includes("installing and starting it (R18)")) + 1;
  const to = lines.findIndex((l) => l.includes("the daemon supervisor refused"));
  return lines.slice(from, to);
}
