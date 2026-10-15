// substitute.ts — replace the `${SKELETON_NAME}` placeholder literally (spec 0258 R23, deviation (h)).
// A file holding no NUL byte is rewritten; the name is validated beforehand, so nothing in it
// needs escaping and `$` patterns in the replacement are not interpreted (a function replacer).

import fs from "node:fs";

import { listFiles, readTextCarrying } from "./files.ts";

const PLACEHOLDER = "${SKELETON_NAME}";

export function substituteName(target: string, name: string): void {
  for (const file of listFiles(target)) {
    const text = readTextCarrying(file);
    if (text === null || !text.includes(PLACEHOLDER)) continue;
    fs.writeFileSync(
      file,
      Buffer.from(
        text.replaceAll(PLACEHOLDER, () => name),
        "latin1",
      ),
    );
  }
}
