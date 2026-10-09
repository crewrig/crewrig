// usage-query.ts — read usage records by session, by agent+parent, by
// period, by task-handoff key, or by external asset reference (spec 0207
// R15-R17, spec 0208 R15). Output is JSONL, one record per line — verbatim
// unless a ledger override applies; --no-ledger returns the entry verbatim.
//
// Usage:
//   node scripts/usage-query.ts --session <id>
//   node scripts/usage-query.ts --agent <id> --parent <parentSessionId>
//   node scripts/usage-query.ts --period <YYYY-MM> [--cli <cli>]
//   node scripts/usage-query.ts --task-key <key>
//   node scripts/usage-query.ts --asset <kind>:<ref>
//   node scripts/usage-query.ts --undrained
//   node scripts/usage-query.ts --pending
//   ... any of the above plus --fidelity <per-request|run-total|session-cumulative>
//   ... any of the above plus --no-ledger (skip R15's ledger application)
//   ... any selector plus --rollup [--combined] (spec 0208 R20-R24; one JSON
//       object instead of one record per line)
//
// Selectors compose (#1205): --session, --agent+--parent, --period,
// --task-key, --asset, --cli and --fidelity are ANDed. A listing with
// --period reads only that month's partitions; with --rollup, --period is a
// placement bound instead (spec 0209 delta-01, docs/usage-pricing.md).
// --pending honours --fidelity only; --undrained takes no filter.
//
// Spec 0253 R7: the shell predecessor stays as a forwarding shim; this entry runs
// scripts/lib/usage-store/query.js in a child Node.js process through scripts/lib/usage-wrapper.ts.
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
    process.exitCode = runJs("usage-store/query.js", process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
