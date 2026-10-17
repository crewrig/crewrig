// reserve-spec-id.ts — secure a spec id on the reference repository before the spec
// file exists (spec 0112; TypeScript twin of scripts/reserve-spec-id.sh, spec 0262).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts
//          --issue <N> | --id <ID> --issue <N> [--corpus upstream|org] [--offline] | --help
// Exit codes: 0 id secured (stdout: the id); 3 allocated locally and NOT secured
//   (stdout: the id, then `unsecured-id: true`); 1 genuine failure (stderr).
// Output: byte-identical to the shell twin under LC_ALL=C; the logic lives under
//   scripts/lib/spec-ids/.

import { runEntry } from "./lib/spec-ids/exit.ts";
import { reserveMain } from "./lib/spec-ids/reserve-run.ts";

runEntry(() => reserveMain(process.argv.slice(2), process.env));
