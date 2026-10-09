// token.ts — the MCP daemon's bearer token: read-or-create (spec 0252
// requirement 18; plan v3 D1 row `token`). The TypeScript counterpart of
// `mcp_token_read_or_create` in scripts/lib/common.sh.
//
// The path is the one definition of scripts/lib/usage-store/mcp.js (`tokenPath`).
// The token is 48 characters of [A-Za-z0-9] drawn from the crypto generator by
// rejection sampling (no modulo bias). Creation is exclusive and never exposes a
// half-written file: the token is written to a 0600 sibling and published with
// `link(2)`, which fails with EEXIST when a concurrent caller already won, so a
// loser reads the winner's complete token. The token never leaves this module on
// an argument list, and an error message never carries it.

import { servicePlatform } from "./exec.ts";
import { randomBytes } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { createTempNextTo, discardTemp } from "../tmp-file.ts";
import { tokenPath } from "../usage-store/mcp.js";

export const TOKEN_LENGTH = 48;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Largest multiple of 62 that fits a byte: bytes at or above it are redrawn. */
const LIMIT = 248;

/** The token file path of the current palace. */
export function tokenFilePath(): string {
  return tokenPath();
}

/** Mint a fresh token: 48 characters of [A-Za-z0-9]. */
export function mintToken(): string {
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH * 2)) {
      if (byte >= LIMIT) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

function readExisting(file: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (raw === "") return null;
  const token = raw.replace(/\s/g, "");
  if (token === "") {
    throw new TokenError(
      `the token file exists but is whitespace-only: ${file}\n` +
        "         Refusing to use it — an empty token disables authentication.",
    );
  }
  return token;
}

/** Publish `token` at `file` only if nothing is there. Returns false when another caller won. */
function createExclusive(file: string, token: string): boolean {
  const tmp = createTempNextTo(file);
  try {
    writeSync(tmp.fd, token);
    try {
      linkSync(tmp.path, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    discardTemp(tmp);
  }
}

/**
 * The token, created when absent. Throws `TokenError` when it can neither read
 * nor create one: the caller must fail loudly, never proceed with an empty one.
 */
export function readOrCreateToken(file: string = tokenFilePath()): string {
  const existing = readExisting(file);
  if (existing !== null) return existing;
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (servicePlatform() !== "win32") {
    try {
      chmodSync(dir, 0o700);
    } catch {
      throw new TokenError(`cannot restrict ${dir} to 0700`);
    }
  }
  if (createExclusive(file, mintToken())) {
    if (servicePlatform() !== "win32") chmodSync(file, 0o600);
  }
  const winner = readExisting(file);
  if (winner === null) throw new TokenError(`could not create the token file ${file}`);
  return winner;
}

/** Remove the token file (rotation). Returns true when a file was removed. */
export function removeTokenFile(file: string = tokenFilePath()): boolean {
  try {
    readFileSync(file);
  } catch {
    return false;
  }
  rmSync(file, { force: true });
  return true;
}
