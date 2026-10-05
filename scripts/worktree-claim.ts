// worktree-claim.ts — an exclusive, attributable claim on a shared ticket
// worktree, so that a whole-tree git operation cannot silently destroy a sibling
// agent's uncommitted work (spec 0114, ported by spec 0248). It replaces the
// shell tool of the same name, which stays as a forwarding shim.
//
// Usage: node scripts/worktree-claim.ts --help
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js:
// the tool needs Node.js 24 or later.
//
// The mechanism, the on-disk format and the exit contract are documented in
// the `--help` block (scripts/lib/worktree-claim/usage.ts) and in
// specs/0248-worktree-git-guard-typescript.md; the modules live under
// scripts/lib/worktree-claim/, one concern per file.
//
// ENTRY FORM (spec 0248 R10, R25; spec 0243 R5) — do not "tidy" it into an
// ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it. The module graph comes from
//    `import()`.
//  - The first statement removes the `warning` listeners, which silences the
//    entry's own deferred warning and that of every module loaded below.
//  - No `uncaughtException` handler: it would blind the deprecation channel.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/worktree-claim/main.ts");
    process.exitCode = await main({
      argv: process.argv.slice(2),
      env: process.env,
      cwd: process.cwd(),
      platform: process.platform,
      io: {
        out: (line: string) => void process.stdout.write(`${line}\n`),
        err: (line: string) => void process.stderr.write(`${line}\n`),
        raw: (data: string | Uint8Array) => void process.stdout.write(data),
      },
    });
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
