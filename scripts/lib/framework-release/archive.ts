// archive.ts — the deterministic archive of a framework release (spec 0310 R3, R4), written with the
// ustar writer and the SHA-256 of the extension packaging so the bytes are a pure function of the files.

import fs from "node:fs";

import { sha256File } from "../packaging/digest.ts";
import { buildTar, gzipTar } from "../packaging/tar-writer.ts";
import type { ShippedFile } from "./manifest.ts";

/** Write the archive of `files` to `file`; returns its lowercase hexadecimal SHA-256. */
export function writeFrameworkArchive(files: readonly ShippedFile[], file: string): string {
  const entries = files.map((f) => ({ path: f.path, type: "file" as const, mode: f.mode, abs: f.abs }));
  fs.writeFileSync(file, gzipTar(buildTar(entries)));
  return sha256File(file);
}
