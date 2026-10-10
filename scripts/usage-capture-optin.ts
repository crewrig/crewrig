// usage-capture-optin.ts — the usage-capture opt-in and the session-recording render and merge, one
// subcommand per public function of scripts/lib/usage-capture-optin.sh (spec 0256 requirement 33).
//
// Usage: node scripts/usage-capture-optin.ts [--platform <win32|linux|darwin>] <subcommand> [--result <file>] [--] <argument>...
// The leading `--platform` overrides the platform the subcommand decides the Windows forms from
// (the shell shim passes `win32` when its `uname -s` reports MINGW, MSYS or CYGWIN).
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs
// Node.js 24 or later. The logic lives in scripts/lib/setup/usage-capture-cli.ts.
//
// ENTRY FORM (spec 0255 R3; spec 0250 R3) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so Node.js loads the
//    file as CommonJS and prints no MODULE_TYPELESS_PACKAGE_JSON warning for it; the module
//    graph comes from `import()`.
//  - The first statement removes the `warning` listeners.
//  - No `uncaughtException` handler: it would blind the deprecation channel.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { buildProcessCtxParts } = await import("./lib/manage/entry.ts");
    const { usageCaptureCli } = await import("./lib/setup/usage-capture-cli.ts");
    const p = buildProcessCtxParts(__filename);
    const ctx = { io: p.io, env: p.env, platform: p.platform, home: p.home, repoDir: p.repoDir };
    process.exitCode = await usageCaptureCli(p.argv, ctx);
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
