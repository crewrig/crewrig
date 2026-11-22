// build.ts — `node crewrig build` (spec 0315 R5, R7). The `.gitignore` lines are ensured before the compile, so a
// failed compile still leaves them in place. The compile goes to a temporary directory, and only a successful one
// replaces `dist/` of the organization directory, so a failure leaves the previous `dist/` unchanged.

import fs from "node:fs";
import path from "node:path";

import type { Io } from "../build-components/types.ts";
import {
  compileOrganization,
  definesComponent,
  hooksNotice,
  temporaryDirectory,
} from "./compile.ts";
import { ensureIgnoreLines } from "./gitignore.ts";

export interface BuildRequest {
  readonly versionRoot: string;
  readonly orgDir: string;
  readonly io: Io;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
}

/** Move `from` to `to`, copying when a rename cannot cross a device. */
function publish(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
  }
}

export async function runBuild(request: BuildRequest): Promise<number> {
  const { io, orgDir } = request;
  try {
    const added = ensureIgnoreLines(orgDir);
    if (added.length > 0)
      io.out(`crewrig build: added ${added.join(", ")} to ${path.join(orgDir, ".gitignore")}.`);
  } catch (error) {
    io.err(`crewrig build: cannot write ${path.join(orgDir, ".gitignore")}: ${reason(error)}`);
    return 1;
  }
  const notice = hooksNotice(orgDir);
  if (notice !== undefined) io.out(notice);

  const staging = temporaryDirectory();
  try {
    const status = await compileOrganization({
      versionRoot: request.versionRoot,
      orgDir,
      outDir: staging,
      io,
      env: request.env,
      platform: request.platform,
    });
    if (status !== 0) return 1;
    const dist = path.join(orgDir, "dist");
    fs.rmSync(dist, { recursive: true, force: true });
    const built = path.join(staging, "dist");
    if (fs.existsSync(built)) publish(built, dist);
    if (!definesComponent(orgDir)) {
      io.out(
        "crewrig build: the organization defines no component (artifacts/org/skills and artifacts/org/agents hold nothing but .gitkeep).",
      );
    } else {
      io.out(`crewrig build: compiled the organization components into ${dist}.`);
    }
    return 0;
  } catch (error) {
    io.err(`crewrig build: ${reason(error)}`);
    return 1;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
