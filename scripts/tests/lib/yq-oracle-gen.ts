// yq-oracle-gen.ts — runs INSIDE the crewrig-i2-yq-oracle container (real yq v4.44.3).
// Usage: node yq-oracle-gen.ts <corpus-dir> > oracle.json.golden
// For each corpus file: `keys` (JSON array) and `tag` of the root, then for each root key k the
// accessors `.["k"]`, `.["k"] // ""`, `.["k"] | tag`, `.["k"] | length`, all `yq -r`,
// the document on stdin (no host path ever appears in the output).
//
// Regenerate: see scripts/tests/fixtures/yq-accessors/oracle.Dockerfile.golden.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface Out {
  status: number;
  stdout: string;
  stderr: string;
}

function yq(expr: string, input: string, extra: string[] = []): Out {
  const r = spawnSync("yq", ["-r", ...extra, expr], { input, encoding: "utf8" });
  const stderr = (r.stderr ?? "").split("\n")[0] ?? "";
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: stderr.replace(/^(Error: ).*/, "$1<msg>"),
  };
}

const dir = process.argv[2] ?? "";
const result: Record<string, Record<string, Out>> = {};
for (const f of fs.readdirSync(dir).sort()) {
  const input = fs.readFileSync(path.join(dir, f), "utf8");
  const rec: Record<string, Out> = {};
  rec["keys"] = yq("keys", input, ["-o=json", "-I0"]);
  rec["root | tag"] = yq(". | tag", input);
  if (rec["keys"].status === 0) {
    for (const k of rec["keys"].stdout
      .split("\n")
      .filter((l) => l !== "")
      .flatMap((l) => JSON.parse(l) as unknown[])
      .map(String)) {
      const sel = `.["${k.replaceAll('"', '\\"')}"]`;
      rec[`${k} | get`] = yq(sel, input);
      rec[`${k} | default`] = yq(`${sel} // ""`, input);
      rec[`${k} | tag`] = yq(`${sel} | tag`, input);
      rec[`${k} | length`] = yq(`${sel} | length`, input);
    }
  }
  result[f.replace(/\.yml\.golden$/, "")] = rec;
}
process.stdout.write(JSON.stringify(result, null, 1) + "\n");
