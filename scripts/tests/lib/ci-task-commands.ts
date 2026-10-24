// ci-task-commands.ts — resolve a migrated capability to its commands (spec 0283 R1).
//
// A migrated capability's `command` is the single line `task ci:<id>`; the commands it runs live
// as the `cmds:` of the task `ci:<id>` in taskfiles/ci.yml. Wiring tests that assert what a
// capability runs read it through here, so they keep protecting the command text after the move.

import fs from "node:fs";
import path from "node:path";

import { loadTaskfileTree, taskCmds } from "../../lib/taskfile-tree.ts";
import { REPO } from "./build-fixture-tree.ts";
import { yamlLib } from "./yaml-lib.ts";

/** The string `cmds:` of task `ci:<id>`, with the `{{.REPO_DIR}}/` prefix removed. */
export function ciTaskCommands(id: string, repo: string = REPO): string[] {
  const doc = yamlLib.load(fs.readFileSync(path.join(repo, "taskfiles", "ci.yml"), "utf8")) as {
    tasks?: Record<string, { cmds?: unknown[] }>;
  };
  const task = doc.tasks?.[id];
  if (!task) throw new Error(`taskfiles/ci.yml has no task '${id}'`);
  return (task.cmds ?? [])
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.replaceAll("{{.REPO_DIR}}/", ""));
}

/** The commands of the root tasks that task `ci:<id>` delegates to with `- task: :<name>`. */
export function ciTaskDelegatedCommands(id: string, repo: string = REPO): string[] {
  const doc = yamlLib.load(fs.readFileSync(path.join(repo, "taskfiles", "ci.yml"), "utf8")) as {
    tasks?: Record<string, { cmds?: unknown[] }>;
  };
  const tree = loadTaskfileTree(repo);
  return (doc.tasks?.[id]?.cmds ?? [])
    .flatMap((c) => {
      const ref = (c as { task?: unknown } | null)?.task;
      return typeof ref === "string" ? taskCmds(tree, ref.replace(/^:/, "")) : [];
    })
    .map((c) => c.replaceAll("{{.REPO_DIR}}/", ""));
}

/** A capability's commands: the task body when it is the single `task ci:<id>`, else as declared. */
export function resolveCapabilityCommands(
  command: readonly string[] | undefined,
  repo: string = REPO,
): string[] {
  const list = command ?? [];
  const m = list.length === 1 ? /^task ci:(\S+)$/.exec(list[0] ?? "") : null;
  return m ? ciTaskCommands(m[1] ?? "", repo) : [...list];
}

/** The text of one `ci-job` call's `with:` block for `id`, or undefined when the job does not call it. */
export function ciJobInputs(jobText: string, id: string): Record<string, string> | undefined {
  const m = new RegExp(
    `uses: \\./\\.github/actions/ci-job\\n\\s+with:\\n((?:\\s{10}.+\\n?)+)`,
  ).exec(jobText);
  if (!m) return undefined;
  const inputs: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^\s+([a-z-]+): (.+)$/.exec(line);
    if (kv) inputs[kv[1] ?? ""] = (kv[2] ?? "").trim();
  }
  return inputs.id === id ? inputs : undefined;
}

/** Spec 0283 R3: a trigger's own `paths:` when set, else the capability-level `paths:`. */
export function effectivePaths(
  cap: { paths?: readonly string[] },
  trigger: { paths?: readonly string[] },
): readonly string[] {
  return trigger.paths ?? cap.paths ?? [];
}

const INSTALL_LINE: Record<string, string> = {
  ci: "npm ci",
  install: "npm install",
  "omit-dev": "npm ci --omit=dev --workspaces=false",
};

/**
 * The commands a capability runs, in order, as the pre-migration reference listed them: for a
 * migrated capability the provisioning line its `requires.install` stands for, then the task body;
 * for any other capability its `command:` as declared.
 */
export function logicalCommands(
  cap: { command?: readonly string[]; requires?: { install?: string } },
  repo: string = REPO,
): string[] {
  const body = resolveCapabilityCommands(cap.command, repo);
  const migrated = (cap.command?.length ?? 0) === 1 && /^task ci:/.test(cap.command?.[0] ?? "");
  const line = INSTALL_LINE[cap.requires?.install ?? ""];
  return migrated && line ? [line, ...body] : body;
}
