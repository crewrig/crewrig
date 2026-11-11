// skill-evals-attestation.ts — check that every changed skill carries a fresh evals/results.json.
//
// Usage: node scripts/skill-evals-attestation.ts [<base-ref>]   (else $BASE_REF, else the preferred remote's main)
// CREWRIG_REPO_DIR overrides the repository root (default: the root of this script).
// Makes no model call and needs no credential (spec 0290 R37, R39). The results file is self-declared:
// the check proves freshness (the recorded content hash matches), not truth (R38).
// Exit: 0 clean, 1 a blocking outcome (invalid, stale; no-evals and recorded regression only under
// missing-evals-blocking / regression-blocking), 2 base ref unresolvable.
// Finding line: `<skill>: <status>[: <reason>]`; also appended to $GITHUB_STEP_SUMMARY when set.
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
    const { attestMain } = await import("./lib/skill-evals/attest-cli.ts");
    const path = await import("node:path");
    const repoRoot =
      process.env.CREWRIG_REPO_DIR ||
      path.resolve(__dirname, "..");
    process.exitCode = attestMain(process.argv.slice(2), process.env, repoRoot, {
      stdout: (s) => void process.stdout.write(s),
      stderr: (s) => void process.stderr.write(s),
    });
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
})();
