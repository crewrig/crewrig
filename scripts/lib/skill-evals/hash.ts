// hash.ts — the content hash of a skill and the one read that feeds both the hash and the install
// (spec 0290 R32, R35).
//
// A skill snapshot is read ONCE (from the working tree, or from a git revision for the merge-base)
// into memory: SKILL.md, every file under scripts/, references/ and assets/, and evals/evals.json.
// The same bytes are hashed and installed, so the installed copy is byte-identical to what was
// hashed. The mode flag is the git INDEX mode (`git ls-files -s`; `git ls-tree` for a revision),
// never the filesystem mode, so the hash is identical on Windows, on Linux and with
// core.fileMode=false. Only tracked files are hashed; git-ignored untracked files are skipped;
// an untracked non-ignored file or any symbolic link (index mode 120000) makes the snapshot
// `invalid` and no hash is produced.
//
// Usage: const snap = readWorkingTree(repoRoot, "artifacts/core/skills/x");
//        if (snap.kind === "ok") contentHash(snap.files);
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { runGit } from "../governance/git-run.ts";

export interface SnapFile {
  /** Path relative to the skill directory, `/` separators. */
  readonly rel: string;
  readonly bytes: Buffer;
  /** True iff the git index mode is 100755. */
  readonly exec: boolean;
}

export type Snapshot =
  | { readonly kind: "ok"; readonly files: SnapFile[] }
  | { readonly kind: "invalid"; readonly problems: string[] }
  | { readonly kind: "absent" };

const EVALS_JSON = "evals/evals.json";

/** The paths R35 selects. */
export function isSelected(rel: string): boolean {
  return (
    rel === "SKILL.md" ||
    rel === EVALS_JSON ||
    rel.startsWith("scripts/") ||
    rel.startsWith("references/") ||
    rel.startsWith("assets/")
  );
}

function git(repoRoot: string, args: string[]): { ok: boolean; out: Buffer } {
  const r = runGit(args, { cwd: repoRoot });
  return { ok: r.status === 0, out: r.stdout };
}

const lit = (p: string) => `:(literal)${p}`;

/** Read the skill directory from the working tree as it stands now (a dirty tree is allowed). */
export function readWorkingTree(repoRoot: string, skillDirRel: string): Snapshot {
  const dir = skillDirRel.replaceAll("\\", "/").replace(/\/$/, "");
  const tracked = git(repoRoot, ["ls-files", "-s", "-z", "--", lit(dir)]);
  const untracked = git(repoRoot, ["ls-files", "-o", "--exclude-standard", "-z", "--", lit(dir)]);
  if (!tracked.ok || !untracked.ok)
    return { kind: "invalid", problems: [`${dir}: git could not list the skill files`] };
  const problems: string[] = [];
  const entries = new Map<string, string>();
  for (const rec of tracked.out.toString("utf8").split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    const mode = rec.slice(0, rec.indexOf(" "));
    const rel = rec.slice(tab + 1).slice(dir.length + 1);
    if (!isSelected(rel)) continue;
    entries.set(rel, mode);
  }
  for (const rec of untracked.out.toString("utf8").split("\0")) {
    if (rec === "") continue;
    const rel = rec.slice(dir.length + 1);
    if (isSelected(rel))
      problems.push(
        `${dir}/${rel}: untracked file under a hashed path; run \`git add ${dir}/${rel}\` (or git-ignore it)`,
      );
  }
  const files: SnapFile[] = [];
  for (const [rel, mode] of entries) {
    if (mode === "120000" || mode === "160000") {
      problems.push(
        `${dir}/${rel}: symbolic link or submodule under a hashed path is not supported`,
      );
      continue;
    }
    const abs = path.join(repoRoot, dir, rel);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue; // deleted in the working tree: absent from the content as it stands
    }
    if (st.isSymbolicLink()) {
      problems.push(`${dir}/${rel}: symbolic link under a hashed path is not supported`);
      continue;
    }
    if (!st.isFile()) continue;
    files.push({ rel, bytes: fs.readFileSync(abs), exec: mode === "100755" });
  }
  if (problems.length > 0) return { kind: "invalid", problems: problems.sort() };
  if (!files.some((f) => f.rel === "SKILL.md")) return { kind: "absent" };
  return { kind: "ok", files };
}

/** Read the skill directory at a git revision (the merge-base): modes from ls-tree, bytes from blobs. */
export function readRevision(repoRoot: string, rev: string, skillDirRel: string): Snapshot {
  const dir = skillDirRel.replaceAll("\\", "/").replace(/\/$/, "");
  const tree = git(repoRoot, ["ls-tree", "-r", "-z", rev, "--", dir]);
  if (!tree.ok) return { kind: "absent" };
  const problems: string[] = [];
  const files: SnapFile[] = [];
  for (const rec of tree.out.toString("utf8").split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    const [mode, , sha] = rec.slice(0, tab).split(" ");
    const rel = rec.slice(tab + 1).slice(dir.length + 1);
    if (!isSelected(rel)) continue;
    if (mode === "120000" || mode === "160000") {
      problems.push(`${dir}/${rel}: symbolic link or submodule at ${rev}`);
      continue;
    }
    const blob = git(repoRoot, ["cat-file", "blob", sha ?? ""]);
    if (!blob.ok)
      return { kind: "invalid", problems: [`${dir}/${rel}: cannot read blob ${sha} at ${rev}`] };
    files.push({ rel, bytes: blob.out, exec: mode === "100755" });
  }
  if (problems.length > 0) return { kind: "invalid", problems };
  if (!files.some((f) => f.rel === "SKILL.md")) return { kind: "absent" };
  return { kind: "ok", files };
}

function digest(files: readonly SnapFile[]): string {
  const sorted = [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.rel, "utf8"), Buffer.from(b.rel, "utf8")),
  );
  const h = createHash("sha256");
  const nul = Buffer.from([0]);
  for (const f of sorted) {
    h.update(Buffer.from(f.rel, "utf8"));
    h.update(nul);
    h.update(Buffer.from(f.exec ? "1" : "0", "ascii"));
    h.update(nul);
    h.update(Buffer.from(String(f.bytes.length), "ascii"));
    h.update(nul);
    h.update(f.bytes);
    h.update(nul);
  }
  return `sha256:${h.digest("hex")}`;
}

/** R35 content hash: SKILL.md, scripts/, references/, assets/ and evals/evals.json. */
export function contentHash(files: readonly SnapFile[]): string {
  return digest(files.filter((f) => isSelected(f.rel)));
}

/** R32: write the installed content (never evals/) into `dest`, restoring the recorded exec bit. */
export function installFiles(files: readonly SnapFile[], dest: string): void {
  for (const f of files) {
    if (!isSelected(f.rel) || f.rel === EVALS_JSON) continue;
    const target = path.join(dest, ...f.rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.bytes, { mode: f.exec ? 0o755 : 0o644 });
    fs.chmodSync(target, f.exec ? 0o755 : 0o644);
  }
}
