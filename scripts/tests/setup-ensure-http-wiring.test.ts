// setup-ensure-http-wiring.test.ts — the production seams of ensureMempalaceHttp
// (scripts/lib/setup/ensure-http-probe.ts): the serving gate against a real loopback HTTP server,
// and the registration wiring (backup before the write, `claude mcp remove` through the Spawner).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";

import { probeAccepts } from "../lib/service/daemon-replace.ts";
import type { SpawnResult, Spawner } from "../lib/setup/context.ts";
import { ensureMempalaceHttp } from "../lib/setup/ensure-http.ts";
import { defaultEnsureHttpDeps } from "../lib/setup/ensure-http-probe.ts";
import type { EnsureHttpDeps } from "../lib/setup/ensure-http.ts";

const TOKEN = "T".repeat(48);

let dir: string;
let out: string[];
let events: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-ensure-wiring-")));
  out = [];
  events = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = (env: Record<string, string> = {}) => ({
  io: { out: (l: string) => out.push(l), err: () => undefined, errRaw: () => undefined },
  env,
  platform: process.platform,
  home: dir,
  repoDir: dir,
});
const ok: SpawnResult = { status: 0, stdout: "", stderr: "" };
const noSpawn: Spawner = () => ok;

/** Fakes for every seam but the probe, which the caller supplies. */
const fakes = (probe: EnsureHttpDeps["probeAccepts"]): EnsureHttpDeps => ({
  readToken: () => TOKEN,
  probeAccepts: probe,
  installDaemon: async () => ({ ok: true, lines: [] }),
  backup: () => undefined,
  register: () => void events.push("register"),
  arrangement: () => "http",
  present: () => true,
});

const run = (deps: EnsureHttpDeps, env: Record<string, string> = {}) =>
  ensureMempalaceHttp({ ctx: ctx(env), cli: "gemini", spawn: noSpawn, deps });

/** A loopback server answering /healthz 200 and /mcp 401, recording every request. */
async function server(): Promise<{
  port: string;
  seen: http.IncomingMessage[];
  close: () => void;
}> {
  const seen: http.IncomingMessage[] = [];
  const srv = http.createServer((req, res) => {
    seen.push(req);
    req.resume();
    res.statusCode = req.url === "/healthz" ? 200 : 401;
    res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { port: String((srv.address() as AddressInfo).port), seen, close: () => srv.close() };
}

describe("the serving gate", () => {
  it("/healthz 200 with tools/list 401 is status 1, never 0", async () => {
    const srv = await server();
    try {
      const deps = fakes((h, p, t) => probeAccepts(h, p, t));
      assert.equal(await run(deps, { MEMPALACE_MCP_PORT: srv.port }), 1);
      assert.ok(srv.seen.length >= 2 && srv.seen.every((r) => r.url === "/mcp"));
      assert.ok(srv.seen.every((r) => r.headers.authorization === `Bearer ${TOKEN}`));
      assert.deepEqual(events, []);
    } finally {
      srv.close();
    }
  });

  it("a non-loopback host never receives the bearer: status 1", async () => {
    const srv = await server();
    try {
      const deps = fakes((h, p, t) => probeAccepts(h, p, t));
      const rc = await run(deps, { MEMPALACE_MCP_HOST: "0.0.0.0", MEMPALACE_MCP_PORT: srv.port });
      assert.equal(rc, 1);
      assert.equal(srv.seen.filter((r) => r.headers.authorization !== undefined).length, 0);
      assert.equal(srv.seen.length, 0);
      assert.ok(
        out.includes(
          "  Daemon not accepting on 0.0.0.0:" +
            srv.port +
            " — installing and starting it (R18)...",
        ),
      );
      assert.deepEqual(events, []);
    } finally {
      srv.close();
    }
  });
});

describe("the production registration seams", () => {
  const endpoint = { host: "127.0.0.1", port: "41893" };

  it("takes no backup of its own (the setup backed the file up earlier), runs the remover through the Spawner, then writes the entry", () => {
    const file = path.join(dir, ".claude.json");
    fs.writeFileSync(file, '{"mcpServers":{"mempalace":{"command":"old"}}}\n');
    const calls: (readonly string[])[] = [];
    const spawn: Spawner = (argv) => (calls.push(argv), ok);
    const deps = defaultEnsureHttpDeps(ctx(), spawn, endpoint);
    deps.backup("claude");
    deps.register("claude", TOKEN);
    assert.deepEqual(calls, [["claude", "mcp", "remove", "--scope", "user", "mempalace"]]);
    assert.deepEqual(out, [], "the backup prints nothing, as the shell's write does not");
    const baks = fs.readdirSync(dir).filter((n) => n.startsWith(".claude.json.bak."));
    assert.equal(
      baks.length,
      0,
      "ensure_mempalace_http writes no .bak file: the setup backs the config up earlier",
    );
    const doc: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const servers = (doc as { mcpServers: Record<string, unknown> }).mcpServers;
    const entry = servers["mempalace"];
    assert.deepEqual(entry, {
      type: "http",
      url: "http://127.0.0.1:41893/mcp",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.ok(!calls.flat().some((a) => a.includes(TOKEN)), "the bearer is on no argv");
  });

  it("a gemini file that does not exist makes the write fail, status 2 end to end", async () => {
    const real = defaultEnsureHttpDeps(ctx(), noSpawn, endpoint);
    const rc = await run({
      ...fakes(async () => true),
      backup: real.backup,
      register: real.register,
    });
    assert.equal(rc, 2);
    assert.ok(
      out.includes(
        "  ERROR: registering gemini against the verified-serving daemon failed (exit 2).",
      ),
    );
  });
});
