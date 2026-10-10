// install-golden-regen.ts — regenerate scripts/tests/fixtures/install-golden/ from the SHELL
// scripts (spec 0255 R27, PR C step 17). The shell is the oracle until PR E; the golden keeps the
// bytes it produced once the differential test is gone. One command, Linux and macOS only (bash,
// jq):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/install-golden-regen.ts
//
// Every stored file carries a `.golden` suffix (the shell ratchet counts .sh/.js/shebang files);
// the command prints the files that changed.

import fs from "node:fs";
import path from "node:path";

import { goldenBytes } from "./extension-run.ts";
import { observe } from "./install-golden-cases.ts";
import { which } from "./worktree-fixtures.ts";

const GOLDEN = path.resolve(import.meta.dirname, "..", "fixtures", "install-golden");

function main(): number {
  if (process.platform === "win32") {
    process.stderr.write("Error: the golden is regenerated on Linux or macOS.\n");
    return 1;
  }
  if (which("jq") === null) {
    process.stderr.write("Error: jq is needed to run the shell scripts.\n");
    return 1;
  }
  const changed: string[] = [];
  fs.rmSync(GOLDEN, { recursive: true, force: true });
  for (const [name, text] of observe("shell")) {
    const file = path.join(GOLDEN, ...`${name}.golden`.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, goldenBytes(Buffer.from(text)));
    changed.push(name);
  }
  process.stdout.write(`${changed.join("\n")}\n`);
  return 0;
}

process.exitCode = main();
