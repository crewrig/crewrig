// resources.ts — skill resource propagation (spec 0250 R15, R16).
//
// Twins scripts/build-components.sh `propagate_skill_resources` (:415-456): the
// regular files under a skill's `scripts/`, `references/` and `assets/` folders
// are copied to the same relative path of each built skill, in that folder order
// and, within a folder, in code-unit order of the relative path. The whole list is
// sorted once (`find | sort` sorted full paths, never directory by directory).
//
// Enumeration is `find "$dir" -type f` without `-L`: dotfiles are included, a
// symbolic link inside the folder is neither followed nor copied, and a folder
// that is itself a symbolic link lists nothing (find does not follow a link given
// as its starting point; checked on BSD find, the GNU result is not checked here).
//
// The copy is NOT the text writer of write.ts, because the shell did not write a
// resource as text:
//   - any file but `.md` was `cp`: bytes untouched, a new file created with the
//     source's mode masked by the umask (the OS applies the mask when the mode is
//     given at creation), an existing file rewritten in place keeping its mode;
//   - a `.md` file was `sed ... >`: only the two link patterns change (links.ts),
//     no line-ending or trailing-line-feed normalisation, a new file created with
//     the default `0666 & ~umask`. The bytes are read and written as latin1 so that
//     any byte sequence survives, valid UTF-8 or not;
//   - then, on macOS and Linux, a source executable by the process makes the copy
//     `chmod +x`: `0o111 & ~umask` is added to its mode, no bit is ever cleared.
//     Windows has no execute bit: a no-op there. `--check` never compares modes.

import fs from "node:fs";
import path from "node:path";

import { joinRoot } from "./args.ts";
import { rewriteResourceLinks } from "./links.ts";
import { assertInsideRoot, comparing, isRegularFile, reportDrift, sameBytes } from "./write.ts";
import { escapeControl } from "./diagnostics.ts";
import type { Ctx } from "./types.ts";

/** The folders a skill may carry resources in, in propagation order. */
const RESOURCE_FOLDERS = ["scripts", "references", "assets"] as const;

/** The process umask, read once at start by setting it and restoring it; `0` on win32. */
export function readUmask(platform: NodeJS.Platform): number {
  if (platform === "win32") return 0;
  const current = process.umask(0);
  process.umask(current);
  return current;
}

/** Relative paths (with `/`) of every regular file below `dir`, links neither followed nor listed. */
function walk(dir: string, prefix: string, found: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isFile()) found.push(rel);
    else if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, found);
  }
}

/** `find "$folder" -type f | sort`, relative to `folder`; empty unless `folder` is a real directory. */
function listResourceFiles(folder: string): string[] {
  try {
    if (!fs.lstatSync(folder).isDirectory()) return [];
  } catch {
    return [];
  }
  const found: string[] = [];
  walk(folder, "", found);
  return found.sort();
}

/** What the copy of `src` holds: the source bytes, link-rewritten for a `.md` file. */
function resourceBytes(src: string): Buffer {
  const raw = fs.readFileSync(src);
  if (!src.endsWith(".md")) return raw;
  return Buffer.from(rewriteResourceLinks(raw.toString("latin1")), "latin1");
}

function executableByProcess(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one resource to `dest`: `cp` (non-`.md`, source mode on creation) or `sed >`
 * (`.md`, default mode), then add the execute bits an executable source asks for.
 * The parent directory must exist. `root`, the output root `dest` belongs under, confines
 * it (`assertInsideRoot`).
 */
export function copyResource(ctx: Ctx, src: string, dest: string, root: string): void {
  assertInsideRoot(ctx, root, dest);
  if (src.endsWith(".md")) fs.writeFileSync(dest, resourceBytes(src));
  else fs.writeFileSync(dest, resourceBytes(src), { mode: fs.statSync(src).mode & 0o777 });
  if (ctx.platform === "win32" || !executableByProcess(src)) return;
  const current = fs.statSync(dest).mode & 0o7777;
  const wanted = current | (0o111 & ~ctx.umask);
  if (wanted !== current) fs.chmodSync(dest, wanted);
}

/**
 * `propagate_skill_resources <src_dir> <target_dir>`: copy (or, when comparing,
 * check) every resource of the skill at `srcDir` into `targetDir`. `root` is the output
 * root every target must stay under (`assertInsideRoot`).
 */
export function propagateSkillResources(
  ctx: Ctx,
  srcDir: string,
  targetDir: string,
  root: string,
): void {
  for (const folder of RESOURCE_FOLDERS) {
    const srcFolder = path.join(srcDir, folder);
    for (const rel of listResourceFiles(srcFolder)) {
      const src = path.join(srcFolder, rel);
      const target = joinRoot(ctx.platform, targetDir, `${folder}/${rel}`);
      assertInsideRoot(ctx, root, target);
      if (comparing(ctx)) {
        if (!isRegularFile(target)) reportDrift(ctx, target, true);
        else if (!sameBytes(target, resourceBytes(src))) reportDrift(ctx, target, false);
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      copyResource(ctx, src, target, root);
      ctx.io.out(`  Generated: ${escapeControl(target)}`);
    }
  }
}
