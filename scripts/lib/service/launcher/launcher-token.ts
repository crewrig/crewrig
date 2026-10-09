// launcher-token.ts — the fail-closed bearer token read of the installed MCP
// launcher (spec 0252 requirement 11(b) and (c); spec 0113 R8, 0133 R9, 0159).
//
// The file is MEMPALACE_MCP_TOKEN_FILE when set, otherwise the palace-keyed
// path scripts/lib/usage-store/mcp.js `tokenPath()` derives: the SHA-256 of
// the resolved palace path, first 24 hexadecimal characters, under
// `~/.mempalace/server/<key>/token`. The derivation is repeated here instead
// of imported so this file stays inside the bundle with no neighbour but
// `./launcher-child.ts`'s siblings; a test proves both derivations agree.
// Every diagnostic is the shell launcher's `die` text, byte for byte.
//
// BUNDLE (installed flat as service-lib/launcher-token.ts): standalone, no
// import from the repository. Used by launcher/mcp-daemon-launcher.ts.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type TokenResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly message: string };

export const MIN_TOKEN_LENGTH = 32;

export function palacePath(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const configured = env.MEMPALACE_PALACE_PATH;
  return configured !== undefined && configured !== ""
    ? configured
    : path.join(home, ".mempalace", "palace");
}

function realOrGiven(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** The palace-keyed token path, as `mcp_token_path` and `mcp.js` derive it. */
export function derivedTokenPath(palace: string, home: string): string {
  let resolved: string;
  let isDir = false;
  try {
    isDir = fs.statSync(palace).isDirectory();
  } catch {
    isDir = false;
  }
  if (isDir) {
    resolved = fs.realpathSync(palace);
  } else {
    const parent = path.dirname(palace);
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch {
      // best effort, as the shell's `mkdir -p … || true`
    }
    resolved = path.join(realOrGiven(parent), path.basename(palace));
  }
  const key = createHash("sha256").update(resolved).digest("hex").slice(0, 24);
  return path.join(home, ".mempalace", "server", key, "token");
}

export function tokenFilePath(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const explicit = env.MEMPALACE_MCP_TOKEN_FILE;
  if (explicit !== undefined && explicit !== "") return explicit;
  return derivedTokenPath(palacePath(env, home), home);
}

function isRegularFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function fail(message: string): TokenResult {
  return { ok: false, message };
}

/** Read and judge the token; the failure message is the shell's `die` text. */
export function readToken(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): TokenResult {
  const file = tokenFilePath(env, home);
  if (!isRegularFile(file)) {
    return fail(
      `bearer token file not found: ${file}
       Refusing to start: MemPalace requires a token only on a non-loopback
       bind, so serving without one would silently disable authentication for
       every client. Re-run the setup script to provision it.`,
    );
  }
  let raw = "";
  try {
    raw = fs.readFileSync(file, "latin1");
  } catch {
    raw = "";
  }
  // `tr -d '[:space:]'`: every ASCII whitespace byte, then judge the shape.
  const token = raw.replace(/[ \t\n\v\f\r]/g, "");
  if (token === "") {
    return fail(
      `bearer token file is empty or whitespace-only: ${file}
       Refusing to start: upstream strips the token, so whitespace-only content
       becomes an empty token and short-circuits the bearer check — every
       request would be served unauthenticated. Re-run the setup script.`,
    );
  }
  if (/[^A-Za-z0-9_-]/.test(token)) {
    return fail(
      `bearer token contains unexpected characters: ${file}
       Refusing to start rather than guess how the server will interpret it.`,
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    return fail(
      `bearer token is shorter than 32 characters: ${file}
       Refusing to start: a short token is not a credential. Re-provision it.`,
    );
  }
  return { ok: true, token };
}
