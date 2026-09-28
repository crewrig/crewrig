// usage-inventory.ts — CLI entry point for the MemPalace-only drawer
// inventory and purge for the usage-record store's `usage-records` room
// (spec 0239, issue #1206). Replaces the old scripts/usage-inventory.sh thin
// bash wrapper (spec 0238's shell/JS ratchet forbids adding a new shell or
// JavaScript file — see DEVELOPMENT.md, "TypeScript toolchain and ratchet").
//
// All logic lives in scripts/lib/usage-store/inventory.ts — this file is
// deliberately thin, mirroring the old shell wrapper's own role (an `exec`
// pass-through into the real module) rather than duplicating any of it. It
// is the sole process entry point for this feature and is never imported by
// another module (scripts/lib/usage-store/inventory.ts is the importable
// surface, exercised directly by scripts/tests/usage-inventory.test.ts's
// unit-level cases, and this file only by its own CLI black-box cases) — so,
// unlike a module that must distinguish "am I the entry point" from "was I
// imported" (Node's CommonJS `require.main === module`, or the ESM
// equivalent `import.meta.url === pathToFileURL(process.argv[1]).href`),
// this file has no such ambiguity to resolve: it always runs `main()`
// unconditionally.
//
// Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/usage-inventory.ts [list] [--wing <name>[,<name>...]] [--cli <cli>] [--period <YYYY-MM>] [--json]
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/usage-inventory.ts delete [--wing <name>[,<name>...]] [--cli <cli>] [--period <YYYY-MM>] [--json] [--commit [--confirm-count <N>]]

import { main } from "./lib/usage-store/inventory.ts";

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
