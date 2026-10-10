// overlay-loop.ts — the per-type dispatch of the four manage-*-component.sh scripts (spec 0255
// R5, R6, R7, plan step 9).
//
// Ports the `case "$TYPE" in` block that follows the normalisation in each script: compute the
// served roots (staging or artifact), create the landing directory, then hand one installer to
// `componentInstallNamed` (a name was given) or `componentInstallAll`. The installer places the
// component (`place` types) or merges / registers its `*.json` declaration (`mcp` types). The
// shell's `|| exit $?` is a returned `{ status, abort }`: nothing here calls `process.exit`,
// and every stream is the injected `io`.
//
// Listed deviations: a JSON merge that cannot complete reports `Error: <message>` on standard
// error and the entry's status is 1 (the shell let a failed `jq` truncate the config and still
// printed `Merged:`); no `jq` precondition exists any more (R22(a)).

import fs from "node:fs";
import path from "node:path";

import { migrateAntigravitySupersededComponents } from "../antigravity-migrate.ts";
import { componentInstallAll, componentInstallNamed } from "../component-install.ts";
import type { ComponentInstaller } from "../component-install.ts";
import type { SpawnFn as RebuildFn } from "../component-overlay.ts";
import { setArtifactRoots, setStagingRoots } from "../component-roots.ts";
import { ExtError } from "../extension/types.ts";
import type { Io } from "../extension/types.ts";
import { mergeJsonEntry } from "./mcp-json.ts";
import { registerClaudeMcp } from "./mcp-claude.ts";
import type { ClaudeMcpCtx } from "./mcp-claude.ts";
import { placeComponent } from "./place.ts";
import type { PlaceCtx, PlaceMode } from "./place.ts";
import type { CliDescriptor, TypeDescriptor } from "./types.ts";

/** `status` is the script's exit status when `abort`; otherwise the loop ran to its end. */
export interface LoopResult {
  readonly status: number;
  /** True when the script stops here: a non-zero driver status, or the shell's `exit 1`. */
  readonly abort: boolean;
}

export interface LoopRequest {
  readonly cli: CliDescriptor;
  /** The type after alias normalisation (a plural name, or one the CLI does not know). */
  readonly type: string;
  /** The component name; `""` installs every component. */
  readonly name: string;
  readonly mode: PlaceMode;
  /** The repository root (`REPO_DIR`). */
  readonly repoDir: string;
  /** The user's HOME; every descriptor path hangs off it. */
  readonly home: string;
}

export interface LoopDeps {
  readonly io: Io;
  /** Shared with the caller, which prints ONE `flushFallbackNotice` at the end of the process. */
  readonly place: PlaceCtx;
  /** Claude only: the `claude mcp` spawn context. */
  readonly claude?: ClaudeMcpCtx;
  /** Test seam: the staging rebuild child (default: a real `node` child). */
  readonly rebuild?: RebuildFn;
}

const AGENTS_REFUSAL = [
  "Error: this command installs no Copilot agent.",
  "       The repository-level Copilot agent layout is a documented",
  "       parity gap (docs/cli-matrix.md rows 4 and 10), and spec 0119",
  "       R3/R4/R6 leave this command no landing zone it may serve.",
  "       Agents ship compiled in .github/agents/ via the build.",
];

/** The shell's `exit 1` inside an installer: stops the driver loop, not just one component. */
class AbortLoop extends Error {
  readonly status: number;
  constructor(status: number) {
    super("abort");
    this.status = status;
  }
}

function done(status: number): LoopResult {
  return { status, abort: status !== 0 };
}

/** `register_json_entry` / `merge_json_entry`: the `.json` check, then the handler. */
function declarationInstaller(
  req: LoopRequest,
  type: TypeDescriptor,
  deps: LoopDeps,
): ComponentInstaller {
  const { io } = deps;
  // Only the workspace script words the refusal after the type; the other three say "MCP".
  const kind = req.cli.cli === "gemini" ? type.name : "MCP";
  const handler = req.cli.mcp;
  return (file) => {
    if (!file.endsWith(".json")) {
      io.err(`Error: '${file}' is not a JSON ${kind} declaration.`);
      return 1;
    }
    if (handler.kind === "spawn") {
      if (deps.claude === undefined) throw new Error("overlay-loop: claude context missing");
      const outcome = registerClaudeMcp(file, deps.claude, io);
      if (outcome.abort) throw new AbortLoop(outcome.status);
      return outcome.status;
    }
    try {
      mergeJsonEntry(
        {
          declFile: file,
          configFile: path.join(req.home, handler.file),
          key: type.mcpKey ?? "mcpServers",
          initial: handler.initial,
        },
        io,
      );
      return 0;
    } catch (error) {
      if (!(error instanceof ExtError)) throw error;
      io.err(`Error: ${error.message}`);
      return 1;
    }
  };
}

/** Dispatch one type: roots, landing directory, driver, and the antigravity migration. */
export function runOverlayLoop(req: LoopRequest, deps: LoopDeps): LoopResult {
  const { cli } = req;
  const { io } = deps;

  if (cli.refused.includes(req.type)) {
    for (const line of AGENTS_REFUSAL) io.err(line);
    return done(1);
  }
  const type = cli.types.find((t) => t.name === req.type);
  if (type === undefined) {
    io.out(`Error: unknown ${cli.unknownType.label} '${req.type}'`);
    if (cli.unknownType.listsTypes) io.out(`Types: ${cli.typesLine}`);
    return done(1);
  }

  const roots =
    type.root === "staging"
      ? setStagingRoots(req.repoDir, type.rootArg)
      : setArtifactRoots(req.repoDir, type.rootArg);
  let install: ComponentInstaller;
  if (type.action === "mcp") {
    install = declarationInstaller(req, type, deps);
  } else {
    const dest = path.join(req.home, type.dest ?? "");
    fs.mkdirSync(dest, { recursive: true });
    install = (src) => {
      placeComponent(src, dest, req.mode, deps.place);
      return 0;
    };
  }

  const overlay = {
    repoDir: req.repoDir,
    stderr: (text: string) => io.errRaw(text),
    ...(deps.rebuild === undefined ? {} : { spawn: deps.rebuild }),
  };
  let status: number;
  try {
    status =
      req.name !== ""
        ? componentInstallNamed(install, req.name, type.name, type.refreshCli, roots, overlay)
        : componentInstallAll(install, type.refreshCli, roots, overlay);
  } catch (error) {
    if (error instanceof AbortLoop) return { status: error.status, abort: true };
    throw error;
  }
  if (status !== 0) return done(status);

  // Narrow by design: only the names this invocation placed, and only when it placed any.
  if (type.migratesSuperseded === true && deps.place.placed.length > 0) {
    const migrated = migrateAntigravitySupersededComponents(
      path.join(req.home, cli.home),
      path.join(req.repoDir, "artifacts"),
      "skills",
      deps.place.placed,
      { out: (line) => io.out(line), err: (line) => io.err(line) },
    );
    return done(migrated.status);
  }
  return done(0);
}
