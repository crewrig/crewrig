// switch-mempalace-http.ts — switch every supported assistant to the shared
// MemPalace MCP HTTP daemon (spec 0252 requirement 18; plan v3 PR D). It replaces
// the shell tool of the same name, which stays as a forwarding shim. Flags, usage
// text, messages and exit statuses are those of the shell; the logic lives in
// scripts/lib/service/switch-transaction.ts.
//
// ENTRY FORM (spec 0243 R5) — as scripts/build-components.ts: no top-level
// `import`/`export`, the `warning` listeners removed first, no
// `uncaughtException` handler, `process.exitCode` and never `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { servicePlatform } = await import("./lib/service/exec.ts");
    const { runSwitch, USAGE } = await import("./lib/service/switch-transaction.ts");
    const { homedir } = await import("node:os");
    const out = (line: string): void => void process.stdout.write(`${line}\n`);
    const err = (line: string): void => void process.stderr.write(`${line}\n`);
    let rotate = false;
    for (const arg of process.argv.slice(2)) {
      if (arg === "--rotate" || arg === "-r") {
        rotate = true;
      } else if (arg === "-h" || arg === "--help") {
        for (const line of USAGE) out(line);
        return;
      } else {
        err(`ERROR: unknown argument '${arg}'`);
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = await runSwitch({
      rotate,
      repoDir: __dirname + "/..",
      env: process.env,
      home: homedir(),
      platform: servicePlatform(),
      io: { out, err },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${text}\n`);
    process.exitCode = 1;
  }
})();
