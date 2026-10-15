// schedule-backend.ts — the calendar-trigger backend contract and its platform
// selection (spec 0258 requirements 3 and 15; PLAN v2 steps 16 and 17).
//
// This file is also the checkout marker of requirement 3: the skill script
// `schedule-curator.ts` walks up from its own directory to the first ancestor
// that holds `scripts/lib/service/schedule-backend.ts`.
//
// One interface, three implementations (schedule-launchd.ts, schedule-systemd.ts,
// schedule-schtasks.ts), each exporting `createScheduleBackend()`. The backends are
// additive: they do not extend `ServiceBackend` (a calendar job has no start, stop,
// status or supervisor pid) and they never start the job at install. The module of
// a platform is loaded lazily, so a platform never loads another's code.

import { UnsupportedOsError, backendKindFor } from "./backend.ts";
import type { BackendKind, ServiceOutcome } from "./backend.ts";
import { servicePlatform } from "./exec.ts";
import type { ScheduleNames } from "./schedule-names.ts";
import type { ScheduleSpec } from "./schedule-spec.ts";

export type Outcome = ServiceOutcome;

export type ProbeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly capability: string; readonly detail: string };

/** What an uninstall did: `absent` when there was nothing, else the file or task removed. */
export type UninstallOutcome = Outcome & {
  readonly removedPath?: string;
  readonly absent?: boolean;
};

/** One rendered definition: where it goes (a path, or the task path) and its text. */
export interface RenderedFile {
  readonly label: string;
  readonly text: string;
}

export interface ScheduleBackend {
  readonly kind: BackendKind;
  /** Can this machine register a calendar job at all? */
  probe(): ProbeResult;
  /** The definitions an install would write, without writing or spawning anything. */
  render(names: ScheduleNames, spec: ScheduleSpec): readonly RenderedFile[];
  /** Register the job (replace-on-reinstall is `uninstall` then `install`, by the caller). Never starts it. */
  install(names: ScheduleNames, spec: ScheduleSpec): Outcome;
  uninstall(names: ScheduleNames): UninstallOutcome;
}

/** Loads the implementation module of a backend; a seam for tests. */
export type ScheduleBackendLoader = (kind: BackendKind) => Promise<unknown>;

const loadModule: ScheduleBackendLoader = (kind) => {
  // The specifier is a variable so each platform loads only its own module.
  const specifier: string = `./schedule-${kind}.ts`;
  return import(specifier);
};

function isScheduleBackend(value: unknown): value is ScheduleBackend {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["kind"] === "string" &&
    ["probe", "render", "install", "uninstall"].every((name) => typeof record[name] === "function")
  );
}

/**
 * The calendar backend of `platform` (default: `servicePlatform()`, which honours the
 * `CREWRIG_TEST_SERVICE_PLATFORM` seam on POSIX). Throws `UnsupportedOsError` on any
 * other platform and `Error` when the module does not export a conforming
 * `createScheduleBackend`.
 */
export async function selectScheduleBackend(
  platform: string = servicePlatform(),
  load: ScheduleBackendLoader = loadModule,
): Promise<ScheduleBackend> {
  const kind = backendKindFor(platform);
  if (kind === null) throw new UnsupportedOsError(platform);
  const mod = await load(kind);
  const factory =
    typeof mod === "object" && mod !== null
      ? (mod as Record<string, unknown>)["createScheduleBackend"]
      : null;
  if (typeof factory !== "function") {
    throw new Error(`schedule backend ${kind}: no createScheduleBackend export`);
  }
  const backend: unknown = Reflect.apply(factory, undefined, []);
  if (!isScheduleBackend(backend) || backend.kind !== kind) {
    throw new Error(
      `schedule backend ${kind}: createScheduleBackend did not return a ${kind} backend`,
    );
  }
  return backend;
}
