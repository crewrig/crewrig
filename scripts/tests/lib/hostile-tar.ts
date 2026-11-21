// hostile-tar.ts — raw ustar blocks for the launcher archive tests (plan of issue #2101, v2 step 4).
//
// The producer scripts/lib/packaging/tar-writer.ts only writes what the launcher accepts, so the
// refused forms of spec 0314 R9 (a link, a PAX header with another key, a GNU long name, a NUL byte,
// a path that does not fit) are written here, block by block, with no shared code. The producer and
// scripts/lib/packaging/tar-header.ts stay untouched.

import { createHash } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

const BLOCK = 512;

/** One regular file, directory, link or other typed entry, with its own ustar header. */
export interface EntrySpec {
  /** The ustar `name` field (at most 100 bytes). */
  name: string;
  /** The ustar `prefix` field (at most 155 bytes). */
  prefix?: string;
  /** The typeflag character: "0" file (default), "5" directory, "1" hard link, "2" symbolic link, ... */
  type?: string;
  data?: Buffer | string;
  /** The data is this many zero bytes, and the size field says so. */
  zeros?: number;
  linkname?: string;
  mode?: number;
}

/** An extended header (typeflag `x` or `g`) holding `key=value` records, placed before its entry. */
export interface PaxSpec {
  pax: ReadonlyArray<readonly [string, string]>;
  /** `x` (default) or `g`, the typeflag of the header. */
  type?: "x" | "g";
}

export type Piece = EntrySpec | PaxSpec;

function put(block: Buffer, offset: number, length: number, text: string): void {
  const bytes = Buffer.from(text, "latin1");
  if (bytes.length > length) throw new Error(`ustar field overflow: ${text.length} > ${length}`);
  bytes.copy(block, offset);
}

function octalField(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

/** Recompute the checksum of the header block at `offset` of `tar`, after a test altered it. */
export function fixChecksum(tar: Buffer, offset = 0): void {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (tar[offset + i] ?? 0);
  tar.write(`${sum.toString(8).padStart(6, "0")}\0 `, offset + 148, "latin1");
}

function header(
  name: string,
  size: number,
  type: string,
  extra: { prefix?: string; linkname?: string; mode?: number },
): Buffer {
  const block = Buffer.alloc(BLOCK);
  put(block, 0, 100, name);
  put(block, 100, 8, octalField(extra.mode ?? 0o644, 8));
  put(block, 108, 8, octalField(0, 8));
  put(block, 116, 8, octalField(0, 8));
  put(block, 124, 12, octalField(size, 12));
  put(block, 136, 12, octalField(0, 12));
  block.fill(0x20, 148, 156);
  put(block, 156, 1, type);
  put(block, 157, 100, extra.linkname ?? "");
  put(block, 257, 6, "ustar\0");
  put(block, 263, 2, "00");
  put(block, 345, 155, extra.prefix ?? "");
  fixChecksum(block);
  return block;
}

function padded(data: Buffer): Buffer {
  return Buffer.concat([data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)]);
}

/** A PAX record is `<length> <key>=<value>\n`, the length counting its own digits. */
export function paxRecord(key: string, value: string): Buffer {
  const body = Buffer.from(` ${key}=${value}\n`, "utf8");
  let length = body.length + 1;
  while (String(length).length + body.length !== length)
    length = String(length).length + body.length;
  return Buffer.concat([Buffer.from(String(length), "latin1"), body]);
}

function isPax(piece: Piece): piece is PaxSpec {
  return "pax" in piece;
}

/** The tar stream of `pieces`, ended by two zero blocks. */
export function buildTar(pieces: readonly Piece[]): Buffer {
  const parts: Buffer[] = [];
  for (const piece of pieces) {
    if (isPax(piece)) {
      const data = Buffer.concat(piece.pax.map(([key, value]) => paxRecord(key, value)));
      parts.push(header("PaxHeader", data.length, piece.type ?? "x", {}), padded(data));
      continue;
    }
    const given = piece.data ?? "";
    const data =
      piece.zeros !== undefined
        ? Buffer.alloc(piece.zeros)
        : typeof given === "string"
          ? Buffer.from(given, "utf8")
          : given;
    parts.push(header(piece.name, data.length, piece.type ?? "0", piece));
    if (data.length > 0) parts.push(padded(data));
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}

/** Write `tar` gzip-compressed to `file`; returns the lowercase hexadecimal SHA-256 of the file. */
export function writeTgz(file: string, tar: Buffer): string {
  const bytes = zlib.gzipSync(tar);
  fs.writeFileSync(file, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

/** A regular file entry. */
export function file(
  name: string,
  data: Buffer | string,
  extra: Partial<EntrySpec> = {},
): EntrySpec {
  return { ...extra, name, data };
}

/** A directory entry (typeflag 5). */
export function dir(name: string): EntrySpec {
  return { name, type: "5", mode: 0o755 };
}

/** An entry of a type the launcher refuses: "1" hard link, "2" symbolic link, "3", "4", "6" devices and FIFO. */
export function special(name: string, type: string, linkname = ""): EntrySpec {
  return { name, type, linkname };
}

/** A PAX `path` record that carries the path of the next entry. */
export function paxPath(value: string): PaxSpec {
  return { pax: [["path", value]] };
}
