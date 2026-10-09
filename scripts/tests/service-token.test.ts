// service-token.test.ts — scripts/lib/service/token.ts (spec 0252 requirement 18):
// 48 characters of [A-Za-z0-9], mode 0600, exclusive create under a race, a
// whitespace-only file refused, and the token never on a spawned argument list.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mintToken, readOrCreateToken, TokenError } from "../lib/service/token.ts";

function dir(): string {
  return mkdtempSync(path.join(tmpdir(), "svc-token-"));
}

test("mintToken: 48 characters of [A-Za-z0-9], different each time", () => {
  const a = mintToken();
  assert.match(a, /^[A-Za-z0-9]{48}$/);
  assert.notEqual(a, mintToken());
});

test("readOrCreateToken: creates with mode 0600 in a 0700 directory, then reads it back", () => {
  const root = dir();
  try {
    const file = path.join(root, "server", "k", "token");
    const t = readOrCreateToken(file);
    assert.match(t, /^[A-Za-z0-9]{48}$/);
    assert.equal(readOrCreateToken(file), t);
    if (process.platform !== "win32") {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readOrCreateToken: strips whitespace and refuses a whitespace-only file", () => {
  const root = dir();
  try {
    const file = path.join(root, "token");
    writeFileSync(file, "  abc\n");
    assert.equal(readOrCreateToken(file), "abc");
    writeFileSync(file, " \n");
    assert.throws(() => readOrCreateToken(file), TokenError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exclusive create under a race: many concurrent callers all return one token", async () => {
  const root = dir();
  try {
    const file = path.join(root, "server", "k", "token");
    const script = `
      const { readOrCreateToken } = await import(${JSON.stringify(new URL("../lib/service/token.ts", import.meta.url).href)});
      process.stdout.write(readOrCreateToken(process.argv[1]));`;
    const { spawn } = await import("node:child_process");
    const run = (): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            "--input-type=module",
            "-e",
            script,
            file,
          ],
          { stdio: ["ignore", "pipe", "inherit"] },
        );
        let out = "";
        child.stdout.on("data", (c: Buffer) => (out += c.toString()));
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)),
        );
      });
    const results = await Promise.all(Array.from({ length: 8 }, run));
    assert.equal(new Set(results).size, 1, "every caller must read the single winner's token");
    assert.equal(readFileSync(file, "utf8"), results[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the token module and its callers carry no spawn with the token on the argument list", () => {
  const files = ["token.ts", "assistant-config.ts", "daemon-replace.ts", "switch-transaction.ts"];
  for (const f of files) {
    const src = readFileSync(new URL(`../lib/service/${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/(?:spawnSync|spawn|execFileSync|execFile)\(([^;]*?)\)/gs)) {
      assert.doesNotMatch(m[1] ?? "", /token/i, `${f}: a spawn mentions the token`);
    }
  }
});
