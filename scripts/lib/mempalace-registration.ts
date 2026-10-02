// mempalace-registration.ts — what the MemPalace session-start check expects,
// what a CLI's user-level registration is, and what to tell the operator
// (spec 0246 R1, R3, R4, R5, R7 as amended by delta-01; plan v4 step 2,
// issue #1410).
//
// Pure: no I/O, standard library only, and no import outside the installed
// tree. The entry point (scripts/mempalace-session-check.ts) reads the files
// and hands their bytes here. Installed verbatim into
// ~/.crewrig/hooks/session-check/lib/.
//
// The check never spawns `jq` (delta R4). It classifies a configuration file
// only when the file is *strict*; on a strict file it reproduces the reader of
// `task mempalace:status` (`mcp_assistant_arrangement`, scripts/lib/common.sh)
// exactly, which the agreement test proves over strict fixtures.

// The Antigravity constant is defined beside the throttle, which needs its
// `key` on the suppressed path before this module is loaded. It is
// re-exported here so both evidence-driven constants have one import site.
import { isIPv4 } from "node:net";

export {
  ANTIGRAVITY_SESSION_CHECK,
  type AntigravitySessionCheck,
} from "./session-check-throttle.ts";

export const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;
export type Cli = (typeof CLIS)[number];

export function isCli(value: string): value is Cli {
  return (CLIS as readonly string[]).includes(value);
}

/**
 * Where each CLI's hook output lands. `user` and `model` are field paths in
 * the JSON the hook prints on stdout; `null` means the CLI offers no such
 * channel on `event` (an evidenced gap, `docs/cli-matrix.md` row 8e). A
 * `hookSpecificOutput.*` path also receives `hookEventName: event`; a
 * `name[].leaf` path is an array holding one `{leaf: text}` object. Plan v4
 * step 1 replaces these doc-grounded starting values with live evidence.
 * Antigravity: the `PreInvocation` contract of the hooks documentation
 * embedded in `agy` 1.2.14 (no live probe: no account; owner ruling
 * 2026-10-02) documents `injectSteps[].ephemeralMessage`, a transient system
 * message to the model, and no user-visible field.
 */
export interface ChannelSpec {
  readonly event: string;
  readonly user: string | null;
  readonly model: string | null;
}

export const SESSION_CHECK_CHANNELS: Readonly<Record<Cli, ChannelSpec>> = {
  claude: {
    event: "SessionStart",
    user: "systemMessage",
    model: "hookSpecificOutput.additionalContext",
  },
  gemini: {
    event: "SessionStart",
    user: "systemMessage",
    model: "hookSpecificOutput.additionalContext",
  },
  copilot: { event: "sessionStart", user: null, model: "additionalContext" },
  antigravity: { event: "PreInvocation", user: null, model: "injectSteps[].ephemeralMessage" },
};

/** `MEMPALACE_MCP_LAUNCHER_PATH` wins, as `mcp_launcher_installed_path` does. */
export function launcherPath(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const fromEnv = env.MEMPALACE_MCP_LAUNCHER_PATH;
  return fromEnv !== undefined && fromEnv !== ""
    ? fromEnv
    : `${home}/.crewrig/mcp-daemon-launcher.sh`;
}

/** The user-level configuration file, as `mcp_assistant_config_path`. */
export function configPath(cli: Cli, home: string): string {
  switch (cli) {
    case "claude":
      return `${home}/.claude.json`;
    case "gemini":
      return `${home}/.gemini/settings.json`;
    case "copilot":
      return `${home}/.copilot/mcp-config.json`;
    case "antigravity":
      return `${home}/.gemini/config/mcp_config.json`;
  }
}

/** The installed daemon's endpoint (R1), read from the launcher only. */
export interface Endpoint {
  readonly host: string;
  readonly port: number;
  /** `http://<MCP_HOST>:<MCP_PORT>/mcp`, composed verbatim. */
  readonly url: string;
  /** Whether the probe may be sent: R10 allows a loopback request only. */
  readonly loopback: boolean;
}

const HOST_RE = /^[A-Za-z0-9.:[\]-]{1,64}$/; // no "_": RFC 1123, and it rejects the __MCP_HOST__ placeholder (R1)
const PORT_RE = /^[1-9][0-9]{0,4}$/;

