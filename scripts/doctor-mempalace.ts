// doctor-mempalace.ts — report which MemPalace will actually answer on this machine and
// flag any divergence (spec 0252 requirement 20; spec 0108 R7-R10; plan v3 PR E). It
// replaces the shell tool of the same name, which stays as a forwarding shim. Sections,
// messages and exit status are those of the shell; the logic lives in
// scripts/lib/service/doctor-*.ts.
//
// ENTRY FORM (spec 0243 R5) — as scripts/build-components.ts: no top-level
// `import`/`export`, the `warning` listeners removed first, no
// `uncaughtException` handler, `process.exitCode` and never `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { servicePlatform } = await import("./lib/service/exec.ts");
    const { doctorMempalace } = await import("./lib/service/doctor-run.ts");
    process.exitCode = await doctorMempalace({
      env: process.env,
      scriptDir: __dirname,
      platform: servicePlatform(),
      io: { out: (line: string) => void process.stdout.write(`${line}\n`) },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${text}\n`);
    process.exitCode = 1;
  }
})();
