// usage-price.ts — compute comparative reference prices for usage records
// (spec 0209). Never an invoice.
//
// Usage:
//   node scripts/usage-price.ts --session <id>
//   node scripts/usage-price.ts --agent <id> --parent <parentSessionId>
//   node scripts/usage-price.ts --period <YYYY-MM> [--cli <cli>]
//   node scripts/usage-price.ts --task-key <key>
//   node scripts/usage-price.ts --asset <kind>:<ref>
//   ... any of the above plus --fidelity <per-request|run-total|session-cumulative>
//   ... any of the above plus --currency <ISO4217> [--as-of-today] [--no-store]
//   ... any of the above plus --rollup (one JSON object, per-fidelity sums + mixed marker)
//   node scripts/usage-price.ts --refresh-pricelist [--sha <sha>]
//   node scripts/usage-price.ts --refresh-fx [--fx-mirror frankfurter]
//   node scripts/usage-price.ts --cross-check <modelId>
//
// Selectors compose (#1205): --session, --agent+--parent, --period,
// --task-key, --asset, --cli and --fidelity are ANDed. With --rollup,
// --period is a placement bound instead (spec 0209 delta-01,
// docs/usage-pricing.md).
//
// Spec 0253 R7: the shell predecessor stays as a forwarding shim; this entry runs
// scripts/lib/usage-price/cli.js in a child Node.js process through scripts/lib/usage-wrapper.ts.
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
    process.exitCode = runJs("usage-price/cli.js", process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