function launcherValue(text: string, name: string): string | null {
  // The first line that starts with NAME=" and the text up to the next quote:
  // the shell equivalent is `grep -m1 '^NAME="' | cut -d'"' -f2`.
  // No `m` flag: it would also treat CR, U+2028 and U+2029 as line starts,
  // while grep and sed split on LF only.
  const match = new RegExp(`(?:^|\\n)${name}="([^"\\n]*)"`).exec(text);
  return match?.[1] ?? null;
}

/**
 * Parse `MCP_HOST` and `MCP_PORT` from the installed launcher. An unreplaced
 * placeholder, a missing or malformed value, or a port outside 1-65535 means
 * no installed daemon (R1): `null`.
 */
export function parseLauncher(text: string): Endpoint | null {
  const host = launcherValue(text, "MCP_HOST");
  const portText = launcherValue(text, "MCP_PORT");
  if (host === null || portText === null || !HOST_RE.test(host) || !PORT_RE.test(portText))
    return null;
  const port = Number(portText);
  if (port > 65535) return null;
  return { host, port, url: `http://${host}:${portText}/mcp`, loopback: isLoopbackHost(host) };
}

/**
 * A loopback IP literal: `::1`, or a dotted-quad IPv4 in 127.0.0.0/8 with no
 * octet written with a leading zero (`127.0.0.01`), which curl may read as
 * octal. Node 24's `isIPv4` already rejects those; the explicit test keeps
 * the rule independent of the Node release and identical to the shell side.
 */
export function isLoopbackAddress(address: string): boolean {
  if (address === "::1") return true;
  return isIPv4(address) && address.startsWith("127.") && !/(^|\.)0[0-9]/.test(address);
}

/**
 * Whether the probe may target `host` (R10). Only `localhost`, `::1`,
 * `[::1]`, or an IPv4 literal in 127.0.0.0/8: a pattern such as
 * `127.999.0.1` is not an IP, would be resolved through DNS, and could leave
 * the machine (security finding on PR #1474).
 */
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "[::1]" || isLoopbackAddress(host);
}

/**
 * The one redaction algorithm (plan v4 *Contracts*, seat finding v4-F5),
 * mirrored by the status side and pinned by
 * scripts/tests/fixtures/session-check/redaction-vectors.json:
 * strip userinfo (scheme optional), then the query and fragment (line breaks
 * included), then replace C0, DEL and C1 controls with `?`, then cap at 120
 * code points. The order matters: see the plan.
 */
