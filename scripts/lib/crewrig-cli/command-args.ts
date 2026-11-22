// command-args.ts — the options of `build`, `setup` and `update` (spec 0315 R2). The usage is decided before any
// I/O, and a message never echoes an argument, so a rejected value cannot reach the output. Every refusal is
// code 2 (R3), and the caller writes nothing.

export const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;
export type CliName = (typeof CLIS)[number];
export type CommandName = "build" | "setup" | "update";

export type CommandArguments =
  | { readonly ok: true; readonly orgDir: string | undefined; readonly cli: CliName | undefined; readonly answers: readonly string[] }
  | { readonly ok: false; readonly message: string };

const CLI_LIST = CLIS.join(", ");

function refuse(command: CommandName, reason: string): CommandArguments {
  return { ok: false, message: `crewrig ${command}: ${reason}` };
}

/** Parse the options of `command` (`argv` holds the arguments after the command name). */
export function parseCommandArguments(command: CommandName, argv: readonly string[]): CommandArguments {
  const takesCli = command !== "build";
  let orgDir: string | undefined;
  let cli: CliName | undefined;
  const answers: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--link") {
      return refuse(command, "--link is refused: a version directory is a cache, so setup copies its files.");
    }
    if (arg === "--org-dir") {
      const value = valueAfter(argv, index);
      if (value === undefined) return refuse(command, "--org-dir needs a directory.");
      if (orgDir !== undefined) return refuse(command, "--org-dir is given twice.");
      orgDir = value;
      index += 1;
    } else if (takesCli && arg === "--cli") {
      const value = valueAfter(argv, index);
      if (value === undefined) return refuse(command, `--cli needs one of ${CLI_LIST}.`);
      if (cli !== undefined) return refuse(command, "--cli is given twice.");
      if (!(CLIS as readonly string[]).includes(value)) {
        return refuse(command, `--cli must be one of ${CLI_LIST}.`);
      }
      cli = value as CliName;
      index += 1;
    } else if (takesCli && arg === "--answer") {
      const value = valueAfter(argv, index);
      if (value === undefined) return refuse(command, "--answer needs <id>=<value>.");
      const at = value.indexOf("=");
      if (at <= 0) return refuse(command, "--answer needs <id>=<value> with a non-empty id.");
      answers.push(value);
      index += 1;
    } else {
      return refuse(command, "unknown option or argument. Usage: " + usage(command));
    }
  }
  if (takesCli && cli === undefined) {
    return refuse(command, `--cli is required; one of ${CLI_LIST}.`);
  }
  return { ok: true, orgDir, cli, answers };
}

/** The value that follows the option at `index`, when it is an argument and not another option. */
function valueAfter(argv: readonly string[], index: number): string | undefined {
  const value = argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

export function usage(command: CommandName): string {
  if (command === "build") return "node crewrig build [--org-dir <path>]";
  return `node crewrig ${command} --cli <${CLIS.join("|")}> [--org-dir <path>] [--answer <id>=<value>]...`;
}
