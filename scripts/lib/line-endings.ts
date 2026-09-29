// line-endings.ts — LF normalisation for files the repository commits
// (spec 0240 R9, R11).
//
// A generated file is written with LF line endings whatever the host, so the
// same content produces byte-identical output on Linux, macOS and Windows.
// Reading accepts LF, CRLF and a leading UTF-8 byte-order mark. Standard
// library only (R16).

import fs from "node:fs";

import { writeFileAtomic } from "./tmp-file.ts";

const BOM = "﻿";

/** Convert every CRLF (and any lone CR) to LF. */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Read a UTF-8 text file, stripping a leading BOM and normalising to LF. */
export function readTextLf(file: string): string {
  let text = fs.readFileSync(file, "utf8");
  if (text.startsWith(BOM)) text = text.slice(BOM.length);
  return toLf(text);
}

/** Write `text` as UTF-8 with LF line endings, atomically, through tmp-file.ts. */
export function writeTextLf(file: string, text: string): void {
  writeFileAtomic(file, toLf(text));
}
