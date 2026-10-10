// component-install.ts — TypeScript twin of the install drivers of
// scripts/lib/component-resolve.sh (spec 0255, row F2 of spec 0215):
// `component_install_named` and `component_install_all`.
//
// Twin of those functions: change both, and keep them equal. The shell passes the name
// of a per-component installer function; here it is a callback taking the resolved path
// and returning its status. A report goes to `io.stderr` (default standard error).

import { ensureOverlayTiersFresh, stderrSink, type OverlayIo } from "./component-overlay.ts";
import { reportCollision } from "./component-resolve.ts";
import {
  COMPONENT_OVERLAY_TIERS,
  enumerateComponentsInRoots,
  reportUnresolved,
  resolveComponentInRoots,
} from "./component-roots.ts";

/** Installs one resolved component path and returns its exit status. */
export type ComponentInstaller = (componentPath: string) => number;

/**
 * `component_install_named`: resolve `name` over every served root and install it.
 * Returns 0 on success, non-zero on a miss, an ambiguity, or a refused rebuild; the
 * report is already written in each case.
 *
 * The rebuild fires ONLY on a miss, never up front: spec 0119 declines to require any
 * command to regenerate or prune a compiled tree it finds already carrying a collision,
 * and an unconditional prune here would erase exactly the state R15 exists to refuse.
 * `refreshCli` is `""` when the type has no compiled staging root.
 */
export function componentInstallNamed(
  install: ComponentInstaller,
  name: string,
  type: string,
  refreshCli: string,
  roots: readonly string[],
  io: OverlayIo,
): number {
  const stderr = io.stderr ?? stderrSink;
  let matches = resolveComponentInRoots(name, roots);

  if (matches.length === 0 && refreshCli !== "") {
    // A compiled tree is stale by default and nothing can detect that, so a miss is not
    // final: rebuild the served overlay tiers once, then search again.
    const status = ensureOverlayTiersFresh(refreshCli, COMPONENT_OVERLAY_TIERS, io);
    if (status !== 0) return status;
    matches = resolveComponentInRoots(name, roots);
  }

  if (matches.length === 0) {
    reportUnresolved(name, type, roots, stderr);
    return 1;
  }
  if (matches.length > 1) {
    reportCollision(name, matches, stderr);
    return 1;
  }
  return install(matches[0] ?? "");
}

/**
 * `component_install_all`: install every component of every served root, grouped by
 * installed name. A name with exactly one source installs; a name with more installs
 * NOTHING under that name, is reported, and sets a deferred non-zero return. Every
 * non-colliding sibling still installs. The rebuild fires FIRST, unconditionally: a
 * stale or residual tree mis-enumerates silently, which R9 forbids.
 */
export function componentInstallAll(
  install: ComponentInstaller,
  refreshCli: string,
  roots: readonly string[],
  io: OverlayIo,
): number {
  const stderr = io.stderr ?? stderrSink;
  let status = 0;

  if (refreshCli !== "") {
    const rebuilt = ensureOverlayTiersFresh(refreshCli, COMPONENT_OVERLAY_TIERS, io);
    if (rebuilt !== 0) return rebuilt;
  }

  const listing = enumerateComponentsInRoots(roots);
  // `sort -u` under the C locale: code-unit order.
  const names = [...new Set(listing.map((entry) => entry.base))].filter((n) => n !== "").sort();
  for (const name of names) {
    const sources = listing
      .filter((entry) => entry.base === name)
      .map((entry) => entry.path)
      .filter((p) => p !== "");
    if (sources.length > 1) {
      reportCollision(name, sources, stderr);
      status = 1;
      continue;
    }
    if (install(sources[0] ?? "") !== 0) status = 1;
  }
  return status;
}
