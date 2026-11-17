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
// The snapshot also carries, as virtual files, `references/shared-<topic>.md` for every shared
// topic the body of SKILL.md cites (spec 0290 R51): the bytes of
// `artifacts/core/shared/references/<topic>.md`, read from the same source (working tree or
// revision) as the skill, so the hash and the install cover the skill as it ships. A cited topic
// without a tracked source, an untracked or symlinked source, or a top-level
// `references/shared-*.md` in the skill source makes the snapshot `invalid`.
//
// Usage: const snap = readWorkingTree(repoRoot, "artifacts/core/skills/x");
//        if (snap.kind === "ok") contentHash(snap.files);
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { citedTopics } from "../build-components/shared-references.ts";
import { runGit } from "../governance/git-run.ts";
import { toLf } from "../line-endings.ts";
import { bodyOfText } from "../render-command.ts";

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
const SHARED_DIR = "artifacts/core/shared/references";
const OWN_SHARED = /^references\/shared-[^/]+\.md$/;

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

/** What the snapshot knows of one shared source file: its index mode and a way to read its bytes. */
interface SharedSource {
  readonly mode: string;
  readonly read: () => Buffer | undefined;
  /** True when the working-tree entry is a symbolic link although the index records a regular file. */
  readonly isLink?: () => boolean;
}

/**
 * R51: the virtual files for the topics cited by SKILL.md, plus the problems found. The text is
 * derived from the SKILL.md bytes as `readTextLf` does (BOM stripped, CRLF and lone CR to LF);
 * the hashed bytes stay raw. `sources` lists the shared directory once, on first use.
 */
function composeShared(
  dir: string,
  files: SnapFile[],
  problems: string[],
  sources: () => Map<string, SharedSource> | undefined,
  untracked: () => Set<string>,
): void {
  const skillMd = files.find((f) => f.rel === "SKILL.md");
  if (skillMd === undefined) return;
  for (const f of files)
    if (OWN_SHARED.test(f.rel))
      problems.push(`${dir}/${f.rel}: the shared- prefix is reserved for shared references`);
  const topics = citedTopics(
    bodyOfText(toLf(skillMd.bytes.toString("utf8").replace(/^\uFEFF/, ""))),
  );
  if (topics.length === 0) return;
  const listed = sources();
  for (const topic of topics) {
    const src = `${SHARED_DIR}/${topic}.md`;
    const found = listed?.get(`${topic}.md`);
    if (found === undefined) {
      problems.push(
        untracked().has(`${topic}.md`)
          ? `${src}: untracked file under a hashed path; run \`git add ${src}\` (or git-ignore it)`
          : `${dir}: cites references/shared-${topic}.md, but ${src} is not a tracked file`,
      );
      continue;
    }
    if (found.mode === "120000" || found.mode === "160000") {
      problems.push(`${src}: symbolic link or submodule under a hashed path is not supported`);
      continue;
    }
    const bytes = found.read();
    if (bytes === undefined) {
      problems.push(
        found.isLink?.() === true
          ? `${src}: symbolic link under a hashed path is not supported`
          : `${dir}: cites references/shared-${topic}.md, but ${src} is not a tracked file`,
      );
      continue;
    }
    files.push({
      rel: `references/shared-${topic}.md`,
      bytes,
      exec: found.mode === "100755",
    });
  }
}