export function redactUrl(url: string): string {
  const stripped = url
    .replace(/^(([A-Za-z][A-Za-z0-9+.-]*:\/\/)?)[^/?#]*@/, "$1")
    .replace(/[?#][\s\S]*$/, "");
  let out = "";
  let count = 0;
  for (const ch of stripped) {
    if (count === 120) break;
    const cp = ch.codePointAt(0) ?? 0;
    out += cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) ? "?" : ch;
    count++;
  }
  return out;
}

/** Shown instead of a compared `url`/`serverUrl` value that is not a string. */
export const NOT_A_STRING = "(not a string)";

/**
 * `comments` is true when the class was reached in a Gemini CLI file that
 * held comments (delta-02 R4, R5).
 */
export type Classification = (
  | { readonly class: "ok" }
  | { readonly class: "absent"; readonly reason: "no-file" | "no-entry" }
  | { readonly class: "stdio" }
  | { readonly class: "wrong-endpoint"; readonly registered: string }
  | { readonly class: "unrecognised"; readonly reason: "non-strict" | "content" }
) & { readonly comments?: boolean };

export type RegistrationClass = Classification["class"];

/** The two guards against a byte order mark; tests disable one at a time. */
export interface StrictGuards {
  readonly bomByteCheck: boolean;
  readonly ignoreBOM: boolean;
}

export type StrictResult =
  | {
      readonly strict: true;
      readonly value: Readonly<Record<string, unknown>>;
      /** Whether comment removal (Gemini CLI only) removed anything. */
      readonly comments: boolean;
    }
  | { readonly strict: false };

const NOT_STRICT: StrictResult = { strict: false };
export const MAX_DEPTH = 64;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(obj: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function hexAt(text: string, i: number): number {
  return Number.parseInt(text.slice(i, i + 4), 16);
}

/**
 * Gemini CLI's comment removal (delta-02 R4; spec 0214 R12, reference
 * behaviour `JSON.parse(stripJsonComments(...))`): `//` line comments and
 * `/* *\/` block comments outside string literals become whitespace (line
 * breaks kept), a never-closed block comment runs to the end, string
 * contents are untouched, and trailing commas stay.
 */
export function stripJsonComments(text: string): {
  readonly text: string;
  readonly comments: boolean;
} {
  let out = "";
  let comments = false;
  let i = 0;
  const blank = (s: string): string => s.replace(/[^\r\n]/g, " ");
  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      comments = true;
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      comments = true;
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, comments };
}

/**
 * Delta R4's depth and surrogate rules, checked on the decoded TEXT rather
 * than on the parsed value (seat finding v4-F6): `JSON.parse` keeps only the
 * last of duplicate keys, so a walk of the value misses a violation inside an
 * overwritten one. Run only on text `JSON.parse` accepted, so every escape is
 * well formed. A literal surrogate cannot survive the fatal UTF-8 decoder, so
 * `\u` escapes are the only way to write one.
 */
export function lexicallyBounded(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!inString) {
      if (c === 0x22) inString = true;
      else if (c === 0x7b || c === 0x5b) {
        if (++depth > MAX_DEPTH) return false;
      } else if (c === 0x7d || c === 0x5d) depth--;
      continue;
    }
    if (c === 0x22) inString = false;
    else if (c === 0x5c) {
      if (text.charCodeAt(i + 1) !== 0x75) {
        i++;
        continue;
      }
      const unit = hexAt(text, i + 2);
      if (unit >= 0xdc00 && unit <= 0xdfff) return false;
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = text.startsWith("\\u", i + 6) ? hexAt(text, i + 8) : -1;
        if (low < 0xdc00 || low > 0xdfff) return false;
        i += 6;
      }
      i += 5;
    }
  }
  return true;
}

/**
 * Delta R4's strictness gate (delta-02 wording). On the stored bytes: no
 * leading `EF BB BF`, valid UTF-8 under a fatal decoder that keeps a BOM.
 * Then, after comment removal when `jsonc` (Gemini CLI only): exactly one
 * RFC 8259 value that is an object whose `mcpServers`, when present, is an
 * object or `null`; containers nested at most 64 deep; no unpaired surrogate
 * escape.
 */
export function parseStrict(
  bytes: Uint8Array,
  guards: StrictGuards = { bomByteCheck: true, ignoreBOM: true },
  options: { readonly jsonc?: boolean } = {},
): StrictResult {
  if (guards.bomByteCheck && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return NOT_STRICT;
  let text: string;
  let comments = false;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: guards.ignoreBOM }).decode(bytes);
    if (options.jsonc === true) ({ text, comments } = stripJsonComments(text));
    value = JSON.parse(text);
  } catch {
    return NOT_STRICT;
  }
  if (!isObject(value) || !lexicallyBounded(text)) return NOT_STRICT;
  const servers = own(value, "mcpServers");
  if (servers !== undefined && servers !== null && !isObject(servers)) {
    return NOT_STRICT;
  }
  return { strict: true, value, comments };
}

/**
 * Delta R3's pinned mapping (delta-02 wording) on a strict top-level object,
 * locating the entry as `.mcpServers.mempalace // empty` does and comparing
 * one value, `.url // .serverUrl`, as scripts/doctor-mempalace.sh does. Only
 * a redacted URL leaves here.
 */
export function classifyStrict(
  obj: Readonly<Record<string, unknown>>,
  expected: string,
): Classification {
  const servers = own(obj, "mcpServers");
  if (servers === undefined || servers === null) return { class: "absent", reason: "no-entry" };
  if (!isObject(servers)) return { class: "unrecognised", reason: "non-strict" };
  const entry = own(servers, "mempalace");
  if (entry === undefined || entry === null || entry === false)
    return { class: "absent", reason: "no-entry" };
  if (!isObject(entry)) return { class: "unrecognised", reason: "content" };
  if (Object.hasOwn(entry, "url") || Object.hasOwn(entry, "serverUrl")) {
    const url = own(entry, "url");
    const compared =
      url === undefined || url === null || url === false ? own(entry, "serverUrl") : url;
    if (typeof compared === "string" && compared === expected) return { class: "ok" };
    return {
      class: "wrong-endpoint",
      registered: typeof compared === "string" ? redactUrl(compared) : NOT_A_STRING,
    };
  }
  if (Object.hasOwn(entry, "command")) return { class: "stdio" };
  return { class: "unrecognised", reason: "content" };
}

