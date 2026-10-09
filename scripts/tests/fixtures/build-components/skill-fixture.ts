// skill-fixture.ts — a skill source tree that exercises every rule of spec 0250 R15, and a
// snapshot of a directory for byte, mode and link comparisons (build-components-resources.test.ts).
//
// Names and modes are chosen to separate the rules: `a-b.txt` < `a.txt` < `a/b.txt` only in
// whole-path code-unit order (a directory-by-directory walk lists them differently), `B.txt`
// sorts before `a.txt` only case-sensitively, a `.md` file with mode 0600 shows that a `.md`
// copy ignores its source mode, and `UPPER.MD` is not a `.md` file.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Links of the two depths a resource or a body may use, in one line, with CRLF. */
export const LINKS =
  "see ../../../../../docs/a.md, ../../../../../specs/b.md and ../../../../docs/c.md\r\n";
/** `LINKS` after the `.md` resource rewrite: five levels become four, four stay. */
export const LINKS_REWRITTEN =
  "see ../../../../docs/a.md, ../../../../specs/b.md and ../../../../docs/c.md\r\n";

export interface FixtureFile {
  readonly rel: string;
  readonly content: string | Buffer;
  readonly mode: number;
}

const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

/** Every regular file of the fixture skill, below the skill directory. */
export const SKILL_FILES: readonly FixtureFile[] = [
  { rel: "SKILL.md", content: "---\nname: x\n---\nbody\n", mode: 0o644 },
  { rel: "README.md", content: LINKS, mode: 0o644 },
  { rel: "notes/ignored.txt", content: "not a resource folder\n", mode: 0o644 },
  { rel: "scripts/.hidden", content: "h\n", mode: 0o644 },
  { rel: "scripts/B.txt", content: "B\n", mode: 0o644 },
  { rel: "scripts/a.txt", content: "a\n", mode: 0o644 },
  { rel: "scripts/a-b.txt", content: "ab\n", mode: 0o644 },
  { rel: "scripts/a/b.txt", content: "a/b\n", mode: 0o600 },
  { rel: "scripts/lib/alpha.txt", content: "alpha\n", mode: 0o644 },
  { rel: "scripts/lib/Zed.txt", content: "zed\n", mode: 0o644 },
  { rel: "scripts/run.sh", content: "#!/bin/sh\necho hi\n", mode: 0o755 },
  { rel: "scripts/links.txt", content: `x\r\n${LINKS}`, mode: 0o644 },
  { rel: "references/doc.md", content: `a\r\n${LINKS}b`, mode: 0o644 },
  { rel: "references/sub/two.md", content: `${LINKS}`.replaceAll("\r\n", "\n"), mode: 0o600 },
  { rel: "references/tool.md", content: "tool\n", mode: 0o755 },
  { rel: "references/UPPER.MD", content: LINKS, mode: 0o644 },
  { rel: "assets/blob.bin", content: allBytes, mode: 0o644 },
  {
    rel: "assets/bad.md",
    content: Buffer.concat([Buffer.from([0xff, 0xfe, 0]), Buffer.from(LINKS)]),
    mode: 0o644,
  },
  { rel: "assets/empty.txt", content: "", mode: 0o644 },
];

/** Write the fixture skill into `dir`; on POSIX also three links a resource walk must skip (`withLinks`). */
export function writeSkill(
  dir: string,
  files: readonly FixtureFile[] = SKILL_FILES,
  withLinks = true,
): void {
  for (const { rel, content, mode } of files) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    fs.chmodSync(file, mode);
  }
  if (process.platform === "win32" || !withLinks) return;
  fs.symlinkSync("../references/doc.md", path.join(dir, "scripts", "link-to-file"));
  fs.symlinkSync("../assets", path.join(dir, "scripts", "link-to-dir"));
  fs.symlinkSync("nowhere", path.join(dir, "references", "dangling"));
}

/** One line per entry below `root`, sorted: `D rel`, `L rel`, or `F rel <mode> <sha1-prefix>`. */
export function snapshot(root: string): string[] {
  const rows: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const sub = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const abs = path.join(root, sub);
      if (entry.isSymbolicLink()) rows.push(`L ${sub}`);
      else if (entry.isDirectory()) {
        rows.push(`D ${sub}`);
        walk(sub);
      } else {
        const sha = createHash("sha1").update(fs.readFileSync(abs)).digest("hex").slice(0, 12);
        rows.push(`F ${sub} ${(fs.statSync(abs).mode & 0o777).toString(8)} ${sha}`);
      }
    }
  };
  if (fs.existsSync(root)) walk("");
  return rows.sort();
}
