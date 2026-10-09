// migrate-extension.ts — convert an extension source tree from the retired declaration shape
// into the current generic-schema form (spec 0183 R15; ported by spec 0254 R20). It replaces
// the shell tool of the same name, which stays as a forwarding shim.
//
// Usage: node scripts/migrate-extension.ts <extension-dir-or-name>
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs
// Node.js 24 or later. It reads no YAML, so no third-party package is loaded.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so Node.js loads the
//    file as CommonJS and prints no MODULE_TYPELESS_PACKAGE_JSON warning for it. The module
//    graph comes from `import()`.
//  - The first statement removes the `warning` listeners, which silences the entry's own
//    deferred warning and that of every module loaded below.
//  - No `uncaughtException` handler: it would blind the deprecation channel.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { migrateMain } = await import("./lib/extension/migrate-main.ts");
    process.exitCode = await migrateMain({
      argv: process.argv.slice(2),
      env: process.env,
      platform: process.platform,
      entryFile: __filename,
      io: {
        out: (line: string) => void process.stdout.write(`${line}\n`),
        err: (line: string) => void process.stderr.write(`${line}\n`),
        errRaw: (text: string) => void process.stderr.write(text),
      },
    });
  } catch (error) {
    // A path inside the message may hold a control character: show it as `\xNN`.
    const text = error instanceof Error ? error.message : String(error);
    const shown = Array.from(text, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
    }).join("");
    process.stderr.write(`Error: ${shown}\n`);
    process.exitCode = 1;
  }
})();
