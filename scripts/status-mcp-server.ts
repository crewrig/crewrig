// status-mcp-server.ts — report the state of the shared MemPalace MCP HTTP daemon (spec 0252
// requirements 1 to 5; plan v3 PR D). It replaces the shell tool of the same
// name, which stays as a forwarding shim. Messages and exit statuses are those
// of the shell; the logic lives in scripts/lib/service/mcp-status.ts.
//
// ENTRY FORM (spec 0243 R5) — as scripts/build-components.ts: no top-level
// `import`/`export`, the `warning` listeners removed first, no
// `uncaughtException` handler, `process.exitCode` and never `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { servicePlatform } = await import("./lib/service/exec.ts");
    const { statusMcp } = await import("./lib/service/mcp-status.ts");
    process.exitCode = await statusMcp({
      env: process.env,
      repoRoot: __dirname + "/..",
      platform: servicePlatform(),
      io: {
        out: (line: string) => void process.stdout.write(`${line}\n`),
        err: (line: string) => void process.stderr.write(`${line}\n`),
      },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${text}\n`);
    process.exitCode = 1;
  }
})();
