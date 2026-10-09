// sync-from-upstream.ts — pull the core-layer files from the canonical upstream (spec 0020,
// spec 0086; ported by spec 0253 R19-R21). It replaces the shell tool of the same name,
// which stays as a forwarding shim.
//
// Usage: node scripts/sync-from-upstream.ts [--preserve-history]
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool
// needs Node.js 24 or later.
//
// The modules live under scripts/lib/sync-from-upstream/, one concern per file; `run.ts`
// there holds the order of operations and the exit codes.
//
// SELF-UPDATE RULE (spec 0253 R21) — the sync rewrites files under scripts/, this entry and
// its own modules included. The single `import()` below therefore loads the ENTIRE module
// graph, through the static imports of `run.ts`, before the first write. No module under
// scripts/lib/sync-from-upstream may call `import(` or `require(`: such a call would load
// a half-updated file in the middle of a run.
//
// ENTRY FORM (spec 0243 R5) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so Node.js loads
//    the file as CommonJS and prints no MODULE_TYPELESS_PACKAGE_JSON warning for it.
//  - The first statement removes the `warning` listeners, which silences the entry's own
//    deferred warning and that of every module loaded below.
//  - No `uncaughtException` handler: it would blind the deprecation channel.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/sync-from-upstream/run.ts");
    process.exitCode = await main(process.argv.slice(2), process.env, __filename);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${text}\n`);
    process.exitCode = 1;
  }
})();