/** The read outcome the entry point passes in (see `readRegular`). */
export type FileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "ok"; readonly bytes: Uint8Array };

/**
 * A missing file is `absent`. An existing file that is not regular or cannot
 * be read is not strict, so `unrecognised` (seat finding v4-F7); it is never
 * read. Otherwise the strictness gate, with comment removal for Gemini CLI
 * only, then the pinned mapping.
 */
export function classifyFile(read: FileRead, expected: string, cli?: Cli): Classification {
  if (read.kind === "missing") return { class: "absent", reason: "no-file" };
  if (read.kind === "unreadable") return { class: "unrecognised", reason: "non-strict" };
  const parsed = parseStrict(read.bytes, undefined, { jsonc: cli === "gemini" });
  if (!parsed.strict) return { class: "unrecognised", reason: "non-strict" };
  const c = classifyStrict(parsed.value, expected);
  return parsed.comments && c.class !== "ok" ? { ...c, comments: true } : c;
}

/** The configuration path as the operator types it: relative to `~`. */
export function displayPath(file: string, home: string): string {
  const base = home.endsWith("/") ? home : `${home}/`;
  return home !== "" && file.startsWith(base) ? `~/${file.slice(base.length)}` : file;
}

export interface WarningContext {
  /** Whether the probe established that the daemon is serving (R2). */
  readonly serving: boolean;
  /** The expected endpoint (R1). */
  readonly expected: string;
  /** The configuration file, as `displayPath` shows it. */
  readonly config: string;
}

export const MAX_WARNING_BYTES = 600;

const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");

/** Shrink the variable part, then the whole text, until it fits 600 bytes. */
function fit(build: (variable: string) => string, variable: string): string {
  let chars = Array.from(variable);
  let text = build(variable);
  while (byteLength(text) > MAX_WARNING_BYTES && chars.length > 0) {
    chars = chars.slice(0, -1);
    text = build(`${chars.join("")}…`);
  }
  while (byteLength(text) > MAX_WARNING_BYTES) text = Array.from(text).slice(0, -1).join("");
  return text;
}

/**
 * Delta-02 R5: a Gemini CLI file that held comments and does not classify
 * `ok` names the Gemini setup, never a `task` command, since both read the
 * file with `jq`, which rejects comments.
 */
function geminiCommentsWarning(c: Classification, ctx: WarningContext): string {
  const state = (reg: string): string => {
    switch (c.class) {
      case "absent":
        return `is absent: the file has no "mempalace" entry, although the shared memory daemon at ${ctx.expected} is serving`;
      case "stdio":
        return `is stdio: a local process, whose memory writes the shared memory daemon at ${ctx.expected} refuses`;
      case "wrong-endpoint":
        return `is wrong-endpoint: it points at ${reg}, but the shared memory daemon serves ${ctx.expected}`;
      default:
        return "is unrecognised: its entry matches neither the HTTP nor the stdio registration shape";
    }
  };
  return fit(
    (reg) =>
      `MemPalace: the gemini "mempalace" registration in ${ctx.config} ${state(reg)}, so shared memory ` +
      `is unavailable to this session. The file holds comments, which the CrewRig task commands cannot ` +
      `read. Repair: run "bash scripts/setup-gemini-interactive.sh" in the CrewRig checkout; it rewrites ` +
      `the file without its comments and keeps them in a timestamped backup. Then restart this gemini session.`,
    c.class === "wrong-endpoint" ? c.registered : "",
  );
}

/**
 * The R5 warning (delta-01 and delta-02 wording), or `null` when R6 requires
 * silence. Every text names the CLI and fits in 600 bytes.
 */
