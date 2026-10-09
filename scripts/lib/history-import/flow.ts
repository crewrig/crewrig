// flow.ts — the skeleton shared by the four history importers (spec 0253 R11-R15), in the order
// of their shell predecessors: banner, interpreter, source check, summary, target block, the
// dry-run preview, the confirmed import, the closing text. The `fzf` prerequisite is gone (spec
// 0253 R25 item 2): the two questions are asked through the readline prompter.

import type { ImportEnv } from "./types.ts";
import type { ImportDescriptor } from "./sources.ts";
import { runMine } from "./mine.ts";

const RULE = "====================================================";

/** Run one importer to the end and return its exit status. */
export async function runImport(d: ImportDescriptor, e: ImportEnv): Promise<number> {
  const { io, prompter, env } = e;
  const fail = (line: string): void => (d.errStream === "err" ? io.err(line) : io.out(line));
  const wing = env["MEMPALACE_HISTORY_WING"] || "transcripts";
  const agent = env["MEMPALACE_HISTORY_AGENT"] || d.defaultAgent;
  const extract = env["MEMPALACE_EXTRACT"] || "exchange";
  const source = env[d.sourceVar] || d.defaultSource(e.home);

  io.out(RULE);
  io.out(`  ${d.title}`);
  io.out(RULE);
  io.out("");

  let staged: { dir: string; dispose(): void } | undefined;
  try {
    const interpreter = e.detectInterpreter();
    if (interpreter === undefined || interpreter === "") {
      fail("Error: 'mempalace' is not importable from any candidate Python.");
      fail("Install MemPalace first: pipx install mempalace");
      return 1;
    }
    if (!d.isSource(source)) {
      for (const line of d.missing(source)) fail(line);
      return 1;
    }
    const found = d.inspect(source);
    if (found.empty !== undefined) {
      io.out(found.empty);
      return 0;
    }
    for (const line of found.summary) io.out(line);
    io.out("");
    io.out("MemPalace target:");
    io.out(`  Interpreter: ${interpreter}`);
    io.out(`  Wing:        ${wing}`);
    io.out(`  Agent label: ${agent}`);
    io.out(`  Extract:     ${extract}  (use MEMPALACE_EXTRACT=general to switch)`);
    io.out("");

    staged = d.mineSource(source);
    const mine = (dryRun: boolean): number => {
      prompter.pause();
      try {
        return runMine(interpreter, {
          source: staged?.dir ?? source,
          wing,
          agent,
          extract,
          dryRun,
        });
      } finally {
        prompter.resume();
      }
    };

    io.out("Step 1 — dry-run preview");
    if (await prompter.ask("Run a dry-run first to preview what will be filed? (yes/no)")) {
      io.out("");
      const status = mine(true);
      if (status !== 0) return status;
      io.out("");
    }

    io.out("Step 2 — actual import");
    io.out(`This will file conversations into MemPalace wing '${wing}'.`);
    io.out("Re-runs are safe: already-filed files are skipped automatically.");
    io.out("");
    if (!(await prompter.ask("Proceed with the import? (yes/no)"))) {
      io.out("Import canceled.");
      return 0;
    }

    io.out("");
    const status = mine(false);
    if (status !== 0) return status;

    io.out("");
    io.out(RULE);
    io.out("  Import complete");
    io.out(RULE);
    io.out("");
    io.out("Verify with:");
    io.out(`  ${interpreter} -m mempalace search '<keyword>'`);
    io.out(`  ${interpreter} -m mempalace status`);
    return 0;
  } finally {
    prompter.close();
    staged?.dispose();
  }
}
