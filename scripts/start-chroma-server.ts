// start-chroma-server.ts — start the shared ChromaDB HTTP daemon (spec 0252
// requirement 13 and 14; plan v3 PR C). It replaces the shell tool of the same
// name, which stays as a forwarding shim. Messages and exit statuses are those
// of the shell; the logic lives in scripts/lib/service/chroma-launch.ts.
//
// ENTRY FORM (spec 0243 R5) — as scripts/build-components.ts: no top-level
// `import`/`export`, the `warning` listeners removed first, no
// `uncaughtException` handler, `process.exitCode` and never `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { startChroma } = await import("./lib/service/chroma-launch.ts");
    process.exitCode = await startChroma({
      env: process.env,
      repoRoot: __dirname + "/..",
      platform: process.platform,
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
