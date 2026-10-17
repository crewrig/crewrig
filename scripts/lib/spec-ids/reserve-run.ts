// reserve-run.ts — the main flow of reserve-spec-id (spec 0262).
//
// Usage: reserveMain(argv, env)
// Exit codes: 0 secured, 3 allocated locally and not secured, 1 failure.
// Finding-line format: `Error: <message>` on stderr.

import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { preferredRemote } from "../governance/base-ref.ts";
import { runGit } from "../governance/git-run.ts";
import { ExitSignal, fail, note, out } from "./exit.ts";
import { parseArgs } from "./reserve-args.ts";
import { assertRepresentable, resolveCarrier } from "./reserve-carrier.ts";
import { findIssueReservation, loadAllocated, nextFreeId } from "./reserve-allocated.ts";
import type { Ctx } from "./reserve-allocated.ts";

function emitUnsecured(id: string, reason: string, issue: string): never {
  note("");
  note(`The id '${id}' is allocated LOCALLY but NOT secured: ${reason}`);
  note("Another session may still take it, so the spec must carry the mark below.");
  note("scripts/check-spec-id-reserved.sh reports it at pull-request time, and a");
  note("maintainer secures the id before merge with:");
  note(`  bash scripts/reserve-spec-id.sh --id ${id} --issue ${issue}`);
  out(id);
  out("unsecured-id: true");
  throw new ExitSignal(3);
}

function git(
  ctx: Ctx,
  args: string[],
  input?: string,
): { status: number; stdout: string; stderr: Buffer } {
  const res = runGit(["-C", ctx.repoDir, ...args], { cwd: process.cwd(), input });
  return { status: res.status, stdout: res.stdout.toString("utf8"), stderr: res.stderr };
}

/** A reservation object: parentless commit over the empty tree; `set -e` on failure. */
function reservationObject(ctx: Ctx, id: string, env: NodeJS.ProcessEnv): string {
  const tree = git(ctx, ["hash-object", "-w", "-t", "tree", "--stdin"], "");
  if (tree.status !== 0) {
    process.stderr.write(tree.stderr);
    throw new ExitSignal(tree.status);
  }
  const ident = (key: string, fallback: string): string => {
    const value = env[key];
    return value === undefined || value === "" ? fallback : value;
  };
  const commitEnv: NodeJS.ProcessEnv = {
    ...env,
    GIT_AUTHOR_NAME: ident("GIT_AUTHOR_NAME", "crewrig spec-id reservation"),
    GIT_AUTHOR_EMAIL: ident("GIT_AUTHOR_EMAIL", "reserve-spec-id@crewrig.invalid"),
    GIT_COMMITTER_NAME: ident("GIT_COMMITTER_NAME", "crewrig spec-id reservation"),
    GIT_COMMITTER_EMAIL: ident("GIT_COMMITTER_EMAIL", "reserve-spec-id@crewrig.invalid"),
  };
  const commit = runGit(
    [
      "-C",
      ctx.repoDir,
      "commit-tree",
      tree.stdout.replace(/\n+$/, ""),
      "-m",
      `reserve ${id} for issue #${ctx.issue}`,
    ],
    { cwd: process.cwd(), env: commitEnv },
  );
  if (commit.status !== 0) {
    process.stderr.write(commit.stderr);
    throw new ExitSignal(commit.status);
  }
  return commit.stdout.toString("utf8").replace(/\n+$/, "");
}

