// steps-copilot.ts — the Copilot-only `copilot-workspace-files` step (spec 0256 requirement 3,
// plan v2 step B3b.1). Shell: scripts/setup-copilot-interactive.sh 87-107. It installs the
// workspace settings file from its template when missing, then reports the entry-point file the
// Copilot CLI needs to load AGENTS.md. Everything prints on stdout; a failed bare `cp` (which
// `set -e` aborted) goes through `failClosed`.

import fs from "node:fs";
import path from "node:path";

import type { StepFn, StepRegistry } from "./descriptor.ts";
import { failClosed } from "./steps.ts";

const workspaceFiles: StepFn = async ({ ctx }) => {
  const { out } = ctx.io;
  const settings = path.join(ctx.repoDir, ".github", "copilot", "settings.json");
  const template = path.join(ctx.repoDir, "config", "copilot", "settings.json.template");
  if (!fs.existsSync(settings) || !fs.statSync(settings).isFile()) {
    failClosed(ctx.io, `cannot install ${settings}`, () => {
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.copyFileSync(template, settings);
    });
    out(`  Installed: ${settings} (from template)`);
  } else {
    out(`  ${settings} already exists, leaving untouched.`);
  }
  out("");
  const entry = path.join(ctx.repoDir, ".github", "copilot-instructions.md");
  if (fs.existsSync(entry) && fs.statSync(entry).isFile()) {
    out(`  Entry point: ${entry}`);
  } else {
    out(`  WARN: ${entry} is missing — Copilot will not load AGENTS.md without it.`);
  }
  out("");
};

export const copilotSteps: StepRegistry = { "copilot-workspace-files": workspaceFiles };
