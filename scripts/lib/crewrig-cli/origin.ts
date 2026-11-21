// origin.ts — the feedback repository from the `origin` remote (spec 0314 R14). Git runs directly, with no
// shell. Any outcome other than a repository URL that does not designate the canonical repository is
// absent: no repository, no origin, git not installed, a failing command, a value that is not a
// repository URL, or the canonical repository itself.

import { execFile } from "node:child_process";
import { designatesCanonical, isRepositoryUrl, normalizeRepo } from "./plain-url.ts";

const SCP_GITHUB = /^git@github\.com:([^/]+)\/([^/]+)$/;

function remoteOutput(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["remote", "get-url", "origin"],
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 },
      (error, stdout) => {
        resolve(error === null ? stdout : undefined);
      },
    );
  });
}

/** Strip one trailing line feed (LF or CRLF) of the git output, and nothing else. */
function withoutLineEnd(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** The normalised repository URL of the `origin` remote of `cwd`, or undefined when it is absent (spec 0314 R14). */
export async function originRepository(cwd: string): Promise<string | undefined> {
  const output = await remoteOutput(cwd);
  if (output === undefined) return undefined;
  const normalised = normalizeRepo(withoutLineEnd(output));
  const scp = SCP_GITHUB.exec(normalised);
  const candidate = scp === null ? normalised : `https://github.com/${scp[1]}/${scp[2]}`;
  if (!isRepositoryUrl(candidate) || designatesCanonical(candidate)) return undefined;
  return candidate;
}
