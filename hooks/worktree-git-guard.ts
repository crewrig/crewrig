// worktree-git-guard.ts — the pre-tool guard that refuses prohibited whole-tree
// git operations in a shared ticket worktree unless an exclusive claim is held
// (spec 0248 R3-R13). It replaces the shell hook of the same name, which stays
// as a forwarding shim for installations still wired to the `.sh` path (R13).
//
// Usage: node hooks/worktree-git-guard.ts [command]   (payload on stdin)
//   [command] fallback command text, used only when the payload carries none.
//
// ENTRY FORM (R10) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it. It needs no `node:` built-in.
//  - The first statement removes the `warning` listeners, which silences the
//    entry's own deferred warning (Node.js 24.0.0's type-stripping
//    ExperimentalWarning) and that of the claim module loaded lazily below.
//  - No `uncaughtException` handler: it would blind the deprecation channel
//    (`--throw-deprecation` in CI), which reports outside this try/catch.
//
// Two phases (R8, R10):
//  - Until a prohibited command inside a ticket worktree is identified, every
//    failure allows the command: exit 0 and zero bytes on both streams.
//  - From that point on, every failure refuses, a failed `import()` included:
//    an undetermined claim state is never read as `claimed`.
//
// The whole decision of whether there is anything to enforce lives in this file
// on purpose (R11): the claim module graph loads only on the slow path.

process.removeAllListeners("warning");

void (async () => {
  let ticket = "";
  let identified = false;
  let allowed = true;
  try {
    // Stream read (`readFileSync(0)` throws EAGAIN on a non-blocking pipe and
    // EOF on a closed or console stdin on Windows). A failed read keeps what
    // was received. An interactive terminal is never read (R4).
    const chunks: Buffer[] = [];
    if (!process.stdin.isTTY) {
      try {
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      } catch {
        // closed or unreadable stdin: fall through with what was read
      }
    }
    const rawPayload = Buffer.concat(chunks).toString("utf8");

    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = undefined;
    }

    // One segment of a `jq` path. An intermediate value that cannot be indexed
    // reads as absent (R5, R38(h)), as does `null`.
    const step = (value: unknown, segment: string | number): unknown => {
      if (typeof segment === "number") {
        return Array.isArray(value) ? (value[segment] as unknown) : undefined;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
      return (value as Record<string, unknown>)[segment];
    };

    // The first path whose value is selected by `jq`'s `//`: neither absent,
    // nor `null`, nor `false`. An empty string IS selected. A selected value
    // that is not a string is taken as its JSON text.
    const pick = (paths: readonly (readonly (string | number)[])[]): string | undefined => {
      for (const path of paths) {
        let value: unknown = payload;
        for (const segment of path) value = step(value, segment);
        if (value === undefined || value === null || value === false) continue;
        return typeof value === "string" ? value : JSON.stringify(value);
      }
      return undefined;
    };

    // The empty string counts as absent at both fallbacks, as `-z` did.
    let command =
      pick([
        ["toolCall", "args", "CommandLine"],
        ["toolCall", "args"],
        ["tool_input", "command"],
        ["command"],
        ["tool_input"],
      ]) ?? "";
    if (command === "") command = process.argv[2] ?? "";

    let cwd = pick([["cwd"], ["workspace_dir"], ["project_dir"], ["workspacePaths", 0]]);
    if (cwd === undefined || cwd === "") cwd = process.cwd();

    // On Windows a backslash reads as a forward slash (R6), so a Windows path
    // is in scope; elsewhere it is an ordinary file-name character.
    if (process.platform === "win32") cwd = cwd.replaceAll("\\", "/");
    const marker = "/.worktrees/";
    const at = cwd.lastIndexOf(marker);
    if (at === -1) return;
    const rest = cwd.slice(at + marker.length);
    const slash = rest.indexOf("/");
    ticket = slash === -1 ? rest : rest.slice(0, slash);
    if (ticket === "") return;

    // R7: substring tests on the whole text, with the quirks of the shell
    // guard. The stash exemption never applies when a first-group phrase is
    // present and is satisfied by an allowed verb anywhere in the text.
    const wholeTree = [
      "git reset --hard",
      "git checkout -- .",
      "git checkout .",
      "git clean",
      "git worktree remove --force",
      "git worktree remove -f",
    ];
    const stashReads = ["list", "show", "pop", "apply", "drop"];
    const prohibited =
      wholeTree.some((phrase) => command.includes(phrase)) ||
      (command.includes("git stash") &&
        !stashReads.some((verb) => command.includes(`git stash ${verb}`)));
    if (!prohibited) return;

    identified = true;
    const { readClaimState } = await import("../scripts/lib/worktree-claim/claim-state.ts");
    const claim = readClaimState({ env: process.env, cwd: process.cwd(), ticket });
    allowed = claim.state === "claimed";
  } catch {
    // Before identification: allow silently (R10). After: refuse (R8).
    allowed = !identified;
  }
  if (!allowed) {
    process.stderr.write(
      `mempalace-git-guard: prohibited whole-tree operation in shared worktree '.worktrees/${ticket}' refused (Spec 0114 R2 / Spec 0153 R2). Take an exclusive claim via 'node scripts/worktree-claim.ts take --agent <name>' or use 'run' before attempting whole-tree git operations.\n`,
    );
    process.exitCode = 1;
  }
})();
