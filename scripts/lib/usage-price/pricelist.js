// pricelist.js — the pinned LiteLLM snapshot (spec 0209 R1-R4, R25; PLAN v2
// step 2). `refresh()` is the ONLY writer under <root>/pricelist/; `pinned()`
// is the ONLY reader of the snapshot data. Network reached only from
// refresh(), on an explicit request — never from pinned() or any other read
// path (R2).
//
// Primary source: BerriAI/litellm's model_prices_and_context_window.json,
// pinned to the commit SHA that last touched it (R1). When --sha is absent,
// refresh() resolves the current SHA through GitHub's commits API, then
// fetches the blob AT THAT SHA (not HEAD) so the download is reproducible
// even if the file changes again between the two requests.

'use strict';

const fs = require('fs');
const path = require('path');

const layout = require('../usage-store/layout');

const REPO = 'BerriAI/litellm';
const FILE_PATH = 'model_prices_and_context_window.json';
const COMMITS_URL = `https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(FILE_PATH)}&per_page=1`;
const rawUrlFor = (sha) => `https://raw.githubusercontent.com/${REPO}/${sha}/${FILE_PATH}`;

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

async function resolveSha(fetchImpl) {
  const res = await fetchImpl(COMMITS_URL, { headers: { 'User-Agent': 'crewrig-usage-price' } });
  if (!res.ok) {
    throw new Error(`GitHub commits API returned ${res.status} for ${COMMITS_URL}`);
  }
  const commits = await res.json();
  if (!Array.isArray(commits) || commits.length === 0 || !commits[0].sha) {
    throw new Error(`GitHub commits API returned no commit for ${FILE_PATH}`);
  }
  return commits[0].sha;
}

// refresh({sha, fetchImpl}) — the sole writer under <root>/pricelist/.
// Resolves the SHA (unless given), fetches the blob at that SHA, writes
// <root>/pricelist/<sha>.json and the PINNED.json pointer. Never invoked
// implicitly by any read path (R2).
async function refresh({ sha, fetchImpl = fetch } = {}) {
  const resolvedSha = sha || (await resolveSha(fetchImpl));
  const sourceUrl = rawUrlFor(resolvedSha);
  const res = await fetchImpl(sourceUrl, { headers: { 'User-Agent': 'crewrig-usage-price' } });
  if (!res.ok) {
    throw new Error(`fetching pinned pricelist blob returned ${res.status} for ${sourceUrl}`);
  }
  const etag = res.headers && typeof res.headers.get === 'function' ? res.headers.get('etag') : null;
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`pricelist blob at ${sourceUrl} did not parse as JSON: ${err.message}`);
  }

  const blobPath = path.join(layout.pricelistDir(), `${resolvedSha}.json`);
  atomicWrite(blobPath, text);

  const pointer = {
    sha: resolvedSha,
    etag: etag || null,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    entryCount: Object.keys(data).length,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
  atomicWrite(layout.pinnedPointer(), JSON.stringify(pointer, null, 2));

  return pointer;
}

// pinned() — the ONLY reader of the snapshot data. Returns the pointer
// fields merged with the parsed entry map under `entries`.
function pinned() {
  const pointerPath = layout.pinnedPointer();
  if (!fs.existsSync(pointerPath)) {
    throw new Error(`no pinned pricelist snapshot at ${pointerPath} — run --refresh-pricelist first`);
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  const blobPath = path.join(layout.pricelistDir(), `${pointer.sha}.json`);
  const entries = JSON.parse(fs.readFileSync(blobPath, 'utf8'));
  return { ...pointer, entries };
}

// entryUrl(entry) — the primary source's own per-entry source URL, when it
// declares one for that entry (R4). Never fabricated.
function entryUrl(entry) {
  return (entry && entry.source) || null;
}

module.exports = { refresh, pinned, entryUrl };
