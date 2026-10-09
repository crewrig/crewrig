// chroma-launch-env.test.ts — two properties of the ChromaDB launch that the review of
// PR C raised (i1-F22, i1-F23): a `py -3` launcher is never spawned by its bare name
// (Windows would look in the current directory first), and the daemon keeps the user's whole
// environment, as the shell launcher left it (a model-hub or proxy credential is not ours
// to remove), while every other launch keeps scrubbing secret-looking keys.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveInterpreter } from "../lib/service/chroma-launch.ts";
import { launchDaemon } from "../lib/service/exec.ts";

test("a py launcher that is not on the search path is not spawned by its bare name", () => {
  assert.equal(resolveInterpreter("py -3", { PATH: "" }, "win32"), undefined);
});

async function child(unscrubbedEnv: boolean): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chroma-env-"));
  const out = path.join(dir, "seen.txt");
  try {
    launchDaemon(
      process.execPath,
      ["-e", "require('fs').writeFileSync(process.env.OUT, process.env.HF_TOKEN ?? 'absent')"],
      { env: { PATH: process.env["PATH"], HF_TOKEN: "kept", OUT: out }, unscrubbedEnv },
    );
    for (let i = 0; i < 100 && !fs.existsSync(out); i++)
      await new Promise((r) => setTimeout(r, 50));
    return fs.readFileSync(out, "utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the daemon launch keeps a secret-looking variable when asked, and scrubs it by default", async () => {
  assert.equal(await child(true), "kept");
  assert.equal(await child(false), "absent");
});
