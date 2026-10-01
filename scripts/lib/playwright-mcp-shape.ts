// playwright-mcp-shape.ts — the pure model of the `playwright` MCP entry
// written by `task setup:playwright-mcp` (spec 0245).
//
// No I/O: the classifier takes the stored entry as data and an optional
// same-path predicate, so every class is decided by a total function the tests
// can drive directly. The shapes mirror each assistant's `sequentialthinking`
// registration, which spec 0084 already routes through the trust wrapper:
//   - Gemini CLI (scripts/lib/gemini-settings.sh `gemini_framework_mcp`) and
//     Antigravity CLI (scripts/setup-antigravity-interactive.sh): `command` +
//     `args`, no other field;
//   - GitHub Copilot CLI (config/copilot/mcp-config.json.template): the same
//     object plus `type: "stdio"`;
//   - Claude Code: written by its own CLI (`claude mcp add`), which stores
//     `type: "stdio"` and `env: {}` beside `command` and `args`.
//
// Standard library only (spec 0240 R16).

import path from "node:path";

/** The four supported assistants, in the order the task processes them. */
export type Cli = "claude" | "gemini" | "copilot" | "antigravity";

export const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

/** The MCP server name this task owns the shape of (never reserved: R7). */
export const SERVER_NAME = "playwright";

/** The package the legacy and wrapped forms launch. */
export const PLAYWRIGHT_PACKAGE = "@playwright/mcp@latest";

/** The trust wrapper's path relative to a checkout root. */
export const WRAPPER_RELATIVE = "scripts/lib/tls-exec.sh";

/**
 * Fields an assistant adds on its own when a server is registered with no
 * options (spec 0245 "Legacy shape"), each with the values it may take. Every
 * listed field is optional; when present, its value must deep-equal one of
 * the listed ones. A field listed for another assistant but not for this one
 * makes the entry `custom`.
 *
 * Evidence:
 *   - Claude Code: the stored user-scope `sequentialthinking` entry in
 *     ~/.claude.json carries `type: "stdio"` and `env: {}`.
 *   - GitHub Copilot CLI: config/copilot/mcp-config.json.template carries
 *     `type: "stdio"`; and `copilot mcp add playwright -- npx
 *     @playwright/mcp@latest` (Copilot CLI 1.0.87, observed 2026-10-01 in a
 *     temporary HOME) stores `{"tools": ["*"], "type": "local", "command":
 *     "npx", "args": ["@playwright/mcp@latest"]}`.
 *   - Gemini CLI, Antigravity CLI: their `sequentialthinking` entries carry no
 *     other field.
 */
export const TOLERATED_FIELDS: Readonly<Record<Cli, Readonly<Record<string, readonly unknown[]>>>> =
  {
    claude: { type: ["stdio"], env: [{}] },
    copilot: { type: ["stdio", "local"], tools: [["*"]] },
    gemini: {},
    antigravity: {},
  };

/** Every class an existing entry falls in (spec 0245 R2–R6). */
export type Classification =
  | { readonly kind: "absent" }
  | { readonly kind: "legacy" }
  | { readonly kind: "wrapped-current" }
  | { readonly kind: "relocated"; readonly oldPath: string }
  | { readonly kind: "custom" };

/** `true` when two existing paths name the same file; never throws. */
export type SamePath = (a: string, b: string) => boolean;

/** The trust wrapper of the checkout rooted at `repoRoot`. */
export function wrapperPath(repoRoot: string): string {
  return path.join(repoRoot, ...WRAPPER_RELATIVE.split("/"));
}

/** The native entry this task writes for `cli`, wrapping through `wrapper`. */
export function wrappedEntry(cli: Cli, wrapper: string): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: "bash",
    args: [wrapper, "npx", PLAYWRIGHT_PACKAGE],
  };
  if (cli === "copilot") return { type: "stdio", ...entry };
  return entry;
}

/** The `claude mcp add` argv tail that registers the wrapped form. */
export function wrappedLaunch(wrapper: string): readonly string[] {
  return ["bash", wrapper, "npx", PLAYWRIGHT_PACKAGE];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Every field beyond `command`/`args` is a tolerated one with its exact value. */
function onlyToleratedExtras(cli: Cli, entry: Record<string, unknown>): boolean {
  const tolerated = TOLERATED_FIELDS[cli];
  for (const key of Object.keys(entry)) {
    if (key === "command" || key === "args") continue;
    if (!Object.hasOwn(tolerated, key)) return false;
    if (!(tolerated[key] ?? []).some((allowed) => deepEqual(entry[key], allowed))) return false;
  }
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

/** A wrapper path of some checkout: absolute and ending in `scripts/lib/tls-exec.sh`. */
function isCheckoutWrapper(candidate: string): boolean {
  if (!path.isAbsolute(candidate) && !path.posix.isAbsolute(candidate)) return false;
  const segments = candidate.split(/[\\/]+/);
  const tail = WRAPPER_RELATIVE.split("/");
  if (segments.length <= tail.length) return false;
  return tail.every((seg, i) => segments[segments.length - tail.length + i] === seg);
}

/**
 * Classify the stored `playwright` entry of `cli` against the wrapper of the
 * current checkout. `undefined` is `absent`; anything that is not exactly the
 * legacy, wrapped-current or relocated form — a pinned version, `-y`, an extra
 * argument, a non-empty `env`, a remote transport, a stray field — is `custom`.
 */
export function classify(
  cli: Cli,
  entry: unknown,
  wrapper: string,
  samePath: SamePath = () => false,
): Classification {
  if (entry === undefined) return { kind: "absent" };
  if (!isPlainObject(entry) || !onlyToleratedExtras(cli, entry)) return { kind: "custom" };
  const { command, args } = entry;
  if (!isStringArray(args)) return { kind: "custom" };

  if (command === "npx" && args.length === 1 && args[0] === PLAYWRIGHT_PACKAGE) {
    return { kind: "legacy" };
  }
  if (
    command === "bash" &&
    args.length === 3 &&
    args[1] === "npx" &&
    args[2] === PLAYWRIGHT_PACKAGE
  ) {
    const stored = args[0] as string;
    if (stored === wrapper || samePath(stored, wrapper)) return { kind: "wrapped-current" };
    if (isCheckoutWrapper(stored)) return { kind: "relocated", oldPath: stored };
  }
  return { kind: "custom" };
}
