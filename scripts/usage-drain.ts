// usage-drain.ts — the operator's one-shot, unbounded drain of 0206's
// spool/ into the journal (spec 0207 R-L). Every hook-triggered write
// already drains under a budget (CREWRIG_USAGE_DRAIN_BUDGET_MS, default
// 2000ms); this command pays the whole cost once, at a time the operator
// chooses (e.g. right after upgrading a machine that ran 0206 before 0207).
//
// Usage:
//   node scripts/usage-drain.ts
//
// Spec 0253 R7: the shell predecessor stays as a forwarding shim; this entry runs
// scripts/lib/usage-store/journal.js in a child Node.js process through scripts/lib/usage-wrapper.ts.
// It forwards no argument and defaults the drain budget to 0 (unbounded) when
// CREWRIG_USAGE_DRAIN_BUDGET_MS is unset or empty.
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
    const { runJs } = await import("./lib/usage-wrapper.ts");
    process.exitCode = runJs("usage-store/journal.js", [], {
      ...process.env,
      CREWRIG_USAGE_DRAIN_BUDGET_MS: process.env.CREWRIG_USAGE_DRAIN_BUDGET_MS || "0",
    });
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
