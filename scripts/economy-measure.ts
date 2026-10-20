// economy-measure.ts — prints the before/after logbook-and-dossier measure of spec 0275 R-H2.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/economy-measure.ts [manifest.json]
// Default input: scripts/tests/fixtures/economy-1410/manifest.json. Exit 0 always: the pass/fail
// verdict against MIN_SAVING belongs to scripts/tests/economy-measure.test.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MIN_SAVING, measure } from "./lib/economy-transform.ts";
import type { Manifest } from "./economy-snapshot.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const file =
  process.argv[2] ?? path.join(here, "tests", "fixtures", "economy-1410", "manifest.json");
const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
const m = measure(manifest);
const row = (name: string, t: typeof m.old): string =>
  `${name.padEnd(4)} comments=${t.comments} posted=${t.postedBytes} dossier-read=${t.dossierReadBytes} total=${t.totalBytes}`;
console.log(`source: ${manifest.source}`);
console.log(row("old", m.old));
console.log(row("new", m.new));
for (const k of Object.keys(m.old.byKind) as (keyof typeof m.old.byKind)[])
  console.log(
    `  ${k.padEnd(8)} old ${m.old.byKind[k].comments}/${m.old.byKind[k].bytes}  new ${m.new.byKind[k].comments}/${m.new.byKind[k].bytes}`,
  );
console.log(
  `new (uncapped, disclosure) comments=${m.uncapped.comments} total=${m.uncapped.totalBytes} saving=${(m.uncappedSaving * 100).toFixed(1)}%`,
);
console.log(
  `relocated to linked artifacts (R-E3, not counted): ${m.relocatedBytes} bytes from ${m.cappedComments} capped comments`,
);
console.log(
  `saving (capped): ${(m.saving * 100).toFixed(1)}% (floor ${(MIN_SAVING * 100).toFixed(0)}%)`,
);
