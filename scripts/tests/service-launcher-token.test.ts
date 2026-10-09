// service-launcher-token.test.ts — launcher-token.ts and launcher-wait.ts
// (spec 0252 requirement 11(b), (c), (e), (f)) with the shell launcher's
// diagnostics.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  derivedTokenPath,
  readToken,
  tokenFilePath,
} from "../lib/service/launcher/launcher-token.ts";
import {
  canBind,
  chromaWaitSeconds,
  exportChromaEnv,
  portTakenMessage,
  waitForChroma,
} from "../lib/service/launcher/launcher-wait.ts";

const GOOD = "A".repeat(20) + "b_-" + "9".repeat(12);

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "launcher-token-"));
}

function withToken(content: string | null): { env: Record<string, string>; file: string } {
  const dir = tmp();
  const file = path.join(dir, "token");
  if (content !== null) fs.writeFileSync(file, content);
  return { env: { MEMPALACE_MCP_TOKEN_FILE: file }, file };
}

test("a good token is returned with whitespace stripped", () => {
  const { env } = withToken(`  ${GOOD}\n`);
  assert.deepEqual(readToken(env, "/nope"), { ok: true, token: GOOD });
});

test("absent file", () => {
  const { env, file } = withToken(null);
  const r = readToken(env, "/nope");
  assert.equal(r.ok, false);
  assert.ok(
    !r.ok &&
      r.message.startsWith(
        `bearer token file not found: ${file}\n       Refusing to start: MemPalace requires`,
      ),
  );
});

test("empty and whitespace-only files", () => {
  for (const content of ["", " \t\n  \n"]) {
    const { env, file } = withToken(content);
    const r = readToken(env, "/nope");
    assert.ok(
      !r.ok && r.message.startsWith(`bearer token file is empty or whitespace-only: ${file}\n`),
    );
    assert.ok(!r.ok && r.message.includes("short-circuits the bearer check"));
  }
});

test("a character outside [A-Za-z0-9_-]", () => {
  const { env, file } = withToken(`${GOOD}!`);
  const r = readToken(env, "/nope");
  assert.ok(
    !r.ok &&
      r.message ===
        `bearer token contains unexpected characters: ${file}\n       Refusing to start rather than guess how the server will interpret it.`,
  );
});

test("shorter than 32 characters, and exactly 32 accepted", () => {
  const short = withToken("a".repeat(31));
  const r = readToken(short.env, "/nope");
  assert.ok(
    !r.ok &&
      r.message ===
        `bearer token is shorter than 32 characters: ${short.file}\n       Refusing to start: a short token is not a credential. Re-provision it.`,
  );
  assert.equal(readToken(withToken("a".repeat(32)).env, "/nope").ok, true);
});

test("a directory is not a token file", () => {
  const r = readToken({ MEMPALACE_MCP_TOKEN_FILE: tmp() }, "/nope");
  assert.ok(!r.ok && r.message.startsWith("bearer token file not found:"));
});

test("the palace-keyed path equals the one usage-store/mcp.js derives", () => {
  const home = fs.realpathSync(tmp());
  const palace = path.join(home, "p", "palace");
  fs.mkdirSync(path.join(home, "p"), { recursive: true });
  const prior = { HOME: process.env.HOME, P: process.env.MEMPALACE_PALACE_PATH };
  process.env.HOME = home;
  process.env.MEMPALACE_PALACE_PATH = palace;
  try {
    const mcp = createRequire(import.meta.url)("../lib/usage-store/mcp.js") as {
      tokenPath: () => string;
    };
    const viaFile = mcp.tokenPath();
    assert.equal(derivedTokenPath(palace, home), viaFile);
    assert.equal(tokenFilePath({ MEMPALACE_PALACE_PATH: palace }, home), viaFile);
    fs.mkdirSync(palace);
    assert.equal(derivedTokenPath(palace, home), mcp.tokenPath(), "existing palace dir");
  } finally {
    if (prior.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = prior.HOME;
    if (prior.P === undefined) delete process.env.MEMPALACE_PALACE_PATH;
    else process.env.MEMPALACE_PALACE_PATH = prior.P;
  }
});

test("bind probe: free port binds, taken port is refused with the shell's text", async () => {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  assert.equal(await canBind("127.0.0.1", port), false);
  await new Promise<void>((r) => server.close(() => r()));
  assert.equal(await canBind("127.0.0.1", port), true);
  const text = portTakenMessage("127.0.0.1", String(port));
  assert.ok(
    text.startsWith(`port ${port} on 127.0.0.1 is already in use.\n       Retrying will not help`),
  );
  assert.ok(
    text.endsWith("Choose another:    MEMPALACE_MCP_PORT=<port> task mempalace:switch-http"),
  );
});

test("chroma wait: succeeds, retries once a second, fails on the deadline with the shell's text", async () => {
  assert.equal(chromaWaitSeconds(undefined), 60);
  assert.equal(chromaWaitSeconds("abc"), 60);
  assert.equal(chromaWaitSeconds("5"), 5);
  let clock = 0;
  const sleeps: number[] = [];
  const common = {
    host: "127.0.0.1",
    port: "8001",
    repoDir: "/repo",
    now: () => clock,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
  };
  let calls = 0;
  const ok = await waitForChroma({ ...common, probe: async () => ++calls === 3 });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(sleeps, [1000, 1000]);
  clock = 0;
  const bad = await waitForChroma({ ...common, waitSetting: "2", probe: async () => false });
  assert.ok(
    !bad.ok &&
      bad.message ===
        "ChromaDB daemon unreachable at 127.0.0.1:8001 after 2s.\n       The MCP daemon serves through it (ADR 0006) and will not start without it.\n       Check: bash /repo/scripts/status-chroma-server.sh",
  );
  const env: Record<string, string | undefined> = {};
  exportChromaEnv(env, "h", "9");
  assert.deepEqual(env, { MEMPALACE_CHROMA_HOST: "h", MEMPALACE_CHROMA_PORT: "9" });
});
