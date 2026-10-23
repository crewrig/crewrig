// ci-pre-push.ts — pre-push guard entry (spec 0279 R8, R11, R13, R15).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-pre-push.ts [-- <remote> <url>]
//        node ... scripts/ci-pre-push.ts hooks install|uninstall|status
// Environment: CREWRIG_PRE_PUSH_REFS holds the git pre-push stdin lines (unset: a push of HEAD);
//   CREWRIG_PRE_PUSH_BASE overrides the target ref (default origin/main); FORCE=true lets
//   `hooks install` replace a foreign core.hooksPath.
// Checks: selects the fast-tier `ci:<id>` tasks the pushed changeset can affect and runs them.
// Exit: 0 all selected tasks passed or an explicit no-op notice, 1 a task failed, a fail-closed
//   case (missing node_modules, unreadable input, unsupported glob) or an internal error.
// Finding format: every line starts with `ci-pre-push: `.
//
// Static imports are `node:` modules only: everything that reaches js-yaml loads by dynamic
// import() after the node_modules check, so a fresh worktree gets a fix-naming message, never
// ERR_MODULE_NOT_FOUND.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const say = (line: string): void => void process.stdout.write(`ci-pre-push: ${line}\n`);
const fail = (line: string): number => {
  process.stderr.write(`ci-pre-push: ${line}\n`);
  return 1;
};

function gitOut(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  // A git remote may be named `hooks` and the hook passes the remote first: only a known
  // subcommand in second position selects the `hooks` mode, anything else is a push.
  if (args[0] === "hooks" && ["install", "uninstall", "status"].includes(args[1] ?? "")) {
    const { runHooksCommand } = await import("./lib/ci-pre-push/hooks.ts");
    const r = runHooksCommand(args[1], process.cwd());
    if (r.out !== "") say(r.out);
    return r.err !== "" ? fail(r.err) : r.code;
  }
  let top: string;
  try {
    top = gitOut(["rev-parse", "--show-toplevel"]);
  } catch {
    return fail("not inside a git repository: run it from a CrewRig checkout");
  }
  if (!existsSync(path.join(top, "node_modules", "js-yaml", "package.json")))
    return fail(`node_modules is missing in ${top}: run task lint-bootstrap`);

  const hooks = await import("./lib/ci-pre-push/hooks.ts");
  const select = await import("./lib/ci-pre-push/select.ts");
  const run = await import("./lib/ci-pre-push/run.ts");

  const plan = hooks.parsePushRefs(
    process.env["CREWRIG_PRE_PUSH_REFS"],
    gitOut(["rev-parse", "HEAD"]),
  );
  for (const n of plan.notices) say(n);
  if (plan.shas.length === 0) {
    say("no pushed ref can be checked: nothing to run (CI stays authoritative)");
    return 0;
  }
  const dirty = hooks.dirtyNotice(top);
  if (dirty !== null) say(dirty);

  let selection;
  try {
    selection = select.selectForShas(top, plan.shas);
  } catch (err) {
    if (err instanceof select.PrePushError) return fail(err.message);
    throw err;
  }
  for (const n of selection.notices) say(n);
  if (selection.ids.length === 0) {
    say("no fast-tier check selected for this changeset: nothing to run");
    return 0;
  }
  say(`running ${selection.ids.length} check(s): ${selection.ids.join(", ")}`);
  const report = await run.runTasks(selection.ids, { cwd: top, baseRef: selection.baseRef });
  return report.failed.length > 0 ? fail(`failed: ${report.failed.join(", ")}`) : 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  process.exitCode = fail(`internal error: ${err instanceof Error ? err.message : String(err)}`);
}
