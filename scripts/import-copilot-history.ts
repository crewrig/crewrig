// import-copilot-history.ts — backfill MemPalace with pre-existing GitHub Copilot CLI transcripts.
//
// Usage:
//   node scripts/import-copilot-history.ts
//
// Spec 0253 R11-R15: the shell predecessor stays as a forwarding shim to this entry. The
// importer mines the history through `mempalace mine --mode convos` after a dry-run preview;
// re-runs are safe. Deviation (spec 0253 R25 item 2): the two yes/no questions are plain
// readline prompts, no longer an `fzf` menu, so `fzf` is no longer required.
//
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the
// command needs Node.js 24 or later.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it; the module graph comes from `import()`.
//  - The first statement removes the `warning` listeners.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { homedir } = await import("node:os");
    const { runImport } = await import("./lib/history-import/flow.ts");
    const { SOURCES } = await import("./lib/history-import/sources.ts");
    const { createPrompter } = await import("./lib/history-import/prompt.ts");
    const { detectInterpreter } = await import("./lib/history-import/detect.ts");
    const descriptor = SOURCES["copilot"];
    if (descriptor === undefined) throw new Error("no importer descriptor for copilot");
    process.exitCode = await runImport(descriptor, {
      env: process.env,
      home: homedir(),
      io: {
        out: (line) => process.stdout.write(`${line}\n`),
        err: (line) => process.stderr.write(`${line}\n`),
      },
      prompter: createPrompter(process.stdin, process.stdout),
      detectInterpreter: () => detectInterpreter(process.env),
    });
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
