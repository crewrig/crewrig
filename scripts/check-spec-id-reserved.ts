// check-spec-id-reserved.ts — fail a pull request whose new spec claims an id that was never
// secured, or was secured for a different ticket (spec 0112 requirement 7 as replaced by
// delta-01; TypeScript twin of scripts/check-spec-id-reserved.sh, spec 0262).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-spec-id-reserved.ts [base-ref]
// Exit codes: 0 clean, reported (fork) or namespace unreadable; 1 blocking finding;
//   2 wiring fault (not a repository, unknown origin, unresolvable base).
// Output: byte-identical to the shell twin under LC_ALL=C; the logic lives under
//   scripts/lib/spec-ids/.

import { checkMain } from "./lib/spec-ids/check-run.ts";
import { runEntry } from "./lib/spec-ids/exit.ts";

runEntry(() => checkMain(process.argv.slice(2), process.env));
