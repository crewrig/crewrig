// crewrig-cli.ts — the framework entry point that the organization launcher runs from a verified version
// (spec 0314 R5, R6, R10, R14; spec 0315 R1 to R12). The launcher passes `<command> [arguments...]` verbatim;
// this file dispatches `init`, `build`, `setup` and `update`, and refuses any other command with exit 2, never
// with a launcher code (10 to 14). The command modules live under scripts/lib/crewrig-cli/ and the setup and
// build modules they reuse under scripts/lib/setup/ and scripts/lib/build-components/.
//
// The first import strips the CrewRig environment that the commands must not read (spec 0315 R12): it runs before
// any other module of this file is evaluated.

import path from "node:path";
import "./lib/crewrig-cli/env.ts";
import { parseCommandArguments, type CommandName } from "./lib/crewrig-cli/command-args.ts";
import { parseInitArguments } from "./lib/crewrig-cli/args.ts";
import { commandCode, runEntry } from "./lib/crewrig-cli/exit.ts";
import { checkOrgDir } from "./lib/crewrig-cli/org-dir.ts";
import { originRepository } from "./lib/crewrig-cli/origin.ts";
import { runInit } from "./lib/crewrig-cli/scaffold.ts";

/** The root of the pinned version: this file sits in its scripts/ directory. */
const VERSION_ROOT = path.resolve(import.meta.dirname, "..");

const COMMANDS = "init, build, setup, update";

const io = {
  out: (line: string) => void process.stdout.write(`${line}\n`),
  err: (line: string) => void process.stderr.write(`${line}\n`),
  errRaw: (text: string) => void process.stderr.write(text),
};

function isOrgCommand(command: string): command is CommandName {
  return command === "build" || command === "setup" || command === "update";
}

/** `build`, `setup` and `update` (spec 0315 R1 to R12): options first, then the organization directory, then the work. */
async function runOrganizationCommand(
  command: CommandName,
  rest: readonly string[],
): Promise<number> {
  const parsed = parseCommandArguments(command, rest);
  if (!parsed.ok) {
    io.err(parsed.message);
    return 2;
  }
  const org = checkOrgDir(process.cwd(), command, parsed.orgDir);
  if (!org.ok) {
    io.err(org.message);
    return 1;
  }
  const common = { orgDir: org.dir, io, env: process.env, platform: process.platform };
  if (command === "build") {
    const { runBuild } = await import("./lib/crewrig-cli/build.ts");
    return commandCode(await runBuild({ ...common, versionRoot: VERSION_ROOT }));
  }
  if (parsed.cli === undefined) {
    io.err(`crewrig ${command}: --cli is required.`);
    return 2;
  }
  if (command === "setup") {
    const { runSetupCommand } = await import("./lib/crewrig-cli/setup.ts");
    return commandCode(
      await runSetupCommand({
        ...common,
        versionRoot: VERSION_ROOT,
        cli: parsed.cli,
        answers: parsed.answers,
      }),
    );
  }
  const { runUpdate } = await import("./lib/crewrig-cli/update.ts");
  return commandCode(runUpdate({ ...common, cli: parsed.cli, answers: parsed.answers }));
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    console.error(`usage: node crewrig <command> [arguments...] (commands: ${COMMANDS})`);
    return 2;
  }
  if (isOrgCommand(command)) return runOrganizationCommand(command, rest);
  if (command !== "init") {
    console.error(`crewrig: unknown command ${JSON.stringify(command)} (commands: ${COMMANDS})`);
    return 2;
  }
  const parsed = parseInitArguments(rest);
  if (!parsed.ok) {
    console.error(parsed.message);
    return 2;
  }
  const cwd = process.cwd();
  return runInit({
    cwd,
    templateRoot: VERSION_ROOT,
    feedbackRepo: parsed.feedbackRepo,
    originRepo: () => originRepository(cwd),
  });
}

runEntry(() => dispatch(process.argv.slice(2)));
