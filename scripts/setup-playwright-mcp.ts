// setup-playwright-mcp.ts — CLI entry of `task setup:playwright-mcp` (spec 0245).
//
// The logic lives in scripts/lib/playwright-mcp.ts (model:
// scripts/lib/playwright-mcp-shape.ts). Run it from the checkout you keep:
// every registration points at that checkout's scripts/lib/tls-exec.sh.
//
//   node scripts/lib/node-floor-guard.js && \
//     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/setup-playwright-mcp.ts
//   task setup:playwright-mcp

import { spawn } from "node:child_process";

import { repoRootFrom } from "./lib/paths.ts";
import { main, type RunResult } from "./lib/playwright-mcp.ts";

function runCli(argv: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    if (cmd === undefined) {
      resolve({ status: 127, stdout: "", stderr: "empty command" });
      return;
    }
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (error) => resolve({ status: 127, stdout, stderr: error.message }));
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

process.exitCode = await main(process.argv.slice(2), {
  run: runCli,
  env: process.env,
  now: () => new Date(),
  repoRoot: repoRootFrom(import.meta.url),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
