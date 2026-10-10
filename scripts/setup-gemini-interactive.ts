// setup-gemini-interactive.ts — set up CrewRig for gemini (spec 0256). The interactive questions can also be answered on the
// command line: `--answer <id>=<value>` (repeatable); `--link` links instead of copying.
//
// Usage: node scripts/setup-gemini-interactive.ts [--link] [--answer <id>=<value>]...
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js, as a SEPARATE step (never
// joined with `&&`): the tool needs Node.js 24 or later. The modules live under scripts/lib/setup/.
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
    const { geminiDescriptor } = await import("./lib/setup/cli-gemini.ts");
    const { runSetupEntry } = await import("./lib/setup/entry.ts");
    process.exitCode = await runSetupEntry(geminiDescriptor, __filename);
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
