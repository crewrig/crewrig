// summary.ts — the `summary` step: the closing report of the four setups (spec 0256 requirement 3,
// plan v2 step B3b.2; shell: setup-claude-interactive.sh 552-571, setup-gemini 507-528, setup-copilot
// 490-512, setup-antigravity 646-671). Every line is data from `descriptor.summary` /
// `descriptor.storeGuidance` / `descriptor.homes`, or a constant copied from the shell.
//
// Blank-line ownership (the shell prints ONE blank line before the `====` banner):
//   - Claude, Gemini, Copilot: this step prints it (Gemini's `legacy-context-cleanup` prints its
//     "Removed superseded context file" line with no trailing blank, the blank comes after it).
//   - Antigravity: the preceding `system-context-file` step prints the trailing blank lines (after
//     "Generated:"/"No context files found" and after "Removed ...", shell 626 and 641); this step
//     then prints NO leading blank. The rule is read from the step order: a blank is printed here
//     unless the step right before `summary` is `system-context-file`.
//
// Shell quirks kept on purpose (the differential test compares bytes): the rule list prints
// `  (none)` only for the CLIs whose list is a bare `ls` (Claude, Copilot); the indented lists
// (Gemini, Antigravity) are `ls | sed || echo`, where `sed` succeeds, so nothing is printed when
// there is no file. Likewise the JSON key lists and `claude mcp list | sed` never print their
// `(none)` / `(unable to list)` fallbacks. Gemini's jq key listing is done with JSON.parse here.
//
// `descriptor.summary` carrier shape (what the cli-*.ts descriptors fill):
//   listHeader   `Active rule files:` | `Active context files:` | `Active user-level instruction files:`
//   listGlob     shell glob of the rules directory (`*.md`, `[0-9][0-9]_*.md`, `*.instructions.md`);
//                the directory is `homes.rulesDir`. The list is indented by two spaces exactly when
//                `mcpSource` is `settings.json` or `mcp_config.json` (Gemini, Antigravity).
//   mcpHeader    `MCP servers (from 'claude mcp list'):` | `MCP servers (from settings.json):` ...
//   mcpSource    `claude-mcp-list` runs `claude mcp list` through the Spawner (each line indented);
//                `settings.json` reads `homes.settings`, `mcp-config.json` / `mcp_config.json` read
//                `homes.mcpConfig`: the `.mcpServers` keys, one `  - <key>` line each.
//   note         the FULL first line of the MemPalace-missing note, `Note: ` included (absent: Copilot);
//                the two pin lines are added here from the pin of scripts/lib/common.sh.
//   extraLines   lines printed verbatim after the MCP list and its blank (Copilot only; `""` is a blank).
//   restartLine  the closing line (absent: Copilot).
// `descriptor.storeGuidance` prints `print_store_access_guidance <cli>`; the Antigravity
// "System context file" block is printed when `descriptor.steps` holds `system-context-file`.

import fs from "node:fs";
import path from "node:path";

import { installSpec, readMempalacePin } from "../mempalace-pin.ts";
import type { SetupCtx, Spawner } from "./context.ts";
import type { SetupDescriptor, StepFn, StepRegistry, SummarySpec } from "./descriptor.ts";
import { printStoreAccessGuidance } from "./store-guidance.ts";
import { failClosed } from "./steps.ts";

/** The runtime `AGENTS.md` Antigravity reads (shell `GEMINI_MD_TARGET`), relative to home. */
const AGENTS_MD = [".gemini", "config", "AGENTS.md"] as const;

/** Compile the shell glob subset the four lists use (`*`, `?`, `[...]`) into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob.charAt(i);
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) source += "\\[";
      else {
        source += glob.slice(i, end + 1);
        i = end;
      }
    } else source += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** The files of `dir` that match `glob`, as `ls -1` lists them (sorted; dotfiles need a dot glob). */
export function listMatching(dir: string, glob: string): string[] {
  const re = globToRegExp(glob);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => re.test(name) && (!name.startsWith(".") || glob.startsWith(".")))
    .sort()
    .map((name) => path.join(dir, name));
}

/** The keys of `.mcpServers // {}`: nothing for a missing file, bad JSON or a non-object. */
export function mcpServerKeys(file: string | undefined): string[] {
  if (file === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const servers: unknown = (parsed as Record<string, unknown>)["mcpServers"];
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return [];
  return Object.keys(servers).sort();
}

/** `claude mcp list 2>/dev/null | sed 's/^/  /'`: the output lines, indented by two spaces. */
function claudeMcpLines(spawn: Spawner): string[] {
  const { stdout } = spawn(["claude", "mcp", "list"]);
  if (stdout === "") return [];
  const lines = stdout.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => `  ${line}`);
}

function mcpLines(spec: SummarySpec, d: SetupDescriptor, ctx: SetupCtx, spawn: Spawner): string[] {
  if (spec.mcpSource === "claude-mcp-list") return claudeMcpLines(spawn);
  const rel = spec.mcpSource === "settings.json" ? d.homes.settings : d.homes.mcpConfig;
  const file = rel === undefined ? undefined : path.join(ctx.home, rel);
  return mcpServerKeys(file).map((key) => `  - ${key}`);
}

/** Gemini and Antigravity indent their list (`ls | sed`); Claude and Copilot print bare `ls` paths. */
function indentsList(spec: SummarySpec): boolean {
  return spec.mcpSource === "settings.json" || spec.mcpSource === "mcp_config.json";
}

const summary: StepFn = async ({ ctx, descriptor, state, spawn }) => {
  const { io } = ctx;
  const spec = descriptor.summary;
  const at = descriptor.steps.indexOf("summary");
  const owned = at > 0 && descriptor.steps[at - 1] === "system-context-file";
  if (!owned) io.out("");
  io.out("====================================");
  io.out("  Setup complete");
  io.out("====================================");
  io.out("");
  io.out(`Install mode: ${ctx.link ? "link" : "copy"}`);
  io.out("");

  io.out(spec.listHeader);
  const files = listMatching(path.join(ctx.home, descriptor.homes.rulesDir), spec.listGlob);
  const indent = indentsList(spec);
  if (files.length === 0 && !indent) io.out("  (none)");
  for (const file of files) io.out(indent ? `  ${file}` : file);
  io.out("");

  if (descriptor.steps.includes("system-context-file")) {
    const target = path.join(ctx.home, ...AGENTS_MD);
    io.out("System context file (Antigravity runtime):");
    io.out(
      state.agentsMdLines > 0 ? `  ${target} (${state.agentsMdLines} lines)` : "  (not generated)",
    );
    io.out("");
  }

  io.out(spec.mcpHeader);
  for (const line of mcpLines(spec, descriptor, ctx, spawn)) io.out(line);
  io.out("");

  if (!state.mempalaceInstalled && spec.note !== undefined) {
    const pin = failClosed(io, "cannot read the MemPalace pin", () =>
      readMempalacePin(ctx.repoDir),
    );
    io.out(spec.note);
    io.out("      Install MemPalace at the supported version, then re-run this script:");
    io.out(`      pipx install '${installSpec(pin)}'`);
    io.out("");
  }
  for (const line of spec.extraLines) io.out(line);
  if (descriptor.storeGuidance) printStoreAccessGuidance(io, descriptor.cli);
  if (spec.restartLine !== undefined) {
    if (descriptor.storeGuidance) io.out("");
    io.out(spec.restartLine);
  }
};

export const summarySteps: StepRegistry = { summary };
