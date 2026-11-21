// check-extension-manifest-version.ts — one authoritative version per extension
// (spec 0044 R5/R6 as amended by delta-01; TypeScript twin of the shell script).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-extension-manifest-version.ts
// Scans extensions/{core,library}/*/ under the current directory; every committed
// extension.json must declare the same `version` as its sibling package.json, and every
// skill/agent provenance carrier the same `version` plus `extension` = the directory name (0312).
//
// Exit: 0 every manifest agrees, 1 divergence or retired shape, 2 unparseable manifest.
// Finding lines (stdout): `  FAIL <dir>/<file> — ...`; shape errors go to stderr as
// `VALIDATION-ERROR: ...`; passing lines `  OK   <dir> (version <v>)`.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateVersions } from "./lib/governance/ext-manifest-version.ts";

const libDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib");
const outcome = evaluateVersions(process.cwd(), libDir);
process.stdout.write(outcome.stdout);
process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
