// args.ts — the arguments of `crewrig init` (spec 0314 R14). The usage is decided before any I/O. A
// message never echoes an argument, so a rejected value cannot reach the output.

import { isRepositoryUrl, normalizeRepo } from "./plain-url.ts";

export type InitArguments =
  | { ok: true; feedbackRepo: string | undefined }
  | { ok: false; message: string };

const USAGE = "usage: node crewrig init [--feedback-repo <url>]";

/** Parse `[--feedback-repo <url>]`: the value is normalised and must be a repository URL. */
export function parseInitArguments(argv: readonly string[]): InitArguments {
  let feedbackRepo: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--feedback-repo") {
      return { ok: false, message: `crewrig init: unknown option or argument. ${USAGE}` };
    }
    if (feedbackRepo !== undefined) {
      return { ok: false, message: `crewrig init: --feedback-repo is given twice. ${USAGE}` };
    }
    const value = argv[index + 1];
    if (value === undefined) {
      return { ok: false, message: `crewrig init: --feedback-repo needs a value. ${USAGE}` };
    }
    const normalised = normalizeRepo(value);
    if (!isRepositoryUrl(normalised)) {
      return {
        ok: false,
        message:
          "crewrig init: --feedback-repo must be a repository URL https://<host>/<owner>/<repo>",
      };
    }
    feedbackRepo = normalised;
    index += 1;
  }
  return { ok: true, feedbackRepo };
}
