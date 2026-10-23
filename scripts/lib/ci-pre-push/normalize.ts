// normalize.ts — command normalisation of the pre-push parity guard (spec 0279 R3, R5).
//
// A `ci:<id>` task and the CI capability `<id>` must resolve to the same ordered command list.
// This module resolves both sides to that list. The loader of spec 0278 R10 returns command text
// unexpanded, so the expansion of task references happens here, binary-free (`task` is never run).
//
// Normalisation, applied identically to both sides:
//   (a) drop provisioning commands (PROVISIONING, R5);
//   (b) expand each Taskfile-side `- task: <ref>` call and each capability-side `task <name>`
//       command into the commands of the called task, recursively, through `resolveTaskRef`
//       (a capability-side name is global, so it resolves like the anchored `:<name>`);
//   (c) strip the exact prefix `{{.REPO_DIR}}/` wherever it appears and a trailing `{{.CLI_ARGS}}`;
//   (d) collapse runs of whitespace.
// Nothing else is normalised: flags, `--ignore` values and wrappers compare verbatim.
//
// Usage: resolveTaskCommands(tree, "ci:lint-markdown"), resolveCapabilityCommands(tree, cmds),
// resolveCommands(tree, items, fromFile). Pure functions over a loaded TaskfileTree.

import { loadTaskfileTree, resolveTaskRef } from "../taskfile-tree.ts";
import type { TaskEntry, TaskfileTree } from "../taskfile-tree.ts";
import { isRecord } from "../taskfile-tree-parse.ts";

export { loadTaskfileTree };

/** An engine-level setup command: provisioning, never a check (R5). Single source of truth. */
export const PROVISIONING = /^npm (ci|install)( |$)/;

/** The closed set of `ci:*` tasks that have no capability counterpart (R4). */
export const CONTROL_TASKS: readonly string[] = [
  "ci:pre-push",
  "ci:hooks-install",
  "ci:hooks-uninstall",
  "ci:hooks-status",
];

/** One item of a command list: raw command text, or a task call to expand. */
export type CommandItem = string | { task: string };

export interface Resolved {
  /** Normalised commands, provisioning dropped, task calls expanded, in order. */
  commands: string[];
  /** Normalised provisioning commands that were dropped, in order. */
  provisioning: string[];
}

/** Raised when a task call cannot be resolved or recurses; the message names the reference. */
export class CommandResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandResolveError";
  }
}

const REPO_DIR_PREFIX = "{{.REPO_DIR}}/";
const CLI_ARGS = "{{.CLI_ARGS}}";

/** Steps (c) and (d) on one command text. */
export function normalizeCommand(text: string): string {
  let out = text.split(REPO_DIR_PREFIX).join("");
  out = out.trimEnd();
  if (out.endsWith(CLI_ARGS)) {
    out = out.slice(0, out.length - CLI_ARGS.length);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** True for a provisioning command (tested on the normalised text). */
export function isProvisioning(text: string): boolean {
  return PROVISIONING.test(normalizeCommand(text));
}

/** Capability-side `task <name>` command: the global task name, else undefined. */
export function capabilityTaskName(command: string): string | undefined {
  const m = /^task\s+([^\s-][^\s]*)\s*$/.exec(command.trim());
  return m?.[1];
}

function itemOf(entry: unknown): CommandItem | undefined {
  if (typeof entry === "string") {
    return entry;
  }
  if (isRecord(entry)) {
    if (typeof entry["cmd"] === "string") {
      return entry["cmd"];
    }
    if (typeof entry["task"] === "string") {
      return { task: entry["task"] };
    }
  }
  return undefined;
}

/**
 * The ordered command items of one raw task definition: a single `cmd:` or the string, `{cmd}` and
 * `{task}` items of `cmds:`. Other items are skipped.
 */
export function taskItems(definition: unknown): CommandItem[] {
  if (!isRecord(definition)) {
    return [];
  }
  const single = itemOf(definition["cmd"]);
  if (single !== undefined) {
    return [single];
  }
  const cmds = definition["cmds"];
  if (!Array.isArray(cmds)) {
    return [];
  }
  return cmds.flatMap((entry) => {
    const item = itemOf(entry);
    return item === undefined ? [] : [item];
  });
}

/** Every `- task:` reference written in one task definition, verbatim and in order. */
export function taskCallRefs(definition: unknown): string[] {
  return taskItems(definition).flatMap((item) => (typeof item === "string" ? [] : [item.task]));
}

function expand(
  tree: TaskfileTree,
  items: readonly CommandItem[],
  fromFile: string,
  stack: readonly string[],
  out: Resolved,
): void {
  for (const item of items) {
    if (typeof item !== "string") {
      const target: TaskEntry | undefined = resolveTaskRef(tree, fromFile, item.task);
      if (target === undefined) {
        throw new CommandResolveError(`task call '${item.task}' in ${fromFile} does not resolve`);
      }
      if (stack.includes(target.name)) {
        throw new CommandResolveError(
          `task call cycle: ${[...stack, target.name].join(" -> ")} (from ${fromFile})`,
        );
      }
      expand(tree, taskItems(target.definition), target.file, [...stack, target.name], out);
      continue;
    }
    const text = normalizeCommand(item);
    if (PROVISIONING.test(text)) {
      out.provisioning.push(text);
      continue;
    }
    out.commands.push(text);
  }
}

/** Resolve a command list written in `fromFile` to its normalised, expanded form. */
export function resolveCommands(
  tree: TaskfileTree,
  items: readonly CommandItem[],
  fromFile: string,
): Resolved {
  const out: Resolved = { commands: [], provisioning: [] };
  expand(tree, items, fromFile, [], out);
  return out;
}

/** Taskfile side: the resolved list of the task with effective name `name`. */
export function resolveTaskCommands(tree: TaskfileTree, name: string): Resolved {
  const entry = tree.byName.get(name);
  if (entry === undefined) {
    throw new CommandResolveError(`task '${name}' does not exist`);
  }
  const out: Resolved = { commands: [], provisioning: [] };
  expand(tree, taskItems(entry.definition), entry.file, [entry.name], out);
  return out;
}

/** Capability side: `task <name>` commands expand as anchored calls from the root namespace. */
export function resolveCapabilityCommands(tree: TaskfileTree, cmds: readonly string[]): Resolved {
  const items: CommandItem[] = cmds.map((cmd) => {
    const name = capabilityTaskName(cmd);
    return name !== undefined && tree.byName.has(name) ? { task: `:${name}` } : cmd;
  });
  return resolveCommands(tree, items, tree.root);
}
