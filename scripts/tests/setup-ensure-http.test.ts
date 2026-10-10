// setup-ensure-http.test.ts — ensureMempalaceHttp (scripts/lib/setup/ensure-http.ts): the 0/1/2
// table of `ensure_mempalace_http` (spec 0256 requirement 26, deviation (o) of delta-01). The flow
// runs on fakes; the serving gate is exercised against a real loopback HTTP server.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { readOrCreateToken, TokenError } from "../lib/service/token.ts";
import type { Spawner } from "../lib/setup/context.ts";
import { ensureMempalaceHttp } from "../lib/setup/ensure-http.ts";
import type { EnsureHttpDeps } from "../lib/setup/ensure-http.ts";

const TOKEN = "T".repeat(48);
const PLACEHOLDER = "crewrig-setup-placeholder-not-a-credential";
const HEAD = [
  "",
  "Shared memory daemon (spec 0113 delta-02): defaulting gemini to HTTP.",
  "  Without it, every session spawns its own memory server and only the",
  "  first one to write can write — the rest are refused for their whole life.",
];
const REPAIR = [
  "  Repair: run 'task mempalace:status' to inspect the daemon, then",
  "          'task mempalace:switch-http' for the machine-wide conversion,",
  "          and re-run setup afterwards.",
];

let dir: string;
let out: string[];
let errs: string[];
let events: string[];
let probed: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-ensure-http-")));
  out = [];
  errs = [];
  events = [];
  probed = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = (env: Record<string, string> = {}) => ({
  io: {
    out: (l: string) => out.push(l),
    err: (l: string) => errs.push(l),
    errRaw: () => undefined,
  },
  env,
  platform: process.platform,
  home: dir,
  repoDir: dir,
});
const noSpawn: Spawner = () => ({ status: 0, stdout: "", stderr: "" });

/** Fakes for every seam; `accept` answers the probe in order (the last answer repeats). */
function fakes(o: Partial<EnsureHttpDeps> & { accept?: boolean[]; tokens?: string[] } = {}) {
  const accept = [...(o.accept ?? [true])];
  const tokens = [...(o.tokens ?? [TOKEN])];
  const deps: EnsureHttpDeps = {
    readToken: () => {
      const t = tokens.length > 1 ? tokens.shift() : tokens[0];
      if (t === undefined || t === "") throw new TokenError("unreadable");
      return t;
    },
    probeAccepts: async (_h, _p, token) => {
      probed.push(token);
      return (accept.length > 1 ? accept.shift() : accept[0]) === true;
    },
    installDaemon: async () => (events.push("install"), { ok: true, lines: ["  Installed."] }),
    backup: (cli) => void events.push(`backup:${cli}`),
    register: (cli) => void events.push(`register:${cli}`),
    arrangement: () => "http",
    present: () => true,
    ...o,
  };
  return deps;
}
const run = (deps: EnsureHttpDeps, env: Record<string, string> = {}, cli = "gemini" as const) =>
  ensureMempalaceHttp({ ctx: ctx(env), cli, spawn: noSpawn, deps });

describe("return code 0", () => {
  it("accepts, backs up, then registers; prints the shell's lines", async () => {
    assert.equal(await run(fakes()), 0);
    assert.deepEqual(events, ["backup:gemini", "register:gemini"]);
    assert.deepEqual(out, [
      ...HEAD,
      "  gemini now reaches shared memory through the daemon.",
      "",
      "  Restart any running gemini session to pick this up.",
    ]);
  });

  it("installs when the first probe refuses, re-reads the token and re-probes", async () => {
    const deps = fakes({ accept: [false, true], tokens: ["", TOKEN] });
    assert.equal(await run(deps), 0);
    assert.deepEqual(events, ["install", "backup:gemini", "register:gemini"]);
    assert.deepEqual(probed, [PLACEHOLDER, TOKEN]);
    assert.ok(
      out.includes("  NOTE: no readable bearer token — probing with a placeholder bearer."),
    );
    assert.ok(
      out.includes(
        "  Daemon not accepting on 127.0.0.1:41893 — installing and starting it (R18)...",
      ),
    );
    assert.ok(out.includes("  Installed."));
  });

  it("lists the other present assistants that are not on http", async () => {
    const arrangement = (c: string) =>
      c === "copilot" ? "stdio" : c === "claude" ? "none" : "http";
    assert.equal(await run(fakes({ arrangement: arrangement as never })), 0);
    assert.deepEqual(out.slice(5, 11), [
      "",
      "  NOTE: this run switched gemini only. Still on the previous arrangement:",
      "    - claude",
      "    - copilot",
      "  They will contend for the memory lock with gemini until they switch too.",
      "  Switch the whole machine at once with: task mempalace:switch-http",
    ]);
  });

  it("skips an absent assistant", async () => {
    const present = (c: string) => c !== "claude";
    assert.equal(await run(fakes({ present, arrangement: () => "none" }), {}, "gemini"), 0);
    assert.ok(!out.some((l) => l.includes("- claude")));
  });
});

