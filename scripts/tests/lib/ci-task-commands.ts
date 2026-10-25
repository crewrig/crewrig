// ci-task-commands.ts — resolve a migrated capability to its commands (spec 0283 R1).
//
// A migrated capability's `command` is the single line `task ci:<id>`; the commands it runs live
// as the `cmds:` of the task `ci:<id>` in the `ci` Taskfile sub-tree. Wiring tests that assert what a
// capability runs read it through here, so they keep protecting the command text after the move.

import { loadTaskfileTree, taskCmds } from "../../lib/taskfile-tree.ts";
import { ciFileVars, expandFileVars } from "../../lib/ci-pre-push/normalize.ts";
import { REPO } from "./build-fixture-tree.ts";

/** Expand the literal `vars:` of taskfiles/ci.yml one level deep, then strip `{{.REPO_DIR}}/`. */
function expandCmd(vars: ReadonlyMap<string, string>, cmd: string): string {
  return expandFileVars(cmd, vars).replaceAll("{{.REPO_DIR}}/", "");
}

/**
 * The string `cmds:` of task `ci:<id>` (defined in `taskfiles/ci.yml` or any file of the flattened
 * `taskfiles/ci/` sub-tree, found through the loader), with the `{{.REPO_DIR}}/` prefix removed.
 */
export function ciTaskCommands(id: string, repo: string = REPO): string[] {
  const tree = loadTaskfileTree(repo);
  if (!tree.byName.has(id.startsWith("ci:") ? id : `ci:${id}`)) {
    throw new Error(`the Taskfile tree has no task 'ci:${id}'`);
  }
  const vars = ciFileVars(tree);
  return taskCmds(tree, `ci:${id}`).map((c) => expandCmd(vars, c));
}

/** The commands of the root tasks that task `ci:<id>` delegates to with `- task: :<name>`. */
export function ciTaskDelegatedCommands(id: string, repo: string = REPO): string[] {
  const tree = loadTaskfileTree(repo);
  const vars = ciFileVars(tree);
  const def = tree.byName.get(`ci:${id}`)?.definition as { cmds?: unknown[] } | undefined;
  return (def?.cmds ?? [])
    .flatMap((c) => {
      const ref = (c as { task?: unknown } | null)?.task;
      return typeof ref === "string" ? taskCmds(tree, ref.replace(/^:/, "")) : [];
    })
    .map((c) => expandCmd(vars, c));
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
