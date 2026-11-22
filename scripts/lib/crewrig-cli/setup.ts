// setup.ts — `node crewrig setup --cli <name>` (spec 0315 R6, R7, R12). It runs the spec 0256 setup of the CLI in
// two-root mode: framework content from the version root (this file's own version), organization files and the
// compiled organization components from the organization directory. The compile goes to a temporary directory
// outside the organization directory and is removed when the run ends, whatever its outcome. Nothing is written
// into the organization directory, and no `.gitignore` is created or changed.

import fs from "node:fs";
import path from "node:path";

import type { Io } from "../build-components/types.ts";
import type { SetupDescriptor, StdinLike } from "../setup/descriptor.ts";
import { homeOf } from "../manage/entry.ts";
import { compileOrganization, hooksNotice, temporaryDirectory } from "./compile.ts";
import { personalLinesMissing } from "./gitignore.ts";
import type { CliName } from "./command-args.ts";

export interface SetupRequest {
  readonly versionRoot: string;
  readonly orgDir: string;
  readonly cli: CliName;
  readonly answers: readonly string[];
  readonly io: Io;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
}

/** The organization files the framework requires (spec 0315 R6): their absence ends the run before anything is installed. */
const REQUIRED_ORGANIZATION_FILES = ["config/ORGANIZATION.md", "config/TOOLS.md"] as const;

async function descriptorOf(cli: CliName): Promise<SetupDescriptor> {
  switch (cli) {
    case "claude":
      return (await import("../setup/cli-claude.ts")).claudeDescriptor;
    case "gemini":
      return (await import("../setup/cli-gemini.ts")).geminiDescriptor;
    case "copilot":
      return (await import("../setup/cli-copilot.ts")).copilotDescriptor;
    case "antigravity":
      return (await import("../setup/cli-antigravity.ts")).antigravityDescriptor;
  }
}

/** The organization files that are absent; an empty list when every required one is present. */
export function missingRequiredFiles(orgDir: string): string[] {
  return REQUIRED_ORGANIZATION_FILES.filter((rel) => !fs.existsSync(path.join(orgDir, rel)));
}

/** Warn, once, about the personal `.gitignore` lines the organization lacks; the warning never changes the status. */
function warnIgnoreLines(request: SetupRequest): void {
  const missing = personalLinesMissing(request.orgDir);
  if (missing.length === 0) return;
  request.io.out(
    `crewrig setup: warning: .gitignore lacks ${missing.join(", ")}; run node crewrig build to add ${missing.length === 1 ? "it" : "them"}.`,
  );
}

export async function runSetupCommand(request: SetupRequest): Promise<number> {
  const { io, orgDir } = request;
  const missing = missingRequiredFiles(orgDir);
  if (missing.length > 0) {
    for (const rel of missing) io.err(`crewrig setup: ${rel} is missing in ${orgDir}; nothing was installed.`);
    return 1;
  }
  const notice = hooksNotice(orgDir);
  if (notice !== undefined) io.out(notice);
  warnIgnoreLines(request);

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
    const { runSetup } = await import("../setup/flow.ts");
    const descriptor = await descriptorOf(request.cli);
    return await runSetup(descriptor, {
      argv: request.answers.flatMap((answer) => ["--answer", answer]),
      stdin: process.stdin as StdinLike,
      stdout: process.stdout,
      stderr: process.stderr,
      env: request.env,
      platform: request.platform,
      home: homeOf(request.env, request.platform),
      repoDir: request.versionRoot,
      org: { dir: orgDir, staging },
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
