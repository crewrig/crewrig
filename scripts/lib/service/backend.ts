// backend.ts — the service-backend contract of the three operating systems
// (spec 0252 requirement 5; plan v2 D1) and the platform selection.
//
// One interface, three implementations: launchd (macOS), systemd (Linux),
// schtasks (Windows). Each implementation module exports
// `createBackend(): ServiceBackend` and spawns only through exec.ts. The
// implementation is loaded lazily, so a platform never loads the code of
// another. Every operation is per-user and none needs elevation.

import type { ServiceNames } from "./names.ts";

export type BackendKind = "launchd" | "systemd" | "schtasks";

/** The outcome of an operation that changes the registration or the process. */
export type ServiceOutcome =
  | { readonly ok: true; readonly detail?: string }
  | { readonly ok: false; readonly reason: string };

/** What the service manager reports about one registered service. */
export interface ServiceStatus {
  readonly registered: boolean;
  readonly running: boolean;
  /** A one-line, human-readable state (the manager's own wording where possible). */
  readonly detail?: string;
}

/** The supervised process, or why it cannot be told. */
export type SupervisorPid =
  | { readonly state: "pid"; readonly pid: number }
  | { readonly state: "none" }
  | { readonly state: "unverifiable"; readonly reason: string };

/** What `install` registers: the already-rendered definition on disk. */
export interface InstallSpec {
  /** The plist, unit file or task XML the caller materialised. */
  readonly definitionPath: string;
}

export interface ServiceBackend {
  readonly kind: BackendKind;
  /** Register the definition and enable it. */
  install(names: ServiceNames, spec: InstallSpec): ServiceOutcome;
  /** Start the registered service. */
  start(names: ServiceNames): ServiceOutcome;
  /**
   * End the running process. For the MCP daemon this is a restart request
   * under supervision and never disables autostart (spec 0113).
   */
  stop(names: ServiceNames): ServiceOutcome;
  status(names: ServiceNames): ServiceStatus;
  /** End the daemon and remove its registration: the only operation that does. */
  uninstall(names: ServiceNames): ServiceOutcome;
  supervisorPid(names: ServiceNames): SupervisorPid;
}

/** The shell's wording (scripts/stop-mcp-server.sh), exit status 1. */
export const UNSUPPORTED_OS_MESSAGE =
  "MCP daemon: unsupported OS — manage the supervisor unit manually.";

export class UnsupportedOsError extends Error {
  readonly platform: string;
  constructor(platform: string) {
    super(UNSUPPORTED_OS_MESSAGE);
    this.name = "UnsupportedOsError";
    this.platform = platform;
  }
}

/** The backend of a `process.platform` value, or `null` for an unsupported one. */
export function backendKindFor(platform: string): BackendKind | null {
  switch (platform) {
    case "darwin":
      return "launchd";
    case "linux":
      return "systemd";
    case "win32":
      return "schtasks";
    default:
      return null;
  }
}

/** Loads the implementation module of a backend; a seam for tests. */
export type BackendLoader = (kind: BackendKind) => Promise<unknown>;

const loadModule: BackendLoader = (kind) => {
  // The specifier is a variable so each platform loads only its own module.
  const specifier: string = `./${kind}.ts`;
  return import(specifier);
};

function isBackend(value: unknown): value is ServiceBackend {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["kind"] === "string" &&
    ["install", "start", "stop", "status", "uninstall", "supervisorPid"].every(
      (name) => typeof record[name] === "function",
    )
  );
}

/**
 * The backend for `platform` (a `process.platform` value). Throws
 * `UnsupportedOsError` on any other platform; throws `Error` when the
 * implementation module does not export a conforming `createBackend`.
 */
export async function selectBackend(
  platform: string,
  load: BackendLoader = loadModule,
): Promise<ServiceBackend> {
  const kind = backendKindFor(platform);
  if (kind === null) throw new UnsupportedOsError(platform);
  const mod = await load(kind);
  const factory =
    typeof mod === "object" && mod !== null
      ? (mod as Record<string, unknown>)["createBackend"]
      : null;
  if (typeof factory !== "function") throw new Error(`backend ${kind}: no createBackend export`);
  const backend: unknown = Reflect.apply(factory, undefined, []);
  if (!isBackend(backend) || backend.kind !== kind) {
    throw new Error(`backend ${kind}: createBackend did not return a ${kind} backend`);
  }
  return backend;
}
