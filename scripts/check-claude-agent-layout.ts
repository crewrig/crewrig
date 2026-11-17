// check-claude-agent-layout.ts — keep the compiled Claude Code agent tree flat (spec 0201
// requirements 6-7; TypeScript twin of check-claude-agent-layout.sh).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-claude-agent-layout.ts
// Override the repository root with CREWRIG_REPO_DIR (default: the parent of scripts/).
//
// Also guards `.agents/agents` (spec 0053 delta-01 R17).
//
// Exit: 0 `.claude/agents` is absent, empty or holds only flat `*.md` regular files (OK line on
// stdout), 1 offenders (named on stderr).
// Finding lines: `  - .claude/agents/<path>` under a `FAILED:` heading, on stderr.

import path from "node:path";
import { checkLayout } from "./lib/governance/agent-layout.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const envDir = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");
process.exitCode = checkLayout(repoDir, { out: ok, err: fatal });
