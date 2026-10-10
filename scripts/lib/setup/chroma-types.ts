// chroma-types.ts — the shape shared by the POSIX and the Windows Chroma daemon installers (spec 0256
// requirement 25 as replaced by delta-01, deviation (n)): `chroma-install.ts` dispatches by platform
// and `chroma-install-win.ts` installs the scheduled task. A failed install returns `ok: false` after
// the install's own `ERROR:` lines; the caller exits 1 and no later step runs.

import type { SetupCtx, Spawner } from "./context.ts";

export type ChromaInstallCtx = Pick<SetupCtx, "io" | "env" | "platform" | "home" | "repoDir">;

export interface ChromaInstallArgs {
  readonly ctx: ChromaInstallCtx;
  readonly spawn: Spawner;
  /** The MemPalace interpreter (`MEMPALACE_PYTHON` or the detected one); undefined when none. */
  readonly python: string | undefined;
}

export interface ChromaInstallResult {
  readonly ok: boolean;
}
