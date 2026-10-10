// repair-mempalace-http.ts — repair the residue left by an interrupted MemPalace
// switch (spec 0165; spec 0252 requirement 18; plan v3 PR E). It replaces the
// shell tool of the same name, which stays as a forwarding shim. Verbs, usage
// text, messages and exit statuses are those of the shell; the logic lives in
// scripts/lib/service/repair.ts.
//
// ENTRY FORM (spec 0243 R5) — as scripts/build-components.ts: no top-level
// `import`/`export`, the `warning` listeners removed first, no
// `uncaughtException` handler, `process.exitCode` and never `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { runRepair } = await import("./lib/service/repair.ts");
    const { homedir } = await import("node:os");
    const out = (line: string): void => void process.stdout.write(`${line}\n`);
    const err = (line: string): void => void process.stderr.write(`${line}\n`);
    process.exitCode = runRepair({
      argv: process.argv.slice(2),
      env: process.env,
      home: homedir(),
      io: { out, err },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${text}\n`);
    process.exitCode = 1;
  }
})();