/** Read the skill directory from the working tree as it stands now (a dirty tree is allowed). */
export function readWorkingTree(repoRoot: string, skillDirRel: string): Snapshot {
  const dir = skillDirRel.replaceAll("\\", "/").replace(/\/$/, "");
  const tracked = git(repoRoot, ["ls-files", "-s", "-z", "--", lit(dir)]);
  const untracked = git(repoRoot, ["ls-files", "-o", "--exclude-standard", "-z", "--", lit(dir)]);
  if (!tracked.ok || !untracked.ok)
    return {
      kind: "invalid",
      problems: [`${dir}: git could not list the skill files`],
    };
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
  if (problems.length === 0 && files.some((f) => f.rel === "SKILL.md")) {
    let listed: Map<string, SharedSource> | undefined;
    let listedUntracked: Set<string> | undefined;
    composeShared(
      dir,
      files,
      problems,
      () => {
        const t = git(repoRoot, ["ls-files", "-s", "-z", "--", lit(SHARED_DIR)]);
        listed = new Map();
        if (!t.ok) return listed;
        for (const rec of t.out.toString("utf8").split("\0")) {
          if (rec === "") continue;
          const tab = rec.indexOf("\t");
          const name = rec.slice(tab + 1).slice(SHARED_DIR.length + 1);
          if (name.includes("/")) continue;
          listed.set(name, {
            mode: rec.slice(0, rec.indexOf(" ")),
            read: () => readRegular(path.join(repoRoot, SHARED_DIR, name)),
            isLink: () => {
              try {
                return fs.lstatSync(path.join(repoRoot, SHARED_DIR, name)).isSymbolicLink();
              } catch {
                return false;
              }
            },
          });
        }
        return listed;
      },
      () => {
        if (listedUntracked !== undefined) return listedUntracked;
        const u = git(repoRoot, [
          "ls-files",
          "-o",
          "--exclude-standard",
          "-z",
          "--",
          lit(SHARED_DIR),
        ]);
        listedUntracked = new Set(
          u.ok
            ? u.out
                .toString("utf8")
                .split("\0")
                .filter((r) => r !== "")
                .map((r) => r.slice(SHARED_DIR.length + 1))
            : [],
        );
        return listedUntracked;
      },
    );
  }
  if (problems.length > 0) return { kind: "invalid", problems: problems.sort() };
  if (!files.some((f) => f.rel === "SKILL.md")) return { kind: "absent" };
  return { kind: "ok", files };
}

/** The bytes of a regular file, or undefined when it is gone or not a regular file. */
function readRegular(abs: string): Buffer | undefined {
  try {
    return fs.lstatSync(abs).isFile() ? fs.readFileSync(abs) : undefined;
  } catch {
    return undefined;
  }
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
      return {
        kind: "invalid",
        problems: [`${dir}/${rel}: cannot read blob ${sha} at ${rev}`],
      };
    files.push({ rel, bytes: blob.out, exec: mode === "100755" });
  }
  if (files.some((f) => f.rel === "SKILL.md")) {
    composeShared(
      dir,
      files,
      problems,
      () => {
        const t = git(repoRoot, ["ls-tree", "-z", rev, "--", `${SHARED_DIR}/`]);
        const listed = new Map<string, SharedSource>();
        if (!t.ok) return listed;
        for (const rec of t.out.toString("utf8").split("\0")) {
          if (rec === "") continue;
          const tab = rec.indexOf("\t");
          const [mode, type, sha] = rec.slice(0, tab).split(" ");
          if (type !== "blob") continue;
          listed.set(rec.slice(tab + 1).slice(SHARED_DIR.length + 1), {
            mode: mode ?? "",
            read: () => {
              const b = git(repoRoot, ["cat-file", "blob", sha ?? ""]);
              return b.ok ? b.out : undefined;
            },
          });
        }
        return listed;
      },
      () => new Set(),
    );
  }
  if (problems.length > 0) return { kind: "invalid", problems: problems.sort() };
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

/**
 * SKILL.md without its `metadata.provenance.version` line: a version bump is bookkeeping, not a
 * change of what the judge measures. Only the first indented `version:` line that follows a
 * `provenance:` key inside the frontmatter is dropped.
 */
export function withoutVersionLine(bytes: Buffer): Buffer {
  const lines = bytes.toString("utf8").split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return bytes;
  let inProvenance = false;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    if (line === "---") break;
    if (/^\s*provenance:\s*$/.test(line)) inProvenance = true;
    else if (inProvenance && /^\S/.test(line)) inProvenance = false;
    else if (inProvenance && /^\s+version:/.test(line)) {
      lines.splice(i, 1);
      return Buffer.from(lines.join("\n"), "utf8");
    }
  }
  return bytes;
}

/**
 * #1963 content hash: SKILL.md minus its version line, plus evals/evals.json. Scripts,
 * references and assets are covered by their unit tests, not by a paid run; they are still
 * installed into the executor's snapshot (`installFiles`).
 */
export function contentHash(files: readonly SnapFile[]): string {
  return digest(
    files
      .filter((f) => f.rel === "SKILL.md" || f.rel === EVALS_JSON)
      .map((f) => (f.rel === "SKILL.md" ? { ...f, bytes: withoutVersionLine(f.bytes) } : f)),
  );
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
