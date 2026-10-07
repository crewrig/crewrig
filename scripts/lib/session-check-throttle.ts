// session-check-throttle.ts — the Antigravity throttle of the MemPalace
// session-start check, and the check's regular-file reader (spec 0246 R8, R9;
// plan v4 steps 3-4, issue #1410).
//
// Antigravity CLI has no session-start event, so the check runs on
// `PreInvocation`, about four times per turn. This module decides, from the
// payload and one private state file only, whether an invocation runs the
// check or is suppressed. A suppressed invocation must stay under 150 ms
// including runtime start (R8), so the entry point loads this module eagerly
// and `mempalace-registration.ts` only after the throttle let it through.
//
// `readRegular` lives here, rather than in the registration module, because
// this is the one module loaded on every path: the launcher, the state file
// and the assistant configuration all go through it. It opens with
// `O_NONBLOCK` and refuses anything `fstat` does not call a regular file, so a
// FIFO or a device never blocks the check (R9).
//
// Installed verbatim into ~/.crewrig/hooks/session-check/lib/: standard
// library only, and no import from the repository.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/** The outcome of reading one path through `readRegular`. */
export type RegularRead =
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "ok"; readonly bytes: Uint8Array };

const MISSING: RegularRead = { kind: "missing" };
const UNREADABLE: RegularRead = { kind: "unreadable" };

/**
 * Read a whole regular file, without ever blocking on a special file.
 *
 * - `missing`: the path does not exist (`ENOENT`, `ENOTDIR`).
 * - `unreadable`: it exists but cannot be opened or read, is not a regular
 *   file (FIFO, directory, socket, device), or is larger than `maxBytes`.
 *   Its content is never read.
 * - `ok`: its bytes.
 */
export async function readRegular(file: string, maxBytes = Infinity): Promise<RegularRead> {
  let handle: FileHandle;
  try {
    handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? MISSING : UNREADABLE;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > maxBytes) return UNREADABLE;
    return { kind: "ok", bytes: await handle.readFile() };
  } catch {
    return UNREADABLE;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * What step 1(a) of plan v4 establishes about Antigravity CLI. The setup
 * writer registers the check only while `registered` is true (spec 0246 R11).
 * `key` names the `PreInvocation` payload field the throttle keys on; `null`
 * means the payload carries no conversation identifier and only the 30-minute
 * window applies. `registered` is true because the suppressed path measured
 * p95 84.6 ms (bound: 150 ms, R8) over 25 consecutive `sh -c` runs of the
 * registered command after one warm-up, warm state, `PreInvocation` payload
 * on stdin: Apple M1 Pro (MacBookPro18,1), macOS 26 (Darwin 25.6.0), Node
 * v24.13.1, 2026-10-02.
 */
export interface AntigravitySessionCheck {
  readonly registered: boolean;
  readonly key: string | null;
  readonly evidence: string;
}

export const ANTIGRAVITY_SESSION_CHECK: AntigravitySessionCheck = {
  registered: true,
  key: "conversationId",
  evidence:
    "agy 1.2.14 embedded hooks documentation (no live probe: no account), owner ruling 2026-10-02: " +
    "every hook payload carries conversationId among its common input fields",
};

export const THROTTLE_WINDOW_MS = 30 * 60 * 1000;
export const THROTTLE_ID_TTL_MS = 24 * 60 * 60 * 1000;
export const THROTTLE_MAX_IDS = 64;
const MAX_ID_LENGTH = 256;
const MAX_STATE_BYTES = 64 * 1024;

/** The private throttle state: the last window start and the recent ids. */
export interface ThrottleState {
  readonly windowStart: number | null;
  readonly ids: ReadonlyArray<readonly [string, number]>;
}

export const EMPTY_THROTTLE_STATE: ThrottleState = { windowStart: null, ids: [] };

export function throttleStatePath(home: string): string {
  return path.join(home, ".crewrig", "state", "session-check", "antigravity.json");
}

/** The conversation identifier the payload carries, or `null`. */
export function payloadKey(payload: unknown, field = ANTIGRAVITY_SESSION_CHECK.key): string | null {
  if (field === null || typeof payload !== "object" || payload === null) return null;
  if (!Object.hasOwn(payload, field)) return null;
  const value: unknown = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value !== "" && value.length <= MAX_ID_LENGTH ? value : null;
}

/** Parse the state file, tolerating anything: a bad file is an empty state. */
export function parseThrottleState(bytes: Uint8Array): ThrottleState {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return EMPTY_THROTTLE_STATE;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY_THROTTLE_STATE;
  const obj = raw as Record<string, unknown>;
  const windowStart = typeof obj.windowStart === "number" ? obj.windowStart : null;
  const ids: Array<readonly [string, number]> = [];
  if (Array.isArray(obj.ids)) {
    for (const item of obj.ids as unknown[]) {
      if (!Array.isArray(item)) continue;
      const [id, at] = item as unknown[];
      if (typeof id === "string" && typeof at === "number") ids.push([id, at]);
    }
  }
  return { windowStart, ids };
}

/**
 * The throttle decision, pure. With a conversation key: run once per key,
 * keeping at most `THROTTLE_MAX_IDS` keys younger than 24 h. Without one: run
 * once per 30-minute window. A timestamp in the future counts as expired, so
 * a clock set back cannot silence the check for long.
 */
export function decideThrottle(
  state: ThrottleState,
  key: string | null,
  now: number,
): { readonly proceed: boolean; readonly next: ThrottleState } {
  const fresh = (at: number, ttl: number): boolean => now - at >= 0 && now - at < ttl;
  const ids = state.ids.filter(([, at]) => fresh(at, THROTTLE_ID_TTL_MS));
  if (key !== null) {
    if (ids.some(([id]) => id === key)) return { proceed: false, next: state };
    const kept = [...ids, [key, now] as const].sort((a, b) => a[1] - b[1]).slice(-THROTTLE_MAX_IDS);
    return { proceed: true, next: { windowStart: state.windowStart, ids: kept } };
  }
  if (state.windowStart !== null && fresh(state.windowStart, THROTTLE_WINDOW_MS)) {
    return { proceed: false, next: state };
  }
  return { proceed: true, next: { windowStart: now, ids } };
}

/** Create the state directory 0700, owned by this user, or throw. */
function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) {
    throw new Error("session-check state directory is not private");
  }
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

