// usage-mirror.ts — run the MemPalace catch-up for pending usage-store
// mirror markers (spec 0207 R13). With no arguments, walks
// <root>/mirror/pending/ only — O(pending), the shape journal.js spawns
// detached after a write. --reconcile additionally recomputes the pending
// set from the WHOLE journal first (spec 0207 step 7(d)), for after
// mirror/ or cache/ is lost, or MemPalace installed later.
//
// Usage:
//   node scripts/usage-mirror.ts
//   node scripts/usage-mirror.ts --reconcile
//
// Spec 0253 R7: the shell predecessor stays as a forwarding shim; this entry runs
// scripts/lib/usage-store/mirror.js in a child Node.js process through scripts/lib/usage-wrapper.ts.
// Arguments are forwarded verbatim and in order.
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
    const { runJs } = await import("./lib/usage-wrapper.ts");
    process.exitCode = runJs("usage-store/mirror.js", process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
