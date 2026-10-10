// uninstall-mcp-daemon.ts — end the shared MemPalace MCP HTTP daemon and remove its unit (spec 0252
// requirements 1 to 5; plan v3 PR D). It replaces the shell tool of the same
// name, which stays as a forwarding shim. Messages and exit statuses are those
// of the shell; the logic lives in scripts/lib/service/mcp-lifecycle.ts.
//
// ENTRY FORM (spec 0243 R5) — as scripts/build-components.ts: no top-level
// `import`/`export`, the `warning` listeners removed first, no
// `uncaughtException` handler, `process.exitCode` and never `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { servicePlatform } = await import("./lib/service/exec.ts");
    const { uninstallMcp } = await import("./lib/service/mcp-lifecycle.ts");
    process.exitCode = await uninstallMcp({
      env: process.env,
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
