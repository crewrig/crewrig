// skill-evals.ts — run the evals of one skill, or of every changed skill, on the contributor's machine.
//
// Usage: task skill-evals -- <skill-name> | --changed [--out <dir>] [--mock] [--ticket <N>]
//   node scripts/skill-evals.ts <skill-name> | --changed [options]
// Needs CLAUDE_CODE_OAUTH_TOKEN (preferred; `claude setup-token`) or ANTHROPIC_API_KEY, unless --mock.
// Exit: 0 ok, 1 blocking outcome, 2 usage error or unknown skill, 3 failed precondition (credentials).
// CREWRIG_REPO_DIR overrides the repository root (default: the root of this script).
// Spec 0290; docs/skill-evals.md. Run `node scripts/lib/node-floor-guard.js` first on an unverified
// Node.js: the command needs Node.js 24 or later.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it; the module graph comes from `import()`.
//  - The first statement removes the `warning` listeners.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/skill-evals/cli.ts");
    const path = await import("node:path");
    const repoRoot = process.env.CREWRIG_REPO_DIR || path.resolve(__dirname, "..");
    process.exitCode = await main(process.argv.slice(2), process.env, repoRoot, {
      stdout: (s) => void process.stdout.write(s),
      stderr: (s) => void process.stderr.write(s),
    });
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
