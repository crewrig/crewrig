// service-probe.test.ts — scripts/lib/service/probe.ts (spec 0252
// requirements 11(f), 15 and 27) against a loopback stub server.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isLoopbackHost, probe } from "../lib/service/probe.ts";

const seen: { method?: string; auth?: string; body: string }[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c.toString()));
  req.on("end", () => {
    seen.push({
      ...(req.method === undefined ? {} : { method: req.method }),
      ...(req.headers.authorization === undefined ? {} : { auth: req.headers.authorization }),
      body,
    });
    if (req.url === "/healthz") return void res.end("ok");
    if (req.url === "/status401") return void res.writeHead(401).end("no");
    if (req.url === "/hang") return;
    if (req.url === "/big") return void res.end("x".repeat(200_000));
    if (req.url === "/drip") {
      res.writeHead(200);
      const t = setInterval(() => res.write("."), 50);
      res.on("close", () => clearInterval(t));
      return;
    }
    res.end("echo:" + body);
  });
});
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

test("GET returns status and body", async () => {
  assert.deepEqual(await probe({ url: `${base}/healthz`, timeoutMs: 3000 }), {
    status: 200,
    body: "ok",
  });
  assert.deepEqual(await probe({ url: `${base}/status401`, timeoutMs: 2000 }), {
    status: 401,
    body: "no",
  });
});

test("POST sends the method, headers and body; loopback accepts a bearer header", async () => {
  seen.length = 0;
  const result = await probe({
    url: `${base}/mcp`,
    method: "POST",
    headers: { Authorization: "Bearer t0k3n", "content-type": "application/json" },
    body: '{"a":1}',
    timeoutMs: 3000,
  });
  assert.deepEqual(result, { status: 200, body: 'echo:{"a":1}' });
  assert.deepEqual(seen, [{ method: "POST", auth: "Bearer t0k3n", body: '{"a":1}' }]);
});

test("a non-loopback target refuses the authorization header and sends nothing", async () => {
  for (const host of ["example.com", "10.0.0.1", "0.0.0.0", "[::2]", "128.0.0.1"]) {
    const result = await probe({
      url: `http://${host}:9/`,
      headers: { authorization: "Bearer t0k3n" },
      timeoutMs: 500,
    });
    assert.deepEqual(
      result,
      { error: "refused: authorization header to a non-loopback host" },
      host,
    );
  }
});

test("a non-loopback target without the header is probed", async () => {
  const result = await probe({ url: "http://192.0.2.1:9/", timeoutMs: 150 });
  assert.ok("error" in result);
  assert.ok(!result.error.startsWith("refused"));
});

test("the loopback rule", () => {
  for (const ok of ["localhost", "::1", "[::1]", "127.0.0.1", "127.255.255.254"])
    assert.ok(isLoopbackHost(ok), ok);
  for (const bad of ["127.0.0.256", "127.0.0.01", "128.0.0.1", "example.com", "", "::2"])
    assert.ok(!isLoopbackHost(bad), bad);
});

test("the timeout is the caller's parameter and bounds a silent server", async () => {
  for (const timeoutMs of [150, 400]) {
    const started = Date.now();
    const result = await probe({ url: `${base}/hang`, timeoutMs });
    const elapsed = Date.now() - started;
    assert.deepEqual(result, { error: `timeout after ${timeoutMs} ms` });
    assert.ok(
      elapsed >= timeoutMs - 20 && elapsed < timeoutMs + 800,
      `${elapsed} ms for ${timeoutMs}`,
    );
  }
});

test("one timer covers connect to the last byte: a slow drip is cut", async () => {
  const started = Date.now();
  const result = await probe({ url: `${base}/drip`, timeoutMs: 300 });
  assert.deepEqual(result, { error: "timeout after 300 ms" });
  assert.ok(Date.now() - started < 1100);
});

test("an oversize body is an error, whatever the cap", async () => {
  assert.deepEqual(await probe({ url: `${base}/big`, timeoutMs: 3000 }), {
    error: "body exceeds 65536 bytes",
  });
  assert.deepEqual(await probe({ url: `${base}/big`, timeoutMs: 3000, maxBodyBytes: 1000 }), {
    error: "body exceeds 1000 bytes",
  });
  const fits = await probe({ url: `${base}/big`, timeoutMs: 3000, maxBodyBytes: 300_000 });
  assert.ok("body" in fits && fits.body.length === 200_000);
});

test("bad input resolves to an error instead of throwing", async () => {
  assert.deepEqual(await probe({ url: "not a url", timeoutMs: 100 }), { error: "invalid url" });
  assert.deepEqual(await probe({ url: "file:///etc/passwd", timeoutMs: 100 }), {
    error: "unsupported protocol",
  });
  assert.deepEqual(await probe({ url: `${base}/`, timeoutMs: 0 }), { error: "invalid timeout" });
  const refused = await probe({ url: "http://127.0.0.1:1/", timeoutMs: 1000 });
  assert.ok("error" in refused && refused.error.startsWith("request failed"));
});

test("an error never echoes the bearer value", async () => {
  const result = await probe({
    url: "http://127.0.0.1:1/",
    headers: { authorization: "Bearer SECRETVALUE" },
    timeoutMs: 1000,
  });
  assert.ok(!JSON.stringify(result).includes("SECRETVALUE"));
});

test("probe.ts spawns nothing and imports nothing from the transcript hook", () => {
  const source = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/service/probe.ts"),
    "utf8",
  );
  const code = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(code, /child_process|mempalace-transcript|add_drawer|jsonrpc/i);
});
