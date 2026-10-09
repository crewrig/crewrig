// build-extension.ts — render an extension's declarations for the four supported CLIs and check
// that no generated output is committed (spec 0173, ported by spec 0254). It replaced the
// shell tool of the same name, which stays as a forwarding shim.
//
// Usage: node scripts/build-extension.ts [--target gemini|claude|copilot|antigravity|all]
//          [<extension-dir-or-name> ...]
//        node scripts/build-extension.ts --check [<extension-dir-or-name> ...]
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs
// Node.js 24 or later; `js-yaml` comes from the setup dependency step.
//
// The modules live under scripts/lib/extension/; `build-main.ts` there holds the order of
// operations and the exit codes.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/build-components.ts, do not
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
    const { buildMain } = await import("./lib/extension/build-main.ts");
    process.exitCode = await buildMain({
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
