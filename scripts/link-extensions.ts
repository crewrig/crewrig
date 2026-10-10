// link-extensions.ts — Link every upstream extension into ~/.gemini/extensions (spec 0255, ported from the shell tool of the
// same name, which stays beside it until the shell is retired).
//
// Usage: node scripts/link-extensions.ts [--include-org]
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs
// Node.js 24 or later. The modules live under scripts/lib/install/.
//
// ENTRY FORM (spec 0255 R3; spec 0250 R3) — the form of scripts/build-extension.ts, do not
// "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so Node.js loads the
//    file as CommonJS and prints no MODULE_TYPELESS_PACKAGE_JSON warning for it; the module
//    graph comes from `import()`.
//  - The first statement removes the `warning` listeners.
//  - No `uncaughtException` handler: it would blind the deprecation channel.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { processCtx } = await import("./lib/install/ctx.ts");
    const { linkExtensionsMain } = await import("./lib/install/extension.ts");
    const { argv, ctx } = processCtx(__filename);
    process.exitCode = await linkExtensionsMain(ctx, argv);
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