export function warningFor(cli: Cli, c: Classification, ctx: WarningContext): string | null {
  const restart = `then restart this ${cli} session.`;
  const run = (command: string): string =>
    `Repair: run "${command}" in the CrewRig checkout, ${restart}`;
  if (!ctx.serving) {
    if (c.class === "stdio") return null;
    return fit(
      (exp) =>
        `MemPalace: the shared memory daemon installed on this machine (${exp}) is not answering, so shared ` +
        `memory is unavailable to this ${cli} session. Check it: run "task mempalace:status" in the CrewRig ` +
        `checkout, ${restart}`,
      ctx.expected,
    );
  }
  if (c.class !== "ok" && c.comments === true) return geminiCommentsWarning(c, ctx);
  const serving = `the shared memory daemon at ${ctx.expected} is serving`;
  switch (c.class) {
    case "ok":
      return null;
    case "absent":
      if (c.reason === "no-file") {
        return fit(
          (cfg) =>
            `MemPalace: ${cli} has no "mempalace" registration: its configuration file ${cfg} does not exist, ` +
            `although ${serving}. Shared memory is unavailable to this session. ` +
            run(`bash scripts/setup-${cli}-interactive.sh`),
          ctx.config,
        );
      }
      return fit(
        (cfg) =>
          `MemPalace: ${cli} has no "mempalace" registration in ${cfg}, although ${serving}. Shared memory is ` +
          `unavailable to this session. ${run("task mempalace:switch-http")}`,
        ctx.config,
      );
    case "stdio":
      return fit(
        (cfg) =>
          `MemPalace: ${cli} registers "mempalace" in ${cfg} as a local stdio process, while ${serving}. The ` +
          `daemon holds the palace lease, so this session's memory writes are refused. ` +
          run("task mempalace:switch-http"),
        ctx.config,
      );
    case "wrong-endpoint":
      return fit(
        (reg) =>
          `MemPalace: ${cli} registers "mempalace" at ${reg} (wrong-endpoint), but the shared memory daemon ` +
          `serves ${ctx.expected}. Shared memory is unavailable to this session. ` +
          run("task mempalace:switch-http"),
        c.registered,
      );
    case "unrecognised":
      if (c.reason === "content") {
        return fit(
          (cfg) =>
            `MemPalace: the "mempalace" entry of ${cli} in ${cfg} matches neither the HTTP nor the stdio ` +
            `registration shape, so shared memory is unavailable to this session. ${run("task mempalace:repair")}`,
          ctx.config,
        );
      }
      // Every not-strict file, a non-object `mcpServers` included: rewrite
      // first, switch-http only after the rewrite (delta-02 R5).
      return fit(
        (cfg) =>
          `MemPalace: the ${cli} configuration file ${cfg} is not a single strict JSON document, so its ` +
          `"mempalace" registration cannot be checked. Rewrite it as one, for example by saving it again ` +
          `without the byte order mark, by merging the concatenated documents, by making "mcpServers" an ` +
          `object, or by restoring one of its timestamped .bak backups. If the registration still needs ` +
          `repair afterwards, run "task mempalace:switch-http", ${restart}`,
        ctx.config,
      );
  }
}

function setPath(
  target: Record<string, unknown>,
  field: string,
  value: string,
  event: string,
): void {
  const [head, leaf] = field.split(".", 2);
  if (head === undefined) return;
  if (head.endsWith("[]") && leaf !== undefined) {
    target[head.slice(0, -2)] = [{ [leaf]: value }];
    return;
  }
  if (leaf === undefined) {
    target[head] = value;
    return;
  }
  const inner = isObject(target[head]) ? (target[head] as Record<string, unknown>) : {};
  if (head === "hookSpecificOutput") inner.hookEventName = event;
  inner[leaf] = value;
  target[head] = inner;
}

/**
 * The hook's stdout for `warning`, per `SESSION_CHECK_CHANNELS`: one JSON
 * object and a newline, or `""` when the CLI has no channel (R6, R7).
 */
export function render(cli: Cli, warning: string | null): string {
  const spec = SESSION_CHECK_CHANNELS[cli];
  if (warning === null || (spec.user === null && spec.model === null)) return "";
  const out: Record<string, unknown> = {};
  if (spec.user !== null) setPath(out, spec.user, warning, spec.event);
  if (spec.model !== null) setPath(out, spec.model, warning, spec.event);
  return `${JSON.stringify(out)}\n`;
}
