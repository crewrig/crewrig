// publish.ts — publish a framework release once and never replace it (spec 0310 R4, R5): refuse on a
// published release of the tag, delete a leftover draft, create a draft, upload the one asset, compare
// the digest GitHub computed with the job's own, and only then publish. Without a digest to compare,
// nothing is published (fail closed).

import fs from "node:fs";
import path from "node:path";

import * as api from "./github-api.ts";
import type { ApiConfig } from "./github-api.ts";
import { sha256File } from "../packaging/digest.ts";

export interface PublishInput {
  readonly tag: string;
  readonly commit: string;
  readonly asset: string;
  readonly notesFile: string;
  readonly prerelease: boolean;
}

export interface PublishDeps {
  /** Wait between two reads of an empty digest. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly digestAttempts: number;
  readonly digestDelayMs: number;
  readonly log: (line: string) => void;
}

export class PublishError extends Error {}

const normalise = (digest: string | null | undefined): string =>
  (digest ?? "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");

/** The digest from the upload response first, then from reading the release back; "" when none. */
async function githubDigest(
  cfg: ApiConfig,
  id: number,
  name: string,
  fromUpload: string,
  deps: PublishDeps,
): Promise<string> {
  if (fromUpload !== "") return fromUpload;
  for (let attempt = 1; attempt <= deps.digestAttempts; attempt += 1) {
    const release = await api.getRelease(cfg, id);
    const found = normalise(release.assets?.find((a) => a.name === name)?.digest);
    if (found !== "") return found;
    if (attempt < deps.digestAttempts) await deps.sleep(deps.digestDelayMs);
  }
  return "";
}

export async function publish(
  cfg: ApiConfig,
  input: PublishInput,
  deps: PublishDeps,
): Promise<string> {
  const name = path.basename(input.asset);
  const local = sha256File(input.asset);
  const releases = await api.listReleases(cfg);
  const same = releases.filter((r) => r.tag_name === input.tag);
  if (same.some((r) => !r.draft)) {
    throw new PublishError(
      `a published release of ${input.tag} exists: nothing is uploaded or replaced`,
    );
  }
  for (const draft of same) {
    deps.log(`deleting the leftover draft ${draft.id} of ${input.tag}`);
    await api.deleteRelease(cfg, draft.id);
  }
  const draft = await api.createDraft(cfg, {
    tag: input.tag,
    commit: input.commit,
    notes: fs.readFileSync(input.notesFile, "utf8"),
    prerelease: input.prerelease,
  });
  const uploaded = await api.uploadAsset(cfg, draft.id, name, fs.readFileSync(input.asset));
  const remote = await githubDigest(cfg, draft.id, name, normalise(uploaded.digest), deps);
  if (remote === "") {
    throw new PublishError(
      `GitHub reports no digest for ${name}: nothing is published (draft ${draft.id} left)`,
    );
  }
  if (remote !== local) {
    throw new PublishError(
      `digest mismatch for ${name}: job ${local}, GitHub ${remote}: nothing is published (draft ${draft.id} left)`,
    );
  }
  await api.publishRelease(cfg, draft.id, input.prerelease);
  deps.log(`published ${input.tag} with ${name} (sha256 ${local})`);
  return local;
}
