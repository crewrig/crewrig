// spec-view.ts — CLI entry of spec 0273: print a spec and its deltas as one
// read-only Markdown document on stdout.
//
//   task spec:view -- <id>        (id with or without zero padding)

import { renderView } from "./lib/spec-view.ts";
import { WiringError, repoRoot } from "./lib/ts-scope.ts";

let root: string;
try {
  root = repoRoot();
} catch (e) {
  if (!(e instanceof WiringError)) throw e;
  process.stderr.write(`spec-view: wiring fault: ${e.message}\n`);
  process.exit(2);
}

const result = renderView(root, process.argv[2] ?? "");
if (result.ok) {
  process.stdout.write(result.text);
} else {
  process.stderr.write(`${result.error}\n`);
  process.exitCode = 1;
}
