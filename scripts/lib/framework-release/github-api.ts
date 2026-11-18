// github-api.ts — the few GitHub REST calls the publisher needs, over `fetch` (spec 0310 R4, R5). Both
// base URLs are injectable so the tests talk to a localhost stub. The token is read by the caller and
// is never written to a message.

export interface ApiAsset {
  readonly name: string;
  readonly digest?: string | null;
}

export interface ApiRelease {
  readonly id: number;
  readonly tag_name: string;
  readonly draft: boolean;
  readonly assets?: readonly ApiAsset[];
}

export interface ApiConfig {
  readonly apiBase: string;
  readonly uploadsBase: string;
  readonly token: string;
  readonly repository: string;
}

const TIMEOUT_MS = 120_000;
const PAGE = 100;

async function call(cfg: ApiConfig, url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${cfg.token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "crewrig-framework-release",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const brief = text.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(
      `${init.method ?? "GET"} ${new URL(url).pathname} failed: HTTP ${res.status} ${brief}`,
    );
  }
  return text === "" ? undefined : JSON.parse(text);
}

const repoUrl = (cfg: ApiConfig, rest: string): string =>
  `${cfg.apiBase}/repos/${cfg.repository}${rest}`;
const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

/** Every release the token can see, drafts included when it has write access. */
export async function listReleases(cfg: ApiConfig): Promise<ApiRelease[]> {
  const all: ApiRelease[] = [];
  for (let page = 1; ; page += 1) {
    const batch = (await call(
      cfg,
      repoUrl(cfg, `/releases?per_page=${PAGE}&page=${page}`),
      {},
    )) as ApiRelease[];
    all.push(...batch);
    if (batch.length < PAGE) return all;
  }
}

export async function getRelease(cfg: ApiConfig, id: number): Promise<ApiRelease> {
  return (await call(cfg, repoUrl(cfg, `/releases/${id}`), {})) as ApiRelease;
}

export async function deleteRelease(cfg: ApiConfig, id: number): Promise<void> {
  await call(cfg, repoUrl(cfg, `/releases/${id}`), { method: "DELETE" });
}

export interface DraftSpec {
  readonly tag: string;
  readonly commit: string;
  readonly notes: string;
  readonly prerelease: boolean;
}

export async function createDraft(cfg: ApiConfig, spec: DraftSpec): Promise<ApiRelease> {
  return (await call(cfg, repoUrl(cfg, "/releases"), {
    method: "POST",
    ...json({
      tag_name: spec.tag,
      target_commitish: spec.commit,
      name: spec.tag,
      body: spec.notes,
      draft: true,
      prerelease: spec.prerelease,
      make_latest: "false",
    }),
  })) as ApiRelease;
}

export async function uploadAsset(
  cfg: ApiConfig,
  id: number,
  name: string,
  bytes: Buffer,
): Promise<ApiAsset> {
  const url = `${cfg.uploadsBase}/repos/${cfg.repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`;
  return (await call(cfg, url, {
    method: "POST",
    body: new Uint8Array(bytes),
    headers: { "content-type": "application/gzip" },
  })) as ApiAsset;
}

/** Publish the draft; never as `latest` (spec 0310 R6, R7). */
export async function publishRelease(
  cfg: ApiConfig,
  id: number,
  prerelease: boolean,
): Promise<void> {
  await call(cfg, repoUrl(cfg, `/releases/${id}`), {
    method: "PATCH",
    ...json({ draft: false, prerelease, make_latest: "false" }),
  });
}
