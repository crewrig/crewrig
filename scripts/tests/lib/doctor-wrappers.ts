// doctor-wrappers.ts — fabricates `#!/bin/sh` console-script wrappers (pip/distlib, uv and
// the relocatable form) for the doctor's issue #1417 tests (spec 0263, PR E). POSIX only.

import fs from "node:fs";
import path from "node:path";

export type WrapperForm = "dq" | "sq" | "reloc";

/** dq: pip/distlib; sq: uv (apostrophes escaped as `'\''`); reloc: path computed at run time. */
export function makeShWrapper(
  file: string,
  form: WrapperForm,
  interp = "",
  shebang = "/bin/sh",
): void {
  const q3 = "'''";
  let exec: string;
  if (form === "dq") exec = `${q3}exec' "${interp}" "$0" "$@"`;
  else if (form === "sq") exec = `${q3}exec' '${interp.replaceAll("'", "'\\''")}' "$0" "$@"`;
  else exec = `${q3}exec' "$(dirname -- "$(realpath -- "$0")")"/'python' "$0" "$@"`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `#!${shebang}\n${exec}\n' ${q3}\n# fake console script — never executed by the doctor\n`,
  );
  fs.chmodSync(file, 0o755);
}

/** A uv-style wrapper whose apostrophe is NOT escaped: the quote ends early, unparseable. */
export function makeBadWrapper(file: string, interp: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n'''exec' '${interp}' "$0" "$@"\n' '''\n`);
  fs.chmodSync(file, 0o755);
}
