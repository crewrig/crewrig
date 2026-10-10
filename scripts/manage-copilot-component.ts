// manage-copilot-component.ts — install or link one Copilot CLI component into the user's home (spec 0255,
// ported from the shell script of the same name, which stays as a forwarding shim).
//
// Usage: node scripts/manage-copilot-component.ts <install|link> <type> [name]
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs
// Node.js 24 or later.
//
// The descriptor lives in scripts/lib/manage/descriptors.ts; `manageMain` there holds the order
// of operations and the exit codes; `entry.ts` builds the context from `process`.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/build-extension.ts, do not
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
    const { COPILOT } = await import("./lib/manage/descriptors.ts");
    const { runManageEntry } = await import("./lib/manage/entry.ts");
    process.exitCode = await runManageEntry(COPILOT, __filename);
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
