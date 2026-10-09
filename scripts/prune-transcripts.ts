// prune-transcripts.ts — prune old session transcripts from MemPalace (spec 0253 R16-R18).
//
// Usage:
//   node scripts/prune-transcripts.ts [--days <days>] [--apply] [--project <name>]
//
// Options:
//   --days     Retention period in days (default: 30)
//   --apply    Actually delete drawers (dry-run mode by default)
//   --project  Prune only a specific project's transcripts (default: all)
//
// Environment:
//   MEMPALACE_PYTHON - Python binary with mempalace installed (auto-detected from pipx
//                      when not set, falls back to python3)
//
// The deletion itself is lib/history-import/prune_drawers.py, run by that interpreter. Run
// `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the command needs
// Node.js 24 or later. The shell predecessor, scripts/prune-transcripts.sh, stays as a
// forwarding shim to this entry.
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
    const { runPrune, realDeps, realIo, REPO_ROOT } =
      await import("./lib/history-import/prune-run.ts");
    const { installSpecFor } = await import("./lib/history-import/pin.ts");
    const { homedir } = await import("node:os");
    process.exitCode = runPrune(
      process.argv.slice(2),
      process.env,
      homedir(),
      realIo,
      realDeps(installSpecFor(REPO_ROOT)),
    );
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
