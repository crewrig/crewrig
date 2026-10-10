// install-golden-regen.ts — regenerate scripts/tests/fixtures/install-golden/ from the TypeScript
// entries (spec 0255 R27). The goldens were first generated from the real shell (PR C, committed);
// since the switch (PR E) the shell scripts are forwarding shims, so the regeneration runs the
// TypeScript entries explicitly (leg `node`) and the stored bytes now guard that output, compared
// byte for byte by install-golden.test.ts. A regeneration that changes a stored file is a behaviour
// change to review, not a refresh. One command:
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/install-golden-regen.ts
//
// Every stored file carries a `.golden` suffix (the shell ratchet counts .sh/.js/shebang files);
// the command prints the files written.

import fs from "node:fs";
import path from "node:path";

import { goldenBytes } from "./extension-run.ts";
import { observe } from "./install-golden-cases.ts";

const GOLDEN = path.resolve(import.meta.dirname, "..", "fixtures", "install-golden");

function main(): number {
  const changed: string[] = [];
  fs.rmSync(GOLDEN, { recursive: true, force: true });
  for (const [name, text] of observe("node")) {
    const file = path.join(GOLDEN, ...`${name}.golden`.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, goldenBytes(Buffer.from(text)));
    changed.push(name);
  }
  process.stdout.write(`${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();
