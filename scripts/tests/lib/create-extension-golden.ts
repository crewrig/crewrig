// create-extension-golden.ts — the stored per-mask manifests of the scaffolder (spec 0258 R29): for
// each of the 64 component masks, the exit status, the SHA-256 of the normalised stdout and stderr,
// and every file written (sorted path -> fingerprint of `create-extension-observe.ts`). They are
// generated from the SHELL in the Linux container (see create-extension-golden-regen.ts) and the
// entry is compared with them everywhere.

import fs from "node:fs";
import path from "node:path";

import { sha256 } from "./create-extension-observe.ts";
import type { Observed } from "./create-extension-observe.ts";

export const GOLDEN_DIR = path.resolve(import.meta.dirname, "..", "fixtures", "create-extension");

export const MASKS: readonly number[] = Array.from({ length: 64 }, (_, mask) => mask);

export interface Manifest {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly files: Record<string, string>;
}

export const nameOf = (mask: number): string => `combo${mask}`;

export const goldenFile = (mask: number): string =>
  path.join(GOLDEN_DIR, `mask-${String(mask).padStart(2, "0")}.manifest.json.golden`);

export function manifestOf(observed: Observed): Manifest {
  return {
    status: observed.status,
    stdout: sha256(observed.stdout),
    stderr: sha256(observed.stderr),
    files: observed.files,
  };
}

export function readGolden(mask: number): Manifest {
  return JSON.parse(fs.readFileSync(goldenFile(mask), "utf8")) as Manifest;
}

export function writeGolden(mask: number, manifest: Manifest): void {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  fs.writeFileSync(goldenFile(mask), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The differences between two manifests, one line each; empty when they are the same. */
export function diffManifests(actual: Manifest, expected: Manifest): string[] {
  const lines: string[] = [];
  if (actual.status !== expected.status)
    lines.push(`status ${actual.status} != ${expected.status}`);
  if (actual.stdout !== expected.stdout) lines.push("stdout hash differs");
  if (actual.stderr !== expected.stderr) lines.push("stderr hash differs");
  for (const rel of new Set([...Object.keys(actual.files), ...Object.keys(expected.files)])) {
    if (actual.files[rel] !== expected.files[rel])
      lines.push(
        `${rel}: ${actual.files[rel] ?? "<absent>"} != ${expected.files[rel] ?? "<absent>"}`,
      );
  }
  return lines;
}
