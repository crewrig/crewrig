// usage-dashboard.ts — the usage dashboard (spec 0210): one view model over
// the usage store and the comparative prices, in three delivery forms.
// Reference figures, never an invoice. Never reaches the network.
//
// Usage:
//   node scripts/usage-dashboard.ts page   [filters] [--as-of-today] [--out <path>]
//   node scripts/usage-dashboard.ts serve  [--port <n>]
//   node scripts/usage-dashboard.ts report [filters] [--as-of-today] [--json]
//
// Filters: --session <id> | --agent <id> --parent <id> | --task-key <key>
//   | --asset <kind>:<ref> | --cli <cli> | --fidelity <f> | --no-ledger
//   | --from <YYYY-MM-DD> | --to <YYYY-MM-DD> | --period <YYYY-MM>
//   | --model <id> | --bucket day|week|month | --currency <ISO4217>
//
// Spec 0253 R7: the shell predecessor stays as a forwarding shim; this entry runs
// scripts/lib/usage-dashboard/cli.js in a child Node.js process through scripts/lib/usage-wrapper.ts.
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
    process.exitCode = runJs("usage-dashboard/cli.js", process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
