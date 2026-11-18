// framework-release-publish.ts — publish a framework release once, never replace it (spec 0310 R4, R5). Reads GH_TOKEN; it
// touches only the release of the tag it is given.
//
// Usage: node scripts/framework-release-publish.ts --kind <prerelease|stable> --tag <tag> --commit <sha>
//          --asset <file.tgz> --notes <notes.md> [--repository <owner/name>] [--api-url <url>] [--uploads-url <url>]
// Exit: 0 published, 1 failure (nothing published), 2 usage. Run `node scripts/lib/node-floor-guard.js` first
// on an unverified Node.js: the tool needs Node.js 24 or later.
//
// ENTRY FORM (spec 0250 R3; spec 0243 R5) — the form of scripts/monorepo-release.ts, do not "tidy" it
// into an ordinary module: no top-level `import`/`export`, the first statement removes the `warning`
// listeners, no `uncaughtException` handler, and `process.exitCode` rather than `process.exit`.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { main } = await import("./lib/framework-release/publish-main.ts");
    process.exitCode = await main(process.argv.slice(2), {
      out: (line: string) => void process.stdout.write(`${line}\n`),
      err: (line: string) => void process.stderr.write(`${line}\n`),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const shown = Array.from(text, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : ch;
    }).join("");
    process.stderr.write(`Error: ${shown}\n`);
    process.exitCode = 1;
  }
})();