/** `git push ... 2>&1`: stdout and stderr share one file so their order is preserved. */
function pushCombined(ctx: Ctx, args: string[]): { status: number; output: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reserve-push-"));
  const file = path.join(dir, "out");
  const fd = openSync(file, "w");
  try {
    const res = spawnSync("git", ["-C", ctx.repoDir, ...args], {
      stdio: ["ignore", fd, fd],
      shell: false,
    });
    closeSync(fd);
    return { status: res.status ?? 1, output: readFileSync(file, "utf8").replace(/\n+$/, "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function recordedIssue(ctx: Ctx, ref: string): string {
  const probe = "refs/spec-id-probe/current";
  if (
    git(ctx, ["fetch", "--no-tags", "--quiet", "--force", ctx.remote, `+${ref}:${probe}`])
      .status !== 0
  )
    return "";
  const log = git(ctx, ["log", "-1", "--format=%s", probe]);
  const msg = (log.status === 0 ? log.stdout : "").replace(/\n+$/, "");
  git(ctx, ["update-ref", "-d", probe]);
  const at = msg.lastIndexOf("issue #");
  return at === -1 ? "" : msg.slice(at + "issue #".length);
}

function refExists(ctx: Ctx, ref: string): boolean {
  const res = git(ctx, ["ls-remote", ctx.remote, ref]);
  return res.status === 0 && res.stdout.replace(/\n+$/, "") !== "";
}

export function reserveMain(argv: readonly string[], env: NodeJS.ProcessEnv): void {
  const opts = parseArgs(argv, env);
  const repoDir = env.CREWRIG_REPO_DIR || path.resolve(import.meta.dirname, "..", "..", "..");
  const [carrier, orgNamespace] = resolveCarrier(repoDir, env);
  const target = opts.corpus === "org" ? orgNamespace : carrier;
  if (opts.wantId !== "") assertRepresentable(target, opts.wantId);
  const baseRef = env.BASE_REF ?? "";
  const referenceRef = baseRef !== "" ? baseRef : `${preferredRemote(repoDir)}/main`;
  const slash = referenceRef.indexOf("/");
  const remote = slash === -1 ? referenceRef : referenceRef.slice(0, slash);
  let offline = opts.offline;
  if (!offline && remote === "") {
    note("Notice: no git remote is configured, so no id can be secured.");
    offline = true;
  }
  const ctx: Ctx = { repoDir, remote, referenceRef, issue: opts.issue, offline };
  const offlineReason = "the remote was skipped (--offline), or no remote is configured";
  if (offline) {
    if (opts.wantId !== "") emitUnsecured(opts.wantId, offlineReason, opts.issue);
    emitUnsecured(nextFreeId(loadAllocated(ctx).ids), offlineReason, opts.issue);
  }
  let id = opts.wantId;
  for (let attempt = 1; ; attempt += 1) {
    if (attempt > opts.maxAttempts)
      fail(`gave up after ${opts.maxAttempts} attempts: every candidate id was taken by a
       concurrent session between the read and the push. That is contention, not
       a defect — re-run. Raise CREWRIG_SPEC_ID_MAX_ATTEMPTS if the repository is
       routinely this busy.`);
    if (id === "") {
      const allocated = loadAllocated(ctx);
      if (!allocated.readable)
        emitUnsecured(
          nextFreeId(allocated.ids),
          `the reservation namespace on '${remote}' could not be read, so the allocated set is incomplete`,
          opts.issue,
        );
      const existing = findIssueReservation(ctx);
      if (existing !== "") {
        note(
          `Notice: issue #${opts.issue} already secured ${existing}. Reusing it; no new reservation made.`,
        );
        out(existing);
        throw new ExitSignal(0);
      }
      id = nextFreeId(allocated.ids);
    }
    assertRepresentable(target, id);
    const ref = `${target}${id}`;
    const obj = reservationObject(ctx, id, env);
    const push = pushCombined(ctx, ["push", `--force-with-lease=${ref}:`, remote, `${obj}:${ref}`]);
    if (push.status === 0) {
      note(`Secured ${ref} for issue #${opts.issue}.`);
      out(id);
      throw new ExitSignal(0);
    }
    if (refExists(ctx, ref)) {
      if (opts.wantId !== "") {
        const holder = recordedIssue(ctx, ref);
        if (holder === opts.issue) {
          note(`Notice: ${ref} was already secured for issue #${opts.issue}. Nothing to do.`);
          out(id);
          throw new ExitSignal(0);
        }
        if (holder !== "")
          fail(`identifier '${id}' is already secured for issue #${holder}, and issue
       #${opts.issue} is asking for it. That is the collision this mechanism exists to
       surface: two tickets cannot hold one id. Resolve the attribution between
       #${holder} and #${opts.issue}, then re-run.`);
        fail(`identifier '${id}' is already secured on '${remote}' (${ref} exists) and the
       recording ticket could not be read. Refusing to overwrite a live
       reservation. Inspect it with:
         git ls-remote ${remote} '${ref}'`);
      }
      note(
        `Lost the race for ${id}; advancing to the next free id (attempt ${attempt} of ${opts.maxAttempts}).`,
      );
      id = "";
      continue;
    }
    note(`The push to ${ref} was refused and the id is still absent from the remote.`);
    note("git said:");
    for (const line of push.output.split("\n")) process.stderr.write(`  ${line}\n`);
    emitUnsecured(
      id,
      "the remote refused the write and no reservation appeared — no write access, or a namespace this remote hides or rejects",
      opts.issue,
    );
  }
}
