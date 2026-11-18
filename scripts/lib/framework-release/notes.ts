// notes.ts — the release notes of a framework release (spec 0310 R4, R11): the fixed digest block an
// author copies into the pin file, then the checks a recorder runs, in order.

export const BLOCK_BEGIN = "<!-- crewrig-release-digest:begin -->";
export const BLOCK_END = "<!-- crewrig-release-digest:end -->";

export interface NotesInput {
  readonly kind: "stable" | "prerelease";
  readonly tag: string;
  readonly asset: string;
  readonly sha256: string;
  /** Repository path of the workflow that built the release, for `--signer-workflow`. */
  readonly workflowPath: string;
  readonly repository: string;
  readonly releaseBranch: string;
}

/** The R4 block: tag, asset name and digest, ready to copy into the pin file. */
export function digestBlock(input: Pick<NotesInput, "tag" | "asset" | "sha256">): string {
  return [
    BLOCK_BEGIN,
    "```",
    `tag: ${input.tag}`,
    `asset: ${input.asset}`,
    `sha256: ${input.sha256}`,
    "```",
    BLOCK_END,
  ].join("\n");
}

export function releaseNotes(input: NotesInput): string {
  const repo = input.repository;
  const comparison =
    input.kind === "prerelease"
      ? `While the release branch is unmerged, the attested source commit must be an ancestor of \`origin/${input.releaseBranch}\` and not of \`origin/main\`. After the final merge, check only that it is an ancestor of \`origin/${input.releaseBranch}\`; steps 1 and 2 still apply.`
      : "The attested source commit must be an ancestor of `origin/main`.";
  return [
    `# ${input.tag}`,
    "",
    digestBlock(input),
    "",
    "## Checks before you write the pin",
    "",
    "Run these in order. Refuse the release when any fails or when two digests differ.",
    "",
    `1. \`gh release verify ${input.tag} --repo ${repo}\``,
    `2. \`gh release verify-asset ${input.tag} <downloaded ${input.asset}> --repo ${repo}\` — the digest it prints is the one to write into the pin; it must equal the \`sha256\` above.`,
    `3. \`gh attestation verify <downloaded ${input.asset}> --repo ${repo} --signer-workflow ${repo}/${input.workflowPath}\`, then compare the attested source commit with the branch. ${comparison}`,
    "",
    "These checks show the release was produced by this repository's workflow from the stated commit. They do not vouch for the commit's content.",
    "",
  ].join("\n");
}