describe("return code 1", () => {
  it("install refused with a readable token: the supervisor message and the repair tail", async () => {
    const deps = fakes({
      accept: [false],
      installDaemon: async () => ({ ok: false, lines: ["  ERROR: launchctl load failed."] }),
    });
    assert.equal(await run(deps), 1);
    assert.deepEqual(out.slice(4), [
      "  Daemon not accepting on 127.0.0.1:41893 — installing and starting it (R18)...",
      "  ERROR: launchctl load failed.",
      "  ERROR: the daemon supervisor refused to install or start (R19).",
      ...REPAIR,
    ]);
    assert.deepEqual(events, []);
  });

  it("install refused and the token unreadable: the provisioning message", async () => {
    const deps = fakes({
      accept: [false],
      tokens: [""],
      installDaemon: async () => ({ ok: false, lines: [] }),
    });
    assert.equal(await run(deps), 1);
    assert.ok(out.includes("  ERROR: the MCP bearer token could not be provisioned (R19)."));
    assert.deepEqual(out.slice(-3), REPAIR);
  });

  it("a throwing install is status 1, not an exception", async () => {
    const deps = fakes({
      accept: [false],
      installDaemon: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(await run(deps), 1);
    assert.ok(out.includes("  ERROR: the daemon supervisor refused to install or start (R19)."));
  });

  it("install ok but no token afterwards", async () => {
    let reads = 0;
    const readToken = (): string => {
      if (reads++ === 0) return TOKEN;
      throw new TokenError("gone");
    };
    assert.equal(await run(fakes({ accept: [false], readToken })), 1);
    assert.ok(
      out.includes("  ERROR: the installer succeeded but no usable bearer token exists (R19)."),
    );
    assert.deepEqual(out.slice(-3), REPAIR);
  });

  it("install ok but the daemon still refuses the authenticated probe", async () => {
    assert.equal(await run(fakes({ accept: [false, false] })), 1);
    assert.ok(
      out.includes(
        "  ERROR: the daemon was installed but still refuses authenticated requests (R19).",
      ),
    );
    assert.deepEqual(events, ["install"]);
  });

  it("a throwing probe counts as not accepting", async () => {
    const deps = fakes({
      probeAccepts: async () => {
        throw new Error("net");
      },
    });
    assert.equal(await run(deps), 1);
  });
});

describe("return code 2", () => {
  it("probe accepted only the placeholder bearer (whitespace-only token file)", async () => {
    const file = path.join(dir, "token");
    fs.writeFileSync(file, " \n\t ");
    const deps = fakes({ readToken: () => readOrCreateToken(file) });
    assert.equal(await run(deps), 2);
    assert.deepEqual(errs, [
      `  ERROR: the token file exists but is whitespace-only: ${file}\n` +
        "         Refusing to use it — an empty token disables authentication.",
    ]);
    assert.deepEqual(probed, [PLACEHOLDER]);
    assert.deepEqual(events, []);
    assert.deepEqual(out.slice(4), [
      "  NOTE: no readable bearer token — probing with a placeholder bearer.",
      "  WARNING: the daemon on 127.0.0.1:41893 is verified serving but no",
      "           readable bearer token exists for this palace, so registration",
      "           would point gemini at a credential that does not authenticate.",
      "           Keeping the existing registration untouched (exit 2).",
      ...REPAIR,
    ]);
  });

  it("the registration write failing", async () => {
    const deps = fakes({
      register: () => {
        throw new Error("EACCES");
      },
    });
    assert.equal(await run(deps), 2);
    assert.deepEqual(events, ["backup:gemini"]);
    assert.deepEqual(out.slice(4), [
      "  ERROR: registering gemini against the verified-serving daemon failed (exit 2).",
      ...REPAIR,
    ]);
  });

  it("claude absent from PATH: nothing is backed up or written", async () => {
    const deps = fakes({ present: (c) => c !== "claude" });
    assert.equal(await run(deps, {}, "claude" as never), 2);
    assert.deepEqual(events, []);
    assert.ok(
      out.includes(
        "  ERROR: registering claude against the verified-serving daemon failed (exit 2).",
      ),
    );
  });
});
