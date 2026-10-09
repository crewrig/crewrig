// usage-backfill.ts — replays the capture step for Claude Code, Gemini CLI
// and Copilot CLI against records already present on this machine (spec 0206
// R23), reusing the same per-CLI adapters and cursors the live hook path
// uses (scripts/lib/usage-capture/backfill.js). Does NOT cover Antigravity
// CLI (R23 — its capture channel exposes no durable history to replay) and
// touches no other import script's sources, targets or state (R24 — a distinct
// store, a distinct purpose).
//
// Usage:
//   node scripts/usage-backfill.ts [--reset-cursors]
//
// --reset-cursors clears ~/.crewrig/usage/state/<cli>/ for the three covered
// CLIs first, so a machine whose spool was discarded before spec 0207 landed
// can re-derive everything from the CLIs' own durable history — the true
// record of source. It is also the recovery path for a live capture step
// that stopped firing because the wired in-repo absolute path moved out from
// under it (Risks — "the accepted cost of the in-repo absolute path"): this
// script is repo-resident, invoked directly, and depends on no manifest, so
// it re-derives whatever the dead live path missed.
//
// Spec 0253 R7: the shell predecessor stays as a forwarding shim; this entry runs
// scripts/lib/usage-capture/backfill.js in a child Node.js process through scripts/lib/usage-wrapper.ts.
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
    process.exitCode = runJs("usage-capture/backfill.js", process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