/**
 * Publish the state by atomic rename, as scripts/lib/tmp-file.ts does: an
 * exclusive 0600 temporary file next to the target, removed on failure. No
 * fsync: losing the state to a crash costs one extra check, nothing more.
 */
function writeStateAtomic(file: string, data: string): void {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${randomBytes(6).toString("hex")}`,
  );
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Claim this invocation. Returns `true` when the check must run, having
 * recorded the claim BEFORE any probe; `false` when the throttle suppresses
 * it. A suppressed invocation writes nothing. When the claim cannot be
 * recorded the invocation is suppressed too, so a broken state never turns
 * into a warning at every model call.
 */
export async function claimThrottle(
  home: string,
  key: string | null,
  now: number,
): Promise<boolean> {
  const file = throttleStatePath(home);
  const read = await readRegular(file, MAX_STATE_BYTES);
  const state = read.kind === "ok" ? parseThrottleState(read.bytes) : EMPTY_THROTTLE_STATE;
  const { proceed, next } = decideThrottle(state, key, now);
  if (!proceed) return false;
  try {
    ensurePrivateDir(path.dirname(file));
    writeStateAtomic(file, `${JSON.stringify(next)}\n`);
  } catch {
    return false;
  }
  return true;
}

/**
 * Read the hook payload from `stream` (stdin). Resolves as soon as the bytes
 * read so far form one JSON value, at end of input, or after `idleMs` without
 * data; resolves `null` for a TTY, an error, or more than `maxBytes`.
 */
export function readPayload(
  stream: NodeJS.ReadStream,
  idleMs = 250,
  maxBytes = 1024 * 1024,
): Promise<unknown> {
  if (stream.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const parsed = (): unknown => {
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch {
        return undefined;
      }
    };
    const finish = (value: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.pause();
      resolve(value === undefined ? null : value);
    };
    const timer = setTimeout(() => finish(parsed()), idleMs);
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) return finish(null);
      chunks.push(chunk);
      const value = parsed();
      if (value !== undefined) finish(value);
      else timer.refresh();
    });
    stream.on("end", () => finish(parsed()));
    stream.on("error", () => finish(null));
  });
}
