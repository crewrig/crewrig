// trust-wrapper-install.ts — install the TypeScript trust wrapper before the first stdio entry is
// written (spec 0256 requirements 25 and 28, delta-01 deviation (m)). On POSIX the entries name
// the shell wrapper that lives in the repository, so there is nothing to install; on win32 they
// name `<home>/.crewrig/tls-exec.ts`, which the service installer ships
// (`installTrustWrapperProgram`, scripts/lib/service/program-install.ts).

import { installTrustWrapperProgram, installedPaths } from "../service/program-install.ts";
import type { ProgramOptions } from "../service/program-install.ts";
import type { Env } from "./context.ts";

export interface TrustWrapperCtx {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly env: Env;
}

export interface TrustWrapperDeps {
  /** Install the wrapper program and its bundle files (writes to disk). */
  readonly install: (opts: ProgramOptions) => void;
}

export const defaultTrustWrapperDeps: TrustWrapperDeps = { install: installTrustWrapperProgram };

/** Install the win32 trust wrapper and return its path; `undefined` (nothing done) on POSIX. */
export function ensureTrustWrapperInstalled(
  ctx: TrustWrapperCtx,
  deps: TrustWrapperDeps = defaultTrustWrapperDeps,
): string | undefined {
  if (ctx.platform !== "win32") return undefined;
  const paths = installedPaths(ctx.home, ctx.env);
  deps.install({ paths });
  return paths.wrapper;
}

/** Install first, then build: the entries are only built once the wrapper they name exists. */
export function buildAfterWrapperInstall<T>(
  ctx: TrustWrapperCtx,
  deps: TrustWrapperDeps,
  build: () => T,
): T {
  ensureTrustWrapperInstalled(ctx, deps);
  return build();
}
