// ci-cache-guard.ts — portable script-level cache guard (spec 0147 R6/R7, spec 0170 delta-01);
// TypeScript entry that replaced the retired ci-cache-guard.sh (spec 0262 req 10).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts
//          [--cache-dir <dir>] [--key-files <f1,f2>] [--key-env <V1,V2>] -- <command...>
//        node ... scripts/ci-cache-guard.ts --capability <id> [--print-key] [-- <command...>]
//          (key files and env come from the effective cache.files/cache.env of ci/ci-capabilities.yml;
//          --print-key prints the content hash and exits 0)
//        node ... scripts/ci-cache-guard.ts --stray-scan -- <command...>
// Exit: 0 hit or success, the wrapped command's status, 2 usage, 70 stray, 71 detector inactive.

import { runGuard } from "./lib/ci-cache-guard/entry.ts";

process.exitCode = await runGuard(process.argv.slice(2), process.argv[1] ?? "ci-cache-guard.ts");
