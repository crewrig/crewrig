// print-setup-declarations.ts — prints the declaration of one setup, one fact per line (spec 0256
// requirement 9, plan v2 step B3b.5).
//
// The helper a Bash suite runs to read a TypeScript declaration by evaluating it (the F2 pattern of
// print-manage-declarations.ts, spec 0255 delta-01 (b)):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/print-setup-declarations.ts \
//     <claude|gemini|copilot|antigravity> [--format lines|json]
//
// `lines` (default): `cli=<cli>`, `banner=<title>`, then `step <N>: <id>` in the order of the run,
// then one `<key>=<value>` per fact (keys are unique; see setup-declarations-facts.ts). A suite
// reads a step with `grep -x 'step 3: ensure-home'`, a fact with `grep '^home.rules=' | cut -d= -f2-`
// and the order of two steps by comparing their `step N` numbers. `json`: `{cli, banner, steps,
// facts}`. Exit status: 0 and the declaration on stdout; 1 with NOTHING on stdout when the
// descriptor is empty (the vacuity guard); 2 on a usage error (message on stderr).

import { fileURLToPath } from "node:url";

import { antigravityDescriptor } from "../../lib/setup/cli-antigravity.ts";
import { claudeDescriptor } from "../../lib/setup/cli-claude.ts";
import { copilotDescriptor } from "../../lib/setup/cli-copilot.ts";
import { geminiDescriptor } from "../../lib/setup/cli-gemini.ts";
import type { SetupDescriptor } from "../../lib/setup/descriptor.ts";
import { declarationFacts, VacuousDeclarationError } from "./setup-declarations-facts.ts";

export const SETUP_DESCRIPTORS: Readonly<Record<string, SetupDescriptor>> = {
  claude: claudeDescriptor,
  gemini: geminiDescriptor,
  copilot: copilotDescriptor,
  antigravity: antigravityDescriptor,
};

export type Format = "lines" | "json";

/** The declaration of `d` as text; throws `VacuousDeclarationError` when the descriptor is empty. */
export function renderDeclaration(d: SetupDescriptor, format: Format): string {
  const facts = declarationFacts(d);
  if (format === "json") {
    const out = {
      cli: d.cli,
      banner: d.banner,
      steps: [...d.steps],
      facts: Object.fromEntries(facts),
    };
    return `${JSON.stringify(out, null, 2)}\n`;
  }
  const lines: string[] = [];
  for (const [key, value] of facts) {
    lines.push(`${key}=${value}`);
    if (key === "banner") d.steps.forEach((id, i) => lines.push(`step ${i + 1}: ${id}`));
  }
  return `${lines.join("\n")}\n`;
}

export interface Sink {
  write(text: string): unknown;
}

/** The whole command: returns the exit status; writes to `out` only on success. */
export function main(
  argv: readonly string[],
  out: Sink,
  err: Sink,
  descriptors: Readonly<Record<string, SetupDescriptor>> = SETUP_DESCRIPTORS,
): number {
  const usage = (message: string): number => {
    err.write(`print-setup-declarations: ${message}\n`);
    return 2;
  };
  let format: Format = "lines";
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format") {
      const value = argv[i + 1];
      if (value !== "lines" && value !== "json") return usage("--format takes 'lines' or 'json'");
      format = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("-")) {
      return usage(`unknown option ${arg}`);
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  const [cli, ...extra] = positional;
  if (cli === undefined || extra.length > 0)
    return usage(`expected one CLI: ${Object.keys(descriptors).join("|")}`);
  const descriptor = descriptors[cli];
  if (descriptor === undefined) return usage(`unknown CLI '${cli}'`);
  try {
    out.write(renderDeclaration(descriptor, format));
  } catch (error) {
    if (!(error instanceof VacuousDeclarationError)) throw error;
    err.write(`print-setup-declarations: ${error.message}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2), process.stdout, process.stderr);
}
